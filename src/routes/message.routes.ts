import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { body, param }  from 'express-validator';
import { validate }     from '../middleware/validate.middleware';

export const messageRouter = Router();
messageRouter.use(authenticate);

// GET /messages/:orderId
messageRouter.get('/:orderId', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const messages = await prisma.message.findMany({
    where:{ orderId:req.params.orderId },
    include:{ sender:{ select:{ id:true, firstName:true, role:true, avatarUrl:true } } },
    orderBy:{ createdAt:'asc' },
    take: 100,
  });
  res.json({ success:true, data:messages });
});

// POST /messages/:orderId
messageRouter.post('/:orderId', [
  param('orderId').isUUID(),
  body('body').trim().notEmpty(),
], validate, async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const msg = await prisma.message.create({
    data:{ orderId:req.params.orderId, senderId:req.user.id, body:req.body.body },
    include:{ sender:{ select:{ id:true, firstName:true, role:true } } },
  });
  // Emit to order room
  req.io?.to(`order:${req.params.orderId}`).emit('message:new', msg);
  res.status(201).json({ success:true, data:msg });
});
