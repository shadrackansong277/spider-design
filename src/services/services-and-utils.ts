// ════════════════════════════════════════
// src/services/sms.service.ts
// ════════════════════════════════════════
import AfricasTalking from 'africastalking';

let at: any = null;
let smsService: any = null;

function getAT() {
  if (!at) {
    at = AfricasTalking({
      apiKey:   process.env.AT_API_KEY!,
      username: process.env.AT_USERNAME || 'sandbox',
    });
    smsService = at.SMS;
  }
  return smsService;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  try {
    const sms = getAT();
    // Normalise Ghana number to +233 format
    const normalised = phone.startsWith('0') ? '+233' + phone.slice(1) : phone;
    await sms.send({ to: normalised, message, from: process.env.AT_SENDER_ID || 'SpiderGH' });
  } catch (err) {
    console.error('SMS send failed:', err);
    // Non-fatal
  }
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  const message = `Your Spider Designs verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
  await sendSms(phone, message);
}


// ════════════════════════════════════════
// src/services/push.service.ts
// ════════════════════════════════════════
import admin from 'firebase-admin';

let firebaseInitialised = false;

function initFirebase() {
  if (firebaseInitialised) return;
  if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    firebaseInitialised = true;
  }
}

export async function sendPushNotification(
  fcmToken: string, title: string, body: string, data: Record<string, string> = {}
): Promise<void> {
  try {
    initFirebase();
    if (!firebaseInitialised) return;
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k,v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    console.error('Push notification failed:', err);
  }
}


// ════════════════════════════════════════
// src/utils/pricing.ts
// ════════════════════════════════════════
interface PricingInput {
  basePrice: number;
  urgency:   string;
  embroideryStyle?: string;
  deliveryType: string;
  settingsMap: Record<string, number>;
}

export function calculateOrderPrice(input: PricingInput) {
  const { basePrice, urgency, embroideryStyle, deliveryType, settingsMap } = input;

  const base = basePrice || 450; // default minimum if not set

  const expressPct = settingsMap['express_surcharge_pct'] || 30;
  const rushPct    = settingsMap['rush_surcharge_pct']    || 60;
  const delivFee   = settingsMap['delivery_fee_accra']    || 50;
  const embSimple  = settingsMap['embroidery_simple']     || 80;
  const embFull    = settingsMap['embroidery_full']       || 180;
  const depositPct = settingsMap['deposit_percentage']    || 50;

  const expressFee = urgency === 'express' ? (base * expressPct / 100) :
                     urgency === 'rush'    ? (base * rushPct    / 100) : 0;

  const embroideryFee = embroideryStyle?.toLowerCase().includes('simple') ? embSimple :
                        embroideryStyle?.toLowerCase().includes('full')   ? embFull   : 0;

  const deliveryFee = deliveryType === 'delivery' ? delivFee : 0;

  const subtotal = base + expressFee + embroideryFee;
  const total    = subtotal + deliveryFee;
  const deposit  = Math.ceil((total * depositPct) / 100);

  return { basePrice: base, expressFee, embroideryFee, deliveryFee, subtotal, total, deposit };
}


// ════════════════════════════════════════
// src/utils/orderNumber.ts
// ════════════════════════════════════════
export async function generateOrderNumber(prisma: any): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  const seq   = String(count + 1000 + 1).padStart(4, '0');
  return `SD-${year}-${seq}`;
}


// ════════════════════════════════════════
// src/utils/AppError.ts
// ════════════════════════════════════════
export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}


// ════════════════════════════════════════
// src/middleware/auth.middleware.ts
// ════════════════════════════════════════
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

export const authenticate = async (req: any, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required.', 401));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
    const user = await prisma.user.findFirst({
      where: { id: payload.id, isActive: true },
      select: { id: true, role: true, firstName: true, lastName: true, phone: true, email: true },
    });
    if (!user) return next(new AppError('User not found or deactivated.', 401));
    req.user = user;
    next();
  } catch {
    next(new AppError('Invalid or expired token.', 401));
  }
};


// ════════════════════════════════════════
// src/middleware/role.middleware.ts
// ════════════════════════════════════════
import { Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export const requireRole = (roles: string[]) =>
  (req: any, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }
    next();
  };


// ════════════════════════════════════════
// src/middleware/validate.middleware.ts
// ════════════════════════════════════════
import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: (e as any).path, message: e.msg })),
    });
  }
  next();
};


// ════════════════════════════════════════
// src/middleware/error.middleware.ts
// ════════════════════════════════════════
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { logger }   from '../config/logger';

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`${req.method} ${req.path} — ${err.message}`);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'A record with this value already exists.' });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Record not found.' });
  }

  return res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
};


// ════════════════════════════════════════
// src/config/database.ts
// ════════════════════════════════════════
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});


// ════════════════════════════════════════
// src/config/logger.ts
// ════════════════════════════════════════
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});


// ════════════════════════════════════════
// src/config/socket.ts
// ════════════════════════════════════════
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
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    const role   = (socket as any).role;

    // Join personal room for targeted notifications
    socket.join(`customer:${userId}`);
    if (role === 'admin') socket.join('admin');

    logger.info(`Socket connected: ${userId} (${role})`);

    socket.on('order:join', (orderId: string) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${userId}`);
    });
  });
}


// ════════════════════════════════════════
// src/config/cloudinary.ts
// ════════════════════════════════════════
import { v2 as cloudinary }  from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer                from 'multer';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req: any, file: any) => ({
    folder:         'spider-designs/orders',
    allowed_formats: ['jpg','jpeg','png','webp'],
    transformation: [{ width: 1200, height: 1600, crop: 'limit', quality: 'auto' }],
  }),
} as any);

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

export { cloudinary };
