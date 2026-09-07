import fs from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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

export const publicStoragePurposes = [
  "avatar",
  "product_media",
  "catalog_asset"
] as const satisfies readonly StoragePurpose[];

export const privateStoragePurposes = [
  "chat_attachment"
] as const satisfies readonly StoragePurpose[];

const publicStoragePurposeSet = new Set<StoragePurpose>(publicStoragePurposes);
const privateStoragePurposeSet = new Set<StoragePurpose>(privateStoragePurposes);

export function isPublicStoragePurpose(purpose: StoragePurpose): boolean {
  return publicStoragePurposeSet.has(purpose);
}

export function isPrivateStoragePurpose(purpose: StoragePurpose): boolean {
  return privateStoragePurposeSet.has(purpose);
}

export type StorageDriver = "local" | "s3";
export type StorageObjectStatus =
  | "uploading"
  | "temporary"
  | "attached"
  | "deleting"
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

// Catalog uploads are attached before the admin saves the catalog form because the
// legacy catalog schema stores URLs rather than storage FKs. Public reads require a
// reference from an active catalog path, while cleanup must retain every referenced
// asset regardless of lifecycle status so draft/hidden edits are not deleted.
const catalogAssetReferenceExistsSql = `
  exists (
    select 1
    from catalog_groups catalog_group
    where (
      catalog_group.icon = '/api/storage/public/' || storage_objects.id::text
      or right(coalesce(catalog_group.icon, ''), char_length(storage_objects.object_key) + 1)
         = '/' || storage_objects.object_key
    )
  )
  or exists (
    select 1
    from games catalog_item
    where (
      catalog_item.icon_url = '/api/storage/public/' || storage_objects.id::text
      or catalog_item.banner = '/api/storage/public/' || storage_objects.id::text
      or catalog_item.logo_image = '/api/storage/public/' || storage_objects.id::text
      or catalog_item.background_image = '/api/storage/public/' || storage_objects.id::text
      or right(coalesce(catalog_item.icon_url, ''), char_length(storage_objects.object_key) + 1)
         = '/' || storage_objects.object_key
      or right(coalesce(catalog_item.banner, ''), char_length(storage_objects.object_key) + 1)
         = '/' || storage_objects.object_key
      or right(coalesce(catalog_item.logo_image, ''), char_length(storage_objects.object_key) + 1)
         = '/' || storage_objects.object_key
      or right(coalesce(catalog_item.background_image, ''), char_length(storage_objects.object_key) + 1)
         = '/' || storage_objects.object_key
    )
  )
`;

const publicCatalogAssetBindingExistsSql = `
  exists (
    select 1
    from catalog_groups catalog_group
    where catalog_group.status = 'active'
      and (
        catalog_group.icon = '/api/storage/public/' || storage_objects.id::text
        or right(coalesce(catalog_group.icon, ''), char_length(storage_objects.object_key) + 1)
           = '/' || storage_objects.object_key
      )
  )
  or exists (
    select 1
    from games catalog_item
    join catalog_groups catalog_group on catalog_group.id = catalog_item.group_id
    where catalog_item.status = 'active'
      and catalog_group.status = 'active'
      and (
        catalog_item.icon_url = '/api/storage/public/' || storage_objects.id::text
        or catalog_item.banner = '/api/storage/public/' || storage_objects.id::text
        or catalog_item.logo_image = '/api/storage/public/' || storage_objects.id::text
        or catalog_item.background_image = '/api/storage/public/' || storage_objects.id::text
        or right(coalesce(catalog_item.icon_url, ''), char_length(storage_objects.object_key) + 1)
           = '/' || storage_objects.object_key
        or right(coalesce(catalog_item.banner, ''), char_length(storage_objects.object_key) + 1)
           = '/' || storage_objects.object_key
        or right(coalesce(catalog_item.logo_image, ''), char_length(storage_objects.object_key) + 1)
           = '/' || storage_objects.object_key
        or right(coalesce(catalog_item.background_image, ''), char_length(storage_objects.object_key) + 1)
           = '/' || storage_objects.object_key
      )
  )
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

export function buildPublicMediaUrl(storageObjectId: string): string {
  return `/api/storage/public/${encodeURIComponent(storageObjectId)}`;
}

export function buildPrivateMediaUrl(storageObjectId: string): string {
  return `/api/storage/private/${encodeURIComponent(storageObjectId)}`;
}

function localObjectPath(objectKey: string): string {
  const root = path.resolve(env.LOCAL_UPLOAD_DIR);
  const target = path.resolve(root, ...objectKey.split("/"));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Storage object key escaped the local upload directory");
  }
  return target;
}

type SafeStorageProviderErrorCode =
  | "access_denied"
  | "capacity_exhausted"
  | "conflict"
  | "invalid_path"
  | "not_configured"
  | "not_found"
  | "throttled"
  | "timeout"
  | "unavailable"
  | "unknown";

const safeStorageProviderErrorCodes: Readonly<
  Record<string, SafeStorageProviderErrorCode>
> = {
  AccessDenied: "access_denied",
  EACCES: "access_denied",
  EPERM: "access_denied",
  ENOSPC: "capacity_exhausted",
  EEXIST: "conflict",
  ENOTDIR: "invalid_path",
  STORAGE_NOT_CONFIGURED: "not_configured",
  ENOENT: "not_found",
  NoSuchBucket: "not_found",
  NoSuchKey: "not_found",
  SlowDown: "throttled",
  Throttling: "throttled",
  AbortError: "timeout",
  TimeoutError: "timeout",
  ECONNRESET: "unavailable",
  ServiceUnavailable: "unavailable"
};

function storageProviderErrorCode(error: unknown): SafeStorageProviderErrorCode {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { code?: unknown; name?: unknown };
  for (const value of [candidate.code, candidate.name]) {
    if (typeof value !== "string") continue;
    const safeCode = safeStorageProviderErrorCodes[value];
    if (safeCode) return safeCode;
  }
  return "unknown";
}

class StorageProviderFailure extends Error {
  readonly code = "STORAGE_PROVIDER_FAILURE";

  constructor(operation: "write" | "delete") {
    super(`Storage provider ${operation} failed`);
    this.name = "StorageProviderFailure";
  }
}

function sanitizedStorageProviderFailure(input: {
  operation: "write" | "delete";
  driver: StorageDriver;
  error: unknown;
  storageObjectId?: string;
}): StorageProviderFailure {
  logger.error(
    {
      ...(input.storageObjectId
        ? { storageObjectId: input.storageObjectId }
        : {}),
      storageDriver: input.driver,
      errorCode: storageProviderErrorCode(input.error)
    },
    `storage_provider_${input.operation}_failed`
  );
  return new StorageProviderFailure(input.operation);
}

async function writePhysicalObject(
  driver: StorageDriver,
  objectKey: string,
  image: ProcessedImage,
  storageObjectId: string
) {
  try {
    if (driver === "local") {
      const target = localObjectPath(objectKey);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, image.buffer, { flag: "wx" });
      return;
    }

    if (!env.S3_BUCKET) {
      throw Object.assign(new Error("Storage provider is not configured"), {
        code: "STORAGE_NOT_CONFIGURED"
      });
    }
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: objectKey,
        Body: image.buffer,
        ContentType: image.mimeType
      })
    );
  } catch (error) {
    throw sanitizedStorageProviderFailure({
      operation: "write",
      driver,
      error,
      storageObjectId
    });
  }
}

export async function deletePhysicalObject(
  driver: StorageDriver,
  objectKey: string,
  storageObjectId?: string
): Promise<void> {
  try {
    if (driver === "local") {
      await fs.unlink(localObjectPath(objectKey));
      return;
    }

    if (!env.S3_BUCKET) {
      throw Object.assign(new Error("Storage provider is not configured"), {
        code: "STORAGE_NOT_CONFIGURED"
      });
    }
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey })
    );
  } catch (error) {
    if (
      driver === "local" &&
      (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      return;
    }
    throw sanitizedStorageProviderFailure({
      operation: "delete",
      driver,
      error,
      storageObjectId
    });
  }
}

export class StorageReadSemaphore {
  private active = 0;
  private readonly waiting: Array<{ resume: () => void }> = [];

  constructor(
    private readonly limit: number,
    private readonly queueLimit: number
  ) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw serviceUnavailable("Media request was cancelled");
    }
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.queueLimit) {
        throw serviceUnavailable("Media service is busy, try again shortly");
      }
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resume: () => {
            signal?.removeEventListener("abort", cancel);
            resolve();
          }
        };
        const cancel = () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(serviceUnavailable("Media request was cancelled"));
        };
        signal?.addEventListener("abort", cancel, { once: true });
        this.waiting.push(waiter);
      });
    }
    if (signal?.aborted) {
      throw serviceUnavailable("Media request was cancelled");
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.resume();
    }
  }
}

const storageReadSemaphore = new StorageReadSemaphore(
  env.STORAGE_MAX_CONCURRENT_READS,
  env.STORAGE_READ_QUEUE_LIMIT
);

function abortError(): Error {
  const error = new Error("Storage operation aborted");
  error.name = "AbortError";
  return error;
}

function enforceStorageReadDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function withinStorageReadBoundary<T>(
  object: StorageObject,
  failureEvent: "storage_read_failed" | "storage_head_failed",
  requestSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const abortRead = () => controller.abort();
  if (requestSignal?.aborted) controller.abort();
  else requestSignal?.addEventListener("abort", abortRead, { once: true });
  const timeout = setTimeout(abortRead, env.STORAGE_READ_TIMEOUT_MS);

  try {
    return await storageReadSemaphore.run(
      () => enforceStorageReadDeadline(operation(controller.signal), controller.signal),
      controller.signal
    );
  } catch (error) {
    logger.warn(
      {
        storageObjectId: object.id,
        storageDriver: object.storageDriver,
        errorCode: storageProviderErrorCode(error)
      },
      failureEvent
    );
    throw serviceUnavailable("Media is temporarily unavailable");
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abortRead);
  }
}

async function readS3BodyBounded(
  body: unknown,
  expectedBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  if (
    !body ||
    typeof body !== "object" ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== "function"
  ) {
    throw new Error("Storage provider returned a non-streaming body");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body as AsyncIterable<unknown>) {
    if (signal.aborted) throw abortError();
    if (!(chunk instanceof Uint8Array)) {
      throw new Error("Storage provider returned an invalid body chunk");
    }
    totalBytes += chunk.byteLength;
    if (
      totalBytes > expectedBytes ||
      totalBytes > env.STORAGE_MAX_STORED_IMAGE_BYTES
    ) {
      throw new Error("Stored object exceeds its readable byte boundary");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (totalBytes !== expectedBytes) {
    throw new Error("Stored object size does not match its database record");
  }
  return Buffer.concat(chunks, totalBytes);
}

async function readLocalBodyBounded(
  target: string,
  expectedBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const handle = await fs.open(target, "r");
  try {
    const stat = await handle.stat();
    if (stat.size !== expectedBytes) {
      throw new Error("Stored object size does not match its database record");
    }

    // Read through the opened handle so a path replacement cannot bypass the stat,
    // and reserve one extra byte to detect growth without ever buffering past the cap.
    const bounded = Buffer.allocUnsafe(expectedBytes + 1);
    let totalBytes = 0;
    while (totalBytes < bounded.length) {
      if (signal.aborted) throw abortError();
      const { bytesRead } = await handle.read(
        bounded,
        totalBytes,
        Math.min(64 * 1024, bounded.length - totalBytes),
        totalBytes
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    if (totalBytes !== expectedBytes) {
      throw new Error("Stored object size does not match its database record");
    }
    return bounded.subarray(0, totalBytes);
  } finally {
    await handle.close();
  }
}

export function assertReadableStorageObjectMetadata(
  object: StorageObject
): void {
  if (
    object.sizeBytes <= 0 ||
    object.sizeBytes > env.STORAGE_MAX_STORED_IMAGE_BYTES ||
    object.mimeType !== "image/webp"
  ) {
    throw serviceUnavailable("Media is temporarily unavailable");
  }
}

export async function readStorageObjectBody(
  object: StorageObject,
  requestSignal?: AbortSignal
): Promise<Buffer> {
  return withinStorageReadBoundary(
    object,
    "storage_read_failed",
    requestSignal,
    async (signal) => {
      assertReadableStorageObjectMetadata(object);

      let body: Buffer;
      if (object.storageDriver === "local") {
        body = await readLocalBodyBounded(
          localObjectPath(object.objectKey),
          object.sizeBytes,
          signal
        );
      } else {
        if (!env.S3_BUCKET) throw new Error("S3 storage is not configured");
        const response = await getS3Client().send(
          new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: object.objectKey }),
          { abortSignal: signal }
        );
        if (
          response.ContentLength !== object.sizeBytes ||
          (response.ContentType !== undefined &&
            response.ContentType !== object.mimeType)
        ) {
          throw new Error("Stored object metadata does not match its database record");
        }
        if (!response.Body) throw new Error("Storage provider returned an empty body");
        body = await readS3BodyBounded(response.Body, object.sizeBytes, signal);
      }

      if (body.length !== object.sizeBytes) {
        throw new Error("Stored object size does not match its database record");
      }
      return body;
    }
  );
}

export async function assertStorageObjectAvailable(
  object: StorageObject,
  requestSignal?: AbortSignal
): Promise<void> {
  await withinStorageReadBoundary(
    object,
    "storage_head_failed",
    requestSignal,
    async (signal) => {
      assertReadableStorageObjectMetadata(object);
      if (object.storageDriver === "local") {
        const stat = await fs.stat(localObjectPath(object.objectKey));
        if (stat.size !== object.sizeBytes) {
          throw new Error("Stored object size does not match its database record");
        }
      } else {
        if (!env.S3_BUCKET) throw new Error("S3 storage is not configured");
        const response = await getS3Client().send(
          new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: object.objectKey }),
          { abortSignal: signal }
        );
        if (
          response.ContentLength !== object.sizeBytes ||
          (response.ContentType !== undefined &&
            response.ContentType !== object.mimeType)
        ) {
          throw new Error("Stored object metadata does not match its database record");
        }
      }
    }
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
    if (output.data.length > env.STORAGE_MAX_STORED_IMAGE_BYTES) {
      throw badRequest("Processed image exceeds the stored image limit");
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
 * Reserved/uploaded bytes drive the total quota until physical deletion is confirmed;
 * the daily window counts everything created in the last 24h, so deletion never refunds
 * the day's processing budget. `uploading` and `deleting` rows deliberately remain in
 * both live counters: a crash cannot make reserved or potentially-still-present bytes
 * disappear from accounting.
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
       coalesce(sum(size_bytes) filter (where status in ('uploading', 'temporary', 'attached', 'deleting')), 0)::bigint as "totalBytes",
       coalesce(sum(size_bytes) filter (where created_at > now() - interval '24 hours'), 0)::bigint as "dailyBytes",
       (count(*) filter (where purpose = $2 and status in ('uploading', 'temporary', 'attached', 'deleting')))::int as "purposeCount"
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

  // Reserve quota and persist the object key before external storage I/O. If the
  // process dies after PutObject/writeFile, the `uploading` row remains discoverable
  // and the recurring cleanup can turn it into a durable delete intent.
  const reserved = await inTx(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended('storage_quota:' || $1, 0))`, [
      input.ownerId
    ]);
    await assertUploadQuota(client, input.ownerId, input.purpose, image.buffer.length);
    return client.query<StorageObject>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'uploading')
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
  const upload = reserved.rows[0];

  try {
    await writePhysicalObject(storageDriver, objectKey, image, upload.id);
    const finalized = await pool.query<StorageObject>(
      `update storage_objects
       set status = 'temporary'
       where id = $1 and status = 'uploading'
       returning ${storageObjectColumns}`,
      [upload.id]
    );
    if (!finalized.rows[0]) {
      throw new Error(`Storage upload ${upload.id} lost its reservation before finalization`);
    }
    return finalized.rows[0];
  } catch (error) {
    try {
      await inTx((client) =>
        enqueueStorageDeletion(client, upload.id, {
          reopenDeleted: true,
          eventKey: `storage.delete:${upload.id}:upload-recovery`
        })
      );
    } catch (intentError) {
      logger.error(
        {
          storageObjectId: upload.id,
          storageDriver,
          errorCode: storageProviderErrorCode(intentError)
        },
        "storage_upload_deletion_intent_failed"
      );
    }
    if (error instanceof StorageProviderFailure) {
      throw serviceUnavailable("Storage provider is temporarily unavailable");
    }
    throw error;
  }
}

export function toUploadDto(object: StorageObject) {
  const protectedPreview = object.status === "temporary";
  return {
    id: object.id,
    url:
      protectedPreview || isPrivateStoragePurpose(object.purpose)
        ? buildPrivateMediaUrl(object.id)
        : buildPublicMediaUrl(object.id),
    mimeType: object.mimeType,
    width: object.width,
    height: object.height
  };
}

export type StorageAttachmentBinding = {
  kind: "conversation" | "dispute";
  contextId: string;
  hiddenAt: Date | null;
  reviewDisputeId: string | null;
};

export async function getPublicStorageObjectById(
  storageObjectId: string
): Promise<StorageObject> {
  const result = await pool.query<StorageObject>(
    `select ${storageObjectColumns}
     from storage_objects
     where id = $1
       and purpose = any($2::text[])
       and status = 'attached'
       and (purpose != 'catalog_asset' or (${publicCatalogAssetBindingExistsSql}))`,
    [storageObjectId, publicStoragePurposes]
  );
  const object = result.rows[0];
  if (!object) throw notFound("Media not found");
  return object;
}

export async function getLegacyPublicStorageObjectByKey(
  objectKey: string
): Promise<StorageObject> {
  const result = await pool.query<StorageObject>(
    `select ${storageObjectColumns}
     from storage_objects
     where object_key = $1
       and purpose = any($2::text[])
       and status = 'attached'
       and (purpose != 'catalog_asset' or (${publicCatalogAssetBindingExistsSql}))`,
    [objectKey, publicStoragePurposes]
  );
  const object = result.rows[0];
  if (!object) throw notFound("Media not found");
  return object;
}

export async function getProtectedStorageObjectById(
  storageObjectId: string
): Promise<StorageObject> {
  const result = await pool.query<StorageObject>(
    `select ${storageObjectColumns}
     from storage_objects
     where id = $1
       and status in ('temporary', 'attached')`,
    [storageObjectId]
  );
  const object = result.rows[0];
  if (!object) throw notFound("Media not found");
  return object;
}

export async function getStorageAttachmentBinding(
  storageObjectId: string
): Promise<StorageAttachmentBinding> {
  const result = await pool.query<StorageAttachmentBinding>(
    `select 'conversation'::text as kind,
            message.conversation_id as "contextId",
            message.hidden_at as "hiddenAt",
            (
              select dispute.id
              from conversations conversation
              join disputes dispute on dispute.order_id = conversation.order_id
              where conversation.id = message.conversation_id
              order by dispute.created_at desc, dispute.id desc
              limit 1
            ) as "reviewDisputeId"
     from messages message
     where message.attachment_storage_object_id = $1
     union all
     select 'dispute'::text as kind,
            message.dispute_id as "contextId",
            message.hidden_at as "hiddenAt",
            message.dispute_id as "reviewDisputeId"
     from dispute_messages message
     where message.attachment_storage_object_id = $1`,
    [storageObjectId]
  );
  if (result.rows.length === 0) throw notFound("Media not found");
  if (result.rows.length !== 1) {
    throw serviceUnavailable("Media is temporarily unavailable");
  }
  return result.rows[0];
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
  storageObjectId: string,
  options: { reopenDeleted?: boolean; eventKey?: string } = {}
) {
  const marked = await client.query<{ id: string }>(
    `update storage_objects
     set status = 'deleting', deleted_at = null
     where id = $1 and (status != 'deleted' or $2)
     returning id`,
    [storageObjectId, options.reopenDeleted ?? false]
  );
  if (!marked.rows[0]) return null;

  // A late provider write uses a distinct recovery key. If that event (or any other
  // deletion intent for this object) exhausted its attempts, revive the failed intent
  // itself instead of conflicting with an older, already-processed default key.
  const revived = await client.query<{ id: string }>(
    `with failed_event as (
       select id
       from domain_outbox
       where event_type = 'storage.delete'
         and aggregate_type = 'storage_object'
         and aggregate_id = $1
         and status = 'failed'
       order by updated_at, id
       limit 1
       for update
     )
     update domain_outbox event
     set status = 'pending', attempts = 0, available_at = now(),
         locked_at = null, locked_by = null, processed_at = null,
         last_error = null, updated_at = now()
     from failed_event
     where event.id = failed_event.id
     returning event.id`,
    [storageObjectId]
  );
  if (revived.rows[0]) return revived.rows[0];

  const event = await enqueueDomainEvent(client, {
    eventKey: options.eventKey ?? `storage.delete:${storageObjectId}`,
    eventType: "storage.delete",
    aggregateType: "storage_object",
    aggregateId: storageObjectId,
    payload: { storageObjectId }
  });

  // Storage deletion is safe to repeat forever. The hourly reconciler revives a
  // terminal event instead of leaving a physical object permanently charged to quota.
  if (event.status === "failed") {
    await client.query(
      `update domain_outbox
       set status = 'pending', attempts = 0, available_at = now(),
           locked_at = null, locked_by = null, processed_at = null,
           last_error = null, updated_at = now()
       where id = $1 and status = 'failed'`,
      [event.id]
    );
  }
  return event;
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

  await deletePhysicalObject(
    object.storageDriver,
    object.objectKey,
    object.id
  );
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
    `with eligible as (
       select id, created_at,
              case when status in ('uploading', 'temporary') then 0 else 1 end as lane
       from storage_objects
       where (
           status in ('uploading', 'temporary')
           and created_at < now() - ($1 * interval '1 hour')
         )
         or (
           status = 'deleting'
           and not exists (
             select 1
             from domain_outbox event
             where event.event_type = 'storage.delete'
               and event.aggregate_type = 'storage_object'
               and event.aggregate_id = storage_objects.id::text
             and event.status in ('pending', 'processing')
           )
         )
         or (
           status = 'attached'
           and purpose = 'catalog_asset'
           and created_at < now() - ($1 * interval '1 hour')
           and not (${catalogAssetReferenceExistsSql})
         )
     ), ranked as (
       select id, lane,
              row_number() over (partition by lane order by created_at, id) as lane_position
       from eligible
     )
     select id
     from ranked
     order by lane_position, lane
     limit $2`,
    [olderThanHours, batchSize]
  );

  let queued = 0;
  let failed = 0;
  for (const candidate of candidates.rows) {
    try {
      const didQueue = await inTx(async (client) => {
        const selected = await client.query<{ id: string }>(
          `select id
           from storage_objects
           where id = $1
             and (
               (
                 status in ('uploading', 'temporary')
                 and created_at < now() - ($2 * interval '1 hour')
               )
               or (
                 status = 'deleting'
                 and not exists (
                   select 1
                   from domain_outbox event
                   where event.event_type = 'storage.delete'
                     and event.aggregate_type = 'storage_object'
                     and event.aggregate_id = storage_objects.id::text
                     and event.status in ('pending', 'processing')
                   )
                 )
               or (
                 status = 'attached'
                 and purpose = 'catalog_asset'
                 and created_at < now() - ($2 * interval '1 hour')
                 and not (${catalogAssetReferenceExistsSql})
               )
             )
           for update`,
          [candidate.id, olderThanHours]
        );
        const object = selected.rows[0];
        if (!object) return false;
        return (await enqueueStorageDeletion(client, object.id)) !== null;
      });
      if (didQueue) queued += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        { error, storageObjectId: candidate.id },
        "storage_cleanup_intent_failed"
      );
    }
  }

  return { claimed: candidates.rows.length, queued, failed };
}
