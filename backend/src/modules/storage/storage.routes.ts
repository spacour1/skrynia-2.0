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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function safeName(original: string) {
  const ext = path.extname(original).slice(0, 12);
  return `${nanoid(16)}${ext}`;
}

async function saveLocal(file: Express.Multer.File) {
  await fs.mkdir(env.LOCAL_UPLOAD_DIR, { recursive: true });
  const filename = safeName(file.originalname);
  const target = path.join(env.LOCAL_UPLOAD_DIR, filename);
  await fs.writeFile(target, file.buffer);
  return `${env.PUBLIC_BACKEND_URL}/uploads/${filename}`;
}

async function saveS3(file: Express.Multer.File) {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw badRequest("S3 storage is not configured");
  }
  const filename = safeName(file.originalname);
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
