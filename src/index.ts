import 'express-async-errors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { authRouter }          from './routes/auth.routes';
import { userRouter }          from './routes/user.routes';
import { productRouter }       from './routes/product.routes';
import { orderRouter }         from './routes/order.routes';
import { workerRouter }        from './routes/worker.routes';
import { notificationRouter }  from './routes/notification.routes';
import { paymentRouter }       from './routes/payment.routes';
import { adminRouter }         from './routes/admin.routes';
import { messageRouter }       from './routes/message.routes';
import { uploadRouter }        from './routes/upload.routes';
import { errorHandler }        from './middleware/error.middleware';
import { logger }              from './config/logger';
import { initSocket }          from './config/socket';
import { prisma }              from './config/database';

dotenv.config();

const app    = express();
const server = http.createServer(app);

// ── Allowed origins: comma-separated CLIENT_URL env var ──────────────
const getAllowedOrigins = (): (string | RegExp)[] => {
  const base: (string | RegExp)[] = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:19006',
    /^http:\/\/localhost:\d+$/,
  ];
  const envOrigins = (process.env.CLIENT_URL || '')
    .split(',').map((o: string) => o.trim()).filter(Boolean);
  return [...base, ...envOrigins];
};

const io = new Server(server, {
  cors: { origin: getAllowedOrigins(), credentials: true },
});

// ── Middleware ──────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin: string | undefined, cb: Function) => {
    const allowed = getAllowedOrigins();
    if (!origin) return cb(null, true);
    const ok = allowed.some((a: string | RegExp) =>
      typeof a === 'string' ? a === origin : a.test(origin)
    );
    ok ? cb(null, true) : cb(new Error('CORS: ' + origin + ' not allowed'));
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Auth rate limit (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
});

// ── Attach Socket.io to request ──────────────────
app.use((req: any, _res, next) => { req.io = io; next(); });

// ── Health check ─────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Spider API', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`,          authLimiter, authRouter);
app.use(`${API}/users`,         userRouter);
app.use(`${API}/products`,      productRouter);
app.use(`${API}/orders`,        orderRouter);
app.use(`${API}/workers`,       workerRouter);
app.use(`${API}/notifications`, notificationRouter);
app.use(`${API}/payments`,      paymentRouter);
app.use(`${API}/admin`,         adminRouter);
app.use(`${API}/messages`,      messageRouter);
app.use(`${API}/uploads`,       uploadRouter);

// ── 404 ──────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Error handler ─────────────────────────────────
app.use(errorHandler);

// ── Socket.io ────────────────────────────────────
initSocket(io);

// ── Start ─────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001');

server.listen(PORT, async () => {
  try {
    await prisma.$connect();
    logger.info(`✦ Spider API running on port ${PORT}`);
    logger.info(`✦ Database connected`);
    logger.info(`✦ Environment: ${process.env.NODE_ENV}`);
  } catch (err) {
    logger.error('Database connection failed:', err);
    process.exit(1);
  }
});

export { io };
