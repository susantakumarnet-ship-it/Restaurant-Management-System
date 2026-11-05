import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { ah, badRequest } from '../utils/http.js';
import { authenticate } from '../middleware/auth.js';

/**
 * File storage. Local disk by default (served from /uploads). For cloud storage, replace
 * `store()` with an S3/GCS/Cloudinary upload and return the public URL - callers only use the URL.
 */
fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPG, PNG, WEBP or GIF images are allowed'))),
});

// Verify magic bytes so a renamed non-image can't be stored.
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}

async function store(file) {
  const type = sniff(file.buffer);
  if (!type) throw badRequest('File is not a valid image');
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[type]}`;
  await fs.promises.writeFile(path.join(config.uploadDir, name), file.buffer);
  return `/uploads/${name}`;
}

const r = Router();
r.post(
  '/',
  authenticate,
  upload.array('files', 5),
  ah(async (req, res) => {
    if (!req.files?.length) throw badRequest('No file uploaded');
    const urls = [];
    for (const f of req.files) urls.push(await store(f));
    res.status(201).json({ urls, url: urls[0] });
  })
);
export default r;
