import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from './logger';

export function initSocket(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
      (socket as any).userId = payload.id;
      (socket as any).role   = payload.role;
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    const role   = (socket as any).role;
    socket.join(`customer:${userId}`);
    if (role === 'admin') socket.join('admin');
    logger.info(`Socket connected: ${userId} (${role})`);
    socket.on('order:join', (orderId: string) => socket.join(`order:${orderId}`));
    socket.on('disconnect', () => logger.info(`Socket disconnected: ${userId}`));
  });
}
