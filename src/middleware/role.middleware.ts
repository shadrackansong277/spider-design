import { Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
export const requireRole = (roles: string[]) =>
  (req: any, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role)) return next(new AppError('You do not have permission.', 403));
    next();
  };
