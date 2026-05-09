import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get('/', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const notifs = await prisma.notification.findMany({
    where:{ userId:req.user.id },
    orderBy:{ createdAt:'desc' },
    take: 30,
  });
  const unread = await prisma.notification.count({ where:{ userId:req.user.id, isRead:false } });
  res.json({ success:true, data:{ notifications:notifs, unread } });
});

notificationRouter.patch('/mark-all-read', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  await prisma.notification.updateMany({ where:{ userId:req.user.id, isRead:false }, data:{ isRead:true } });
  res.json({ success:true });
});
