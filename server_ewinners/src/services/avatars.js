import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const avatarsDir = path.join(__dirname, '../../uploads/avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

export function createAvatarUpload(getUserId) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, avatarsDir),
      filename: (req, file, cb) => {
        const userId = getUserId(req);
        const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
        cb(null, `user-${userId}-${Date.now()}${safeExt}`);
      },
    }),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!String(file.mimetype || '').startsWith('image/')) {
        return cb(new Error('Можно загружать только изображения'));
      }
      cb(null, true);
    },
  });
}

export function absoluteAvatarPath(avatarUrl) {
  if (!avatarUrl?.startsWith('/uploads/avatars/')) return null;
  return path.join(__dirname, '../..', avatarUrl);
}
