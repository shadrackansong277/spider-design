import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Use memory storage — we upload to Cloudinary manually after multer receives the file
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed') as any, false);
  },
});

// Helper: upload a buffer to Cloudinary
export async function uploadToCloudinary(
  buffer: Buffer,
  folder = 'spider-designs/orders'
): Promise<{ url: string; public_id: string }> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ width: 1200, height: 1600, crop: 'limit', quality: 'auto' }] },
      (error, result) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    ).end(buffer);
  });
}

export { cloudinary };
