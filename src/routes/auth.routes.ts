import { Router } from 'express';
import { body }   from 'express-validator';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import {
  register,
  login,
  refreshToken,
  logout,
  sendOtp,
  verifyOtp,
  getMe,
  updateProfile,
  changePassword,
} from '../controllers/auth.controller';

export const authRouter = Router();

// POST /api/v1/auth/register
authRouter.post('/register', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('phone')
    .trim().notEmpty()
    .matches(/^(\+233|0)[0-9]{9}$/)
    .withMessage('Enter a valid Ghana phone number'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('email').optional().isEmail().normalizeEmail(),
], validate, register);

// POST /api/v1/auth/login
authRouter.post('/login', [
  body('identifier').trim().notEmpty().withMessage('Phone or email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], validate, login);

// POST /api/v1/auth/refresh
authRouter.post('/refresh', refreshToken);

// POST /api/v1/auth/logout
authRouter.post('/logout', authenticate, logout);

// POST /api/v1/auth/send-otp
authRouter.post('/send-otp', authenticate, sendOtp);

// POST /api/v1/auth/verify-otp
authRouter.post('/verify-otp', authenticate, [
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
], validate, verifyOtp);

// GET /api/v1/auth/me
authRouter.get('/me', authenticate, getMe);

// PATCH /api/v1/auth/profile
authRouter.patch('/profile', authenticate, [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
], validate, updateProfile);

// PATCH /api/v1/auth/change-password
authRouter.patch('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], validate, changePassword);
