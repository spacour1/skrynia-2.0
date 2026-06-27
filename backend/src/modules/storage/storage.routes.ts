import fs from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";
import { asyncHandler, badRequest } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";

const router = Router();

// Only real raster images are accepted — no SVG (can carry embedded <script>) and no
// HTML/text uploads (would otherwise be servable from our own origin as static files).
// The extension on disk is always derived from this table, never from the client's
// filename or declared mimetype, so a forged Content-Type can't smuggle a different
// file type past the check.
const ALLOWED_IMAGE_TYPES: Record<string, { ext: string; check: (buffer: Buffer) => boolean }> = {
  "image/jpeg": {
    ext: ".jpg",
    check: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  "image/png": {
    ext: ".png",
    check: (buffer) =>
      buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  "image/webp": {
    ext: ".webp",
    check: (buffer) =>
      buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  },
  "image/gif": {
    ext: ".gif",
    check: (buffer) => {
      const header = buffer.subarray(0, 6).toString("ascii");
      return header === "GIF87a" || header === "GIF89a";
    }
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      callback(badRequest("Only JPEG, PNG, WEBP, or GIF images are allowed"));
      return;
    }
    callback(null, true);
  }
});

/** Verifies the file's magic bytes actually match its declared mimetype, not just the header the client sent. */
function verifiedImageExtension(file: Express.Multer.File) {
  const allowed = ALLOWED_IMAGE_TYPES[file.mimetype];
  if (!allowed || !allowed.check(file.buffer)) {
    throw badRequest("Uploaded file does not match a supported image format");
  }
  return allowed.ext;
}

function safeName(ext: string) {
  return `${nanoid(16)}${ext}`;
}

async function saveLocal(file: Express.Multer.File) {
  await fs.mkdir(env.LOCAL_UPLOAD_DIR, { recursive: true });
  const filename = safeName(verifiedImageExtension(file));
  const target = path.join(env.LOCAL_UPLOAD_DIR, filename);
  await fs.writeFile(target, file.buffer);
  return `${env.PUBLIC_BACKEND_URL}/uploads/${filename}`;
}

async function saveS3(file: Express.Multer.File) {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw badRequest("S3 storage is not configured");
  }
  const filename = safeName(verifiedImageExtension(file));
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    },
    forcePathStyle: Boolean(env.S3_ENDPOINT)
  });
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: filename,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );
  return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${filename}`;
}

router.post(
  "/upload",
  authenticate,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("No file uploaded");
    const url = env.STORAGE_DRIVER === "s3" ? await saveS3(req.file) : await saveLocal(req.file);
    res.status(201).json({ url });
  })
);

export default router;
