import fs from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { ApiError, badRequest, forbidden, notFound, serviceUnavailable } from "../../common/errors.js";
import { logger } from "../../common/logger.js";
import {
  storageProcessingActive,
  storageQuotaRejectedTotal
} from "../../common/metrics.js";
import { env } from "../../config/env.js";
import { inTx, pool, type DbClient } from "../../db/pool.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";

export const storagePurposes = [
  "avatar",
  "product_media",
  "chat_attachment",
  "catalog_asset"
] as const;

export type StoragePurpose = (typeof storagePurposes)[number];
export type StorageDriver = "local" | "s3";
export type StorageObjectStatus =
  | "temporary"
  | "attached"
  | "deleted"
  | "quarantined";

export type StorageObject = {
  id: string;
  ownerId: string;
  objectKey: string;
  storageDriver: StorageDriver;
  purpose: StoragePurpose;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  status: StorageObjectStatus;
  createdAt: Date;
  attachedAt: Date | null;
  deletedAt: Date | null;
};

export type ProcessedImage = {
  buffer: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
};

const storageObjectColumns = `
  id,
  owner_id as "ownerId",
  object_key as "objectKey",
  storage_driver as "storageDriver",
  purpose,
  mime_type as "mimeType",
  size_bytes::integer as "sizeBytes",
  width,
  height,
  status,
  created_at as "createdAt",
  attached_at as "attachedAt",
  deleted_at as "deletedAt"
`;

const inputFormats = new Map<string, string>([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

let sharedS3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (sharedS3Client) return sharedS3Client;
  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured");

  const credentials =
    env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY
        }
      : undefined;

  sharedS3Client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials
  });
  return sharedS3Client;
}

export function buildMediaUrl(
  objectKey: string,
  publicBaseUrl = env.MEDIA_PUBLIC_BASE_URL
): string {
  const encodedKey = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
}

function localObjectPath(objectKey: string): string {
  const root = path.resolve(env.LOCAL_UPLOAD_DIR);
  const target = path.resolve(root, ...objectKey.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Storage object key escaped the local upload directory");
  }
  return target;
}

async function writePhysicalObject(
  driver: StorageDriver,
  objectKey: string,
  image: ProcessedImage
) {
  if (driver === "local") {
    const target = localObjectPath(objectKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, image.buffer, { flag: "wx" });
    return;
  }

  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: objectKey,
      Body: image.buffer,
      ContentType: image.mimeType
    })
  );
}

export async function deletePhysicalObject(
  driver: StorageDriver,
  objectKey: string
): Promise<void> {
  if (driver === "local") {
    try {
      await fs.unlink(localObjectPath(objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }

  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey })
  );
}

export async function processUploadedImage(
  file: Pick<Express.Multer.File, "buffer" | "mimetype">
): Promise<ProcessedImage> {
  const expectedFormat = inputFormats.get(file.mimetype);
  if (!expectedFormat) {
    throw badRequest("Only JPEG, PNG, or WEBP images are allowed");
  }

  try {
    const metadata = await sharp(file.buffer, {
      animated: true,
      failOn: "error",
      limitInputPixels: env.STORAGE_MAX_IMAGE_PIXELS,
      sequentialRead: true
    }).metadata();

    if (metadata.format !== expectedFormat) {
      throw badRequest("Uploaded file does not match its declared image format");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw badRequest("Animated images are not supported");
    }
    if (!metadata.width || !metadata.height) {
      throw badRequest("Image dimensions could not be determined");
    }
    if (
      metadata.width > env.STORAGE_MAX_IMAGE_WIDTH ||
      metadata.height > env.STORAGE_MAX_IMAGE_HEIGHT ||
      metadata.width * metadata.height > env.STORAGE_MAX_IMAGE_PIXELS
    ) {
      throw badRequest("Image dimensions are too large");
    }

    const output = await sharp(file.buffer, {
      animated: false,
      failOn: "error",
      limitInputPixels: env.STORAGE_MAX_IMAGE_PIXELS,
      sequentialRead: true
    })
      .rotate()
      .webp({ quality: 85, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (
      output.info.width > env.STORAGE_MAX_IMAGE_WIDTH ||
      output.info.height > env.STORAGE_MAX_IMAGE_HEIGHT
    ) {
      throw badRequest("Image dimensions are too large");
    }

    return {
      buffer: output.data,
      mimeType: "image/webp",
      width: output.info.width,
      height: output.info.height
    };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) throw error;
    throw badRequest("Uploaded file is not a valid supported image");
  }
}

function newObjectKey(
  ownerId: string,
  purpose: StoragePurpose,
  extension = "webp"
) {
  return `${purpose}/${ownerId}/${nanoid(24)}.${extension}`;
}

/**
 * Bounded semaphore around Sharp work: each decode/re-encode holds the full image in
 * memory, so unbounded parallel uploads are a memory/CPU amplification vector. Beyond
 * the running limit a short queue absorbs bursts; past that the request is refused
 * instead of buffering unbounded work.
 */
export class ProcessingSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly queueLimit: number
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.queueLimit) {
        throw serviceUnavailable("Image processing is busy, try again shortly");
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    storageProcessingActive.set(this.active);
    try {
      return await fn();
    } finally {
      this.active -= 1;
      storageProcessingActive.set(this.active);
      this.waiting.shift()?.();
    }
  }
}

const processingSemaphore = new ProcessingSemaphore(
  env.STORAGE_MAX_CONCURRENT_PROCESSING,
  env.STORAGE_PROCESSING_QUEUE_LIMIT
);

function quotaError(reason: string, message: string) {
  storageQuotaRejectedTotal.labels(reason).inc();
  return new ApiError(400, message, "storage_quota_exceeded");
}

/**
 * Live bytes (temporary + attached) drive the total quota; the daily window counts
 * everything created in the last 24h - deleting an object never refunds the day's
 * processing budget. Temporary objects count everywhere, so attach never needs a
 * byte re-check.
 */
async function assertUploadQuota(
  client: DbClient,
  ownerId: string,
  purpose: StoragePurpose,
  addBytes: number
) {
  const usage = await client.query<{
    totalBytes: string;
    dailyBytes: string;
    purposeCount: number;
  }>(
    `select
       coalesce(sum(size_bytes) filter (where status in ('temporary', 'attached')), 0)::bigint as "totalBytes",
       coalesce(sum(size_bytes) filter (where created_at > now() - interval '24 hours'), 0)::bigint as "dailyBytes",
       (count(*) filter (where purpose = $2 and status in ('temporary', 'attached')))::int as "purposeCount"
     from storage_objects
     where owner_id = $1`,
    [ownerId, purpose]
  );
  const { totalBytes, dailyBytes, purposeCount } = usage.rows[0];

  if (Number(dailyBytes) + addBytes > env.STORAGE_DAILY_UPLOAD_BYTES_PER_USER) {
    throw quotaError("daily_bytes", "Daily upload limit reached, try again tomorrow");
  }
  if (Number(totalBytes) + addBytes > env.STORAGE_TOTAL_QUOTA_BYTES_PER_USER) {
    throw quotaError("total_bytes", "Storage quota exceeded, delete unused media first");
  }
  if (purposeCount >= env.STORAGE_MAX_OBJECTS_PER_PURPOSE) {
    throw quotaError("purpose_count", "Too many stored objects of this type");
  }
}

export async function createStorageUpload(input: {
  ownerId: string;
  purpose: StoragePurpose;
  file: Pick<Express.Multer.File, "buffer" | "mimetype">;
}): Promise<StorageObject> {
  // Cheap pre-check with the raw upload size before any Sharp work; the raw buffer
  // bounds the processed size closely enough to refuse obvious over-quota traffic
  // without paying for decoding.
  await assertUploadQuota(pool, input.ownerId, input.purpose, input.file.buffer.length);

  const image = await processingSemaphore.run(() => processUploadedImage(input.file));
  const storageDriver = env.STORAGE_DRIVER;
  const objectKey = newObjectKey(input.ownerId, input.purpose);

  await writePhysicalObject(storageDriver, objectKey, image);
  try {
    const inserted = await inTx(async (client) => {
      // Serialize per-owner: the advisory lock makes the quota re-check plus insert
      // atomic, so parallel uploads cannot each pass the check and overshoot together.
      await client.query(`select pg_advisory_xact_lock(hashtextextended('storage_quota:' || $1, 0))`, [
        input.ownerId
      ]);
      await assertUploadQuota(client, input.ownerId, input.purpose, image.buffer.length);
      return client.query<StorageObject>(
        `insert into storage_objects(
           owner_id, object_key, storage_driver, purpose, mime_type,
           size_bytes, width, height
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning ${storageObjectColumns}`,
        [
          input.ownerId,
          objectKey,
          storageDriver,
          input.purpose,
          image.mimeType,
          image.buffer.length,
          image.width,
          image.height
        ]
      );
    });
    return inserted.rows[0];
  } catch (error) {
    try {
      await deletePhysicalObject(storageDriver, objectKey);
    } catch (cleanupError) {
      logger.error(
        { cleanupError, objectKey },
        "storage_upload_rollback_cleanup_failed"
      );
    }
    throw error;
  }
}

export function toUploadDto(object: StorageObject) {
  return {
    id: object.id,
    url: buildMediaUrl(object.objectKey),
    mimeType: object.mimeType,
    width: object.width,
    height: object.height
  };
}

export async function attachStorageObject(
  client: DbClient,
  input: {
    uploadId: string;
    ownerId: string;
    purpose: StoragePurpose;
  }
): Promise<StorageObject> {
  const selected = await client.query<StorageObject>(
    `select ${storageObjectColumns}
     from storage_objects
     where id = $1
     for update`,
    [input.uploadId]
  );
  const object = selected.rows[0];
  if (!object) throw notFound("Upload not found");
  if (object.ownerId !== input.ownerId) {
    throw forbidden("This upload belongs to another user");
  }
  if (object.status !== "temporary") {
    throw badRequest("Upload is no longer available for attachment");
  }
  if (object.purpose !== input.purpose) {
    throw badRequest("Upload purpose does not match this operation");
  }

  const attached = await client.query<StorageObject>(
    `update storage_objects
     set status = 'attached', attached_at = now()
     where id = $1 and status = 'temporary'
     returning ${storageObjectColumns}`,
    [object.id]
  );
  if (!attached.rows[0]) {
    throw badRequest("Upload is no longer available for attachment");
  }
  return attached.rows[0];
}

export async function enqueueStorageDeletion(
  client: Parameters<typeof enqueueDomainEvent>[0],
  storageObjectId: string
) {
  return enqueueDomainEvent(client, {
    eventKey: `storage.delete:${storageObjectId}`,
    eventType: "storage.delete",
    aggregateType: "storage_object",
    aggregateId: storageObjectId,
    payload: { storageObjectId }
  });
}

export async function deleteStorageObject(storageObjectId: string) {
  const selected = await pool.query<StorageObject>(
    `select ${storageObjectColumns}
     from storage_objects
     where id = $1`,
    [storageObjectId]
  );
  const object = selected.rows[0];
  if (!object || object.status === "deleted") return;

  await deletePhysicalObject(object.storageDriver, object.objectKey);
  await pool.query(
    `update storage_objects
     set status = 'deleted', deleted_at = now()
     where id = $1 and status != 'deleted'`,
    [storageObjectId]
  );
}

export async function cleanupTemporaryStorageObjects(
  options: { olderThanHours?: number; batchSize?: number } = {}
) {
  const olderThanHours =
    options.olderThanHours ?? env.STORAGE_TEMP_TTL_HOURS;
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 500);

  const candidates = await pool.query<{ id: string }>(
    `select id
     from storage_objects
     where status = 'temporary'
       and created_at < now() - ($1 * interval '1 hour')
     order by created_at
     limit $2`,
    [olderThanHours, batchSize]
  );

  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates.rows) {
    try {
      const didDelete = await inTx(async (client) => {
        const selected = await client.query<StorageObject>(
          `select ${storageObjectColumns}
           from storage_objects
           where id = $1
             and status = 'temporary'
             and created_at < now() - ($2 * interval '1 hour')
           for update`,
          [candidate.id, olderThanHours]
        );
        const object = selected.rows[0];
        if (!object) return false;

        // Keep the row locked while deleting so an attachment cannot race between the
        // final status check and physical deletion. A crash rolls the row back to
        // temporary; deleting the same key again is intentionally idempotent.
        await deletePhysicalObject(object.storageDriver, object.objectKey);
        await client.query(
          `update storage_objects
           set status = 'deleted', deleted_at = now()
           where id = $1`,
          [object.id]
        );
        return true;
      });
      if (didDelete) deleted += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        { error, storageObjectId: candidate.id },
        "temporary_storage_cleanup_failed"
      );
    }
  }

  return { claimed: candidates.rows.length, deleted, failed };
}
