import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

export const authenticate = async (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next(new AppError('Authentication required.', 401));
  const token = authHeader.split(' ')[1];
  try {
    const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
    const user = await prisma.user.findFirst({
      where: { id: payload.id, isActive: true },
      select: { id:true, role:true, firstName:true, lastName:true, phone:true, email:true },
    });
    if (!user) return next(new AppError('User not found or deactivated.', 401));
    req.user = user;
    next();
  } catch { next(new AppError('Invalid or expired token.', 401)); }
};
