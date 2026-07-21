import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler, badRequest, forbidden } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { uploadRateLimit } from "../../common/middleware/security.js";
import type { AuthedRequest } from "../../common/types.js";
import { inTx } from "../../db/pool.js";
import {
  attachStorageObject,
  createStorageUpload,
  storagePurposes,
  toUploadDto
} from "./storage.service.js";

const router = Router();
const supportedInputMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!supportedInputMimeTypes.has(file.mimetype)) {
      callback(badRequest("Only JPEG, PNG, or WEBP images are allowed"));
      return;
    }
    callback(null, true);
  }
});

const purposeSchema = z.enum(storagePurposes);

router.post(
  "/upload",
  authenticate,
  uploadRateLimit,
  upload.single("file"),
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
    res.json({ upload: toUploadDto(object) });
  })
);

export default router;
