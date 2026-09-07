import {
  Router,
  type Request,
  type RequestHandler,
  type Response
} from "express";
import multer from "multer";
import { z } from "zod";
import {
  ApiError,
  asyncHandler,
  badRequest,
  forbidden,
  notFound
} from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import {
  publicReadRateLimit,
  uploadRateLimit
} from "../../common/middleware/security.js";
import type { AuthedRequest } from "../../common/types.js";
import { inTx } from "../../db/pool.js";
import { assertConversationAccess } from "../chat/chat.service.js";
import { assertDisputeAttachmentAccess } from "../disputes/dispute-messages.service.js";
import {
  assertReadableStorageObjectMetadata,
  assertStorageObjectAvailable,
  attachStorageObject,
  buildPrivateMediaUrl,
  createStorageUpload,
  getLegacyPublicStorageObjectByKey,
  getProtectedStorageObjectById,
  getPublicStorageObjectById,
  getStorageAttachmentBinding,
  isPrivateStoragePurpose,
  publicStoragePurposes,
  readStorageObjectBody,
  storagePurposes,
  toUploadDto,
  type StorageObject
} from "./storage.service.js";

const router = Router();
export const legacyPublicStorageRouter = Router();
const supportedInputMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 2;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: 1,
    fields: 1,
    // Busboy emits `partsLimit` when the configured count is reached, so the
    // sentinel must be one above the two accepted parts (purpose + file).
    parts: MAX_MULTIPART_PARTS + 1,
    fieldSize: 64,
    fieldNameSize: 32
  },
  fileFilter: (_req, file, callback) => {
    if (!supportedInputMimeTypes.has(file.mimetype)) {
      callback(badRequest("Only JPEG, PNG, or WEBP images are allowed"));
      return;
    }
    callback(null, true);
  }
});

const parseSingleImageUpload: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (
        error.code === "LIMIT_FILE_SIZE" ||
        error.code === "LIMIT_FIELD_VALUE"
      ) {
        next(
          new ApiError(
            413,
            "Image upload payload is too large",
            "payload_too_large"
          )
        );
        return;
      }
      next(badRequest("Invalid image upload"));
      return;
    }
    next(error);
  });
};

const purposeSchema = z.enum(storagePurposes);
const storageObjectIdSchema = z.string().uuid();
const legacyPublicPathSchema = z.object({
  purpose: z.enum(publicStoragePurposes),
  ownerId: z.string().uuid(),
  fileName: z.string().regex(/^[A-Za-z0-9_-]{24}\.webp$/)
});

async function sendStorageObject(
  req: Request,
  res: Response,
  object: StorageObject,
  visibility: "public" | "private"
) {
  const controller = new AbortController();
  const abortRead = () => controller.abort();
  const abortClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  if (req.aborted) controller.abort();
  req.once("aborted", abortRead);
  res.once("close", abortClosedResponse);

  let body: Buffer;
  try {
    body = await readStorageObjectBody(object, controller.signal);
  } finally {
    req.off("aborted", abortRead);
    res.off("close", abortClosedResponse);
  }

  res.setHeader("Content-Type", object.mimeType);
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Content-Disposition", "inline");
  res.setHeader(
    "Cache-Control",
    visibility === "private" ? "private, no-store" : "public, max-age=300"
  );
  res.status(200).send(body);
}

async function sendStorageObjectHead(
  req: Request,
  res: Response,
  object: StorageObject,
  visibility: "public" | "private"
) {
  assertReadableStorageObjectMetadata(object);
  const controller = new AbortController();
  const abortRead = () => controller.abort();
  const abortClosedResponse = () => {
    if (!res.writableEnded) controller.abort();
  };
  if (req.aborted) controller.abort();
  req.once("aborted", abortRead);
  res.once("close", abortClosedResponse);
  try {
    await assertStorageObjectAvailable(object, controller.signal);
  } finally {
    req.off("aborted", abortRead);
    res.off("close", abortClosedResponse);
  }
  res.setHeader("Content-Type", object.mimeType);
  res.setHeader("Content-Length", String(object.sizeBytes));
  res.setHeader("Content-Disposition", "inline");
  res.setHeader(
    "Cache-Control",
    visibility === "private" ? "private, no-store" : "public, max-age=300"
  );
  res.status(200).end();
}

function mediaBoundaryHeaders(visibility: "public" | "private"): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      visibility === "private" ? "same-origin" : "cross-origin"
    );
    res.setHeader(
      "Cache-Control",
      visibility === "private" ? "private, no-store" : "no-store"
    );
    if (visibility === "private") {
      res.setHeader("Vary", "Cookie, Authorization");
    }
    next();
  };
}

const publicMediaBoundaryHeaders = mediaBoundaryHeaders("public");
const privateMediaBoundaryHeaders = mediaBoundaryHeaders("private");

function parseStorageObjectId(value: string): string {
  const parsed = storageObjectIdSchema.safeParse(value);
  if (!parsed.success) throw notFound("Media not found");
  return parsed.data;
}

function hideAttachmentLookupFailure(error: unknown): never {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    throw notFound("Media not found");
  }
  throw error;
}

async function assertProtectedReadAccess(
  object: StorageObject,
  req: AuthedRequest
) {
  if (object.status === "temporary") {
    if (object.ownerId !== req.user.id) throw notFound("Media not found");
    return;
  }
  if (object.purpose === "catalog_asset") {
    if (req.user.role !== "admin" || object.ownerId !== req.user.id) {
      throw notFound("Media not found");
    }
    return;
  }
  if (!isPrivateStoragePurpose(object.purpose)) throw notFound("Media not found");

  const binding = await getStorageAttachmentBinding(object.id);
  if (binding.hiddenAt && req.user.role !== "admin") {
    throw notFound("Media not found");
  }
  try {
    if (binding.kind === "conversation") {
      try {
        await assertConversationAccess(binding.contextId, req.user.id, req.user.role);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 403 &&
          req.user.role === "moderator" &&
          binding.reviewDisputeId
        ) {
          await assertDisputeAttachmentAccess(binding.reviewDisputeId, req.user);
        } else {
          throw error;
        }
      }
    } else {
      await assertDisputeAttachmentAccess(binding.contextId, req.user);
    }
  } catch (error) {
    hideAttachmentLookupFailure(error);
  }
}

router.head(
  "/public/:storageObjectId",
  publicMediaBoundaryHeaders,
  publicReadRateLimit,
  asyncHandler(async (req, res) => {
    const storageObjectId = parseStorageObjectId(req.params.storageObjectId);
    const object = await getPublicStorageObjectById(storageObjectId);
    await sendStorageObjectHead(req, res, object, "public");
  })
);

router.get(
  "/public/:storageObjectId",
  publicMediaBoundaryHeaders,
  publicReadRateLimit,
  asyncHandler(async (req, res) => {
    const storageObjectId = parseStorageObjectId(req.params.storageObjectId);
    const object = await getPublicStorageObjectById(storageObjectId);
    await sendStorageObject(req, res, object, "public");
  })
);

router.head(
  "/private/:storageObjectId",
  privateMediaBoundaryHeaders,
  publicReadRateLimit,
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const storageObjectId = parseStorageObjectId(req.params.storageObjectId);
    const object = await getProtectedStorageObjectById(storageObjectId);
    await assertProtectedReadAccess(object, req);
    await sendStorageObjectHead(req, res, object, "private");
  })
);

router.get(
  "/private/:storageObjectId",
  privateMediaBoundaryHeaders,
  publicReadRateLimit,
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const storageObjectId = parseStorageObjectId(req.params.storageObjectId);
    const object = await getProtectedStorageObjectById(storageObjectId);
    await assertProtectedReadAccess(object, req);
    await sendStorageObject(req, res, object, "private");
  })
);

legacyPublicStorageRouter.head(
  "/:purpose/:ownerId/:fileName",
  publicMediaBoundaryHeaders,
  publicReadRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = legacyPublicPathSchema.safeParse(req.params);
    if (!parsed.success) throw notFound("Media not found");
    const { purpose, ownerId, fileName } = parsed.data;
    const object = await getLegacyPublicStorageObjectByKey(
      `${purpose}/${ownerId}/${fileName}`
    );
    await sendStorageObjectHead(req, res, object, "public");
  })
);

legacyPublicStorageRouter.get(
  "/:purpose/:ownerId/:fileName",
  publicMediaBoundaryHeaders,
  publicReadRateLimit,
  asyncHandler(async (req, res) => {
    const parsed = legacyPublicPathSchema.safeParse(req.params);
    if (!parsed.success) throw notFound("Media not found");
    const { purpose, ownerId, fileName } = parsed.data;
    const object = await getLegacyPublicStorageObjectByKey(
      `${purpose}/${ownerId}/${fileName}`
    );
    await sendStorageObject(req, res, object, "public");
  })
);

router.post(
  "/upload",
  authenticate,
  uploadRateLimit,
  parseSingleImageUpload,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const purpose = purposeSchema.parse(req.body.purpose);
    if (purpose === "catalog_asset" && req.user.role !== "admin") {
      throw forbidden("Catalog assets can only be uploaded by an admin");
    }

    const object = await createStorageUpload({
      ownerId: req.user.id,
      purpose,
      file: req.file
    });
    res.status(201).json({ upload: toUploadDto(object) });
  })
);

router.post(
  "/catalog-assets/:uploadId/attach",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (req.user.role !== "admin") throw forbidden();
    const uploadId = z.string().uuid().parse(req.params.uploadId);
    const object = await inTx((client) =>
      attachStorageObject(client, {
        uploadId,
        ownerId: req.user.id,
        purpose: "catalog_asset"
      })
    );
    res.json({
      upload: {
        ...toUploadDto(object),
        previewUrl: buildPrivateMediaUrl(object.id)
      }
    });
  })
);

export default router;
