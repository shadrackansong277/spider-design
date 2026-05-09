import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';
export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`);
  if (err instanceof AppError) return res.status(err.statusCode).json({ success:false, message:err.message });
  if (err.code === 'P2002') return res.status(409).json({ success:false, message:'A record with this value already exists.' });
  if (err.code === 'P2025') return res.status(404).json({ success:false, message:'Record not found.' });
  return res.status(500).json({ success:false, message:'Internal server error. Please try again.' });
};
