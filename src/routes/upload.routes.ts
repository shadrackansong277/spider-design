import { Router }         from 'express';
import { authenticate }   from '../middleware/auth.middleware';
import { upload, uploadToCloudinary } from '../config/cloudinary';

export const uploadRouter = Router();
uploadRouter.use(authenticate);

// POST /uploads/image — single image
uploadRouter.post('/image', upload.single('image'), async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  const result = await uploadToCloudinary(req.file.buffer);
  res.json({ success: true, data: { url: result.url, publicId: result.public_id } });
});

// POST /uploads/images — multiple images
uploadRouter.post('/images', upload.array('images', 10), async (req: any, res: any) => {
  const files = req.files as Express.Multer.File[];
  if (!files?.length) return res.status(400).json({ success: false, message: 'No files uploaded' });
  const results = await Promise.all(files.map(f => uploadToCloudinary(f.buffer)));
  res.json({ success: true, data: results.map(r => ({ url: r.url, publicId: r.public_id })) });
});
