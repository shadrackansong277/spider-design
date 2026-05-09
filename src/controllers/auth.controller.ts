import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { generateOtp, sendOtpSms } from '../services/sms.service';
import { sendPushNotification } from '../services/push.service';
import { AppError } from '../utils/AppError';
import { logger } from '../config/logger';

const SALT_ROUNDS = 12;

const signAccess = (id: string, role: string) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

const signRefresh = (id: string) =>
  jwt.sign({ id }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

// ─────────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────────
export const register = async (req: Request, res: Response) => {
  const { firstName, lastName, phone, email, password } = req.body;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
  });
  if (existing) {
    throw new AppError('An account with this phone or email already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { firstName, lastName, phone, email, passwordHash, role: 'customer' },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, role: true },
  });

  const accessToken  = signAccess(user.id, user.role);
  const refreshToken = signRefresh(user.id);

  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  logger.info(`New registration: ${phone}`);

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { user, accessToken, refreshToken },
  });
};

// ─────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────
export const login = async (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }],
      isActive: true,
    },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError('Invalid credentials.', 401);
  }

  const accessToken  = signAccess(user.id, user.role);
  const refreshToken = signRefresh(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken, lastLoginAt: new Date() },
  });

  const { passwordHash: _, ...safeUser } = user;

  res.json({
    success: true,
    data: { user: safeUser, accessToken, refreshToken },
  });
};

// ─────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────
export const refreshToken = async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;
  if (!token) throw new AppError('Refresh token required.', 400);

  let payload: any;
  try {
    payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.id, refreshToken: token, isActive: true },
  });
  if (!user) throw new AppError('Session expired. Please log in again.', 401);

  const newAccess  = signAccess(user.id, user.role);
  const newRefresh = signRefresh(user.id);

  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefresh } });

  res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh } });
};

// ─────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────
export const logout = async (req: any, res: Response) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { refreshToken: null },
  });
  res.json({ success: true, message: 'Logged out successfully.' });
};

// ─────────────────────────────────────────────────
// POST /auth/send-otp
// ─────────────────────────────────────────────────
export const sendOtp = async (req: any, res: Response) => {
  const otp = generateOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  await prisma.user.update({
    where: { id: req.user.id },
    data: { otpCode: otp, otpExpiresAt: expires },
  });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  await sendOtpSms(user!.phone, otp);

  res.json({ success: true, message: 'OTP sent to your phone number.' });
};

// ─────────────────────────────────────────────────
// POST /auth/verify-otp
// ─────────────────────────────────────────────────
export const verifyOtp = async (req: any, res: Response) => {
  const { otp } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  if (
    !user?.otpCode ||
    user.otpCode !== otp ||
    !user.otpExpiresAt ||
    user.otpExpiresAt < new Date()
  ) {
    throw new AppError('Invalid or expired OTP.', 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isVerified: true, otpCode: null, otpExpiresAt: null },
  });

  res.json({ success: true, message: 'Phone number verified.' });
};

// ─────────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────────
export const getMe = async (req: any, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      phone: true, role: true, avatarUrl: true,
      isActive: true, isVerified: true, createdAt: true,
      measurements: { where: { isDefault: true }, take: 1 },
      worker: true,
    },
  });
  res.json({ success: true, data: user });
};

// ─────────────────────────────────────────────────
// PATCH /auth/profile
// ─────────────────────────────────────────────────
export const updateProfile = async (req: any, res: Response) => {
  const { firstName, lastName, email, fcmToken } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { firstName, lastName, email, fcmToken },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true },
  });
  res.json({ success: true, data: user });
};

// ─────────────────────────────────────────────────
// PATCH /auth/change-password
// ─────────────────────────────────────────────────
export const changePassword = async (req: any, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError('Current password is incorrect.', 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  res.json({ success: true, message: 'Password updated successfully.' });
};
