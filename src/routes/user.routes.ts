import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';
import { body }         from 'express-validator';
import { validate }     from '../middleware/validate.middleware';

export const userRouter = Router();
userRouter.use(authenticate);

// GET /users/measurements
userRouter.get('/measurements', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const measurements = await prisma.customerMeasurement.findMany({ where:{ userId:req.user.id }, orderBy:{ isDefault:'desc' } });
  res.json({ success:true, data:measurements });
});

// POST /users/measurements
userRouter.post('/measurements', [
  body('label').optional().trim(),
  body('chest').optional().isFloat(),
], validate, async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { label='My Measurements', isDefault=false, ...rest } = req.body;
  if (isDefault) await prisma.customerMeasurement.updateMany({ where:{ userId:req.user.id }, data:{ isDefault:false } });
  const measurement = await prisma.customerMeasurement.create({ data:{ userId:req.user.id, label, isDefault, ...rest } });
  res.status(201).json({ success:true, data:measurement });
});

// PATCH /users/measurements/:id
userRouter.patch('/measurements/:id', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const measurement = await prisma.customerMeasurement.update({
    where:{ id:req.params.id, userId:req.user.id },
    data:req.body,
  });
  res.json({ success:true, data:measurement });
});

// GET /users — admin only
userRouter.get('/', requireRole(['admin']), async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const users = await prisma.user.findMany({
    select:{ id:true, firstName:true, lastName:true, phone:true, email:true, role:true, isActive:true, createdAt:true },
    orderBy:{ createdAt:'desc' },
  });
  res.json({ success:true, data:users });
});
