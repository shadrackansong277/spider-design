import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';

export const workerRouter = Router();

workerRouter.use(authenticate);

// GET /workers — list all workers (admin)
workerRouter.get('/', requireRole(['admin']), async (_req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const workers = await prisma.worker.findMany({
    include:{
      user:{ select:{ id:true, firstName:true, lastName:true, phone:true, avatarUrl:true } },
      _count:{ select:{ orders:true } },
    },
    orderBy:{ joinedAt:'asc' },
  });
  // Enrich with active order count
  const enriched = await Promise.all(workers.map(async w => {
    const active = await prisma.order.count({ where:{ workerId:w.id, status:{ notIn:['delivered','cancelled'] } } });
    return { ...w, activeOrders:active };
  }));
  res.json({ success:true, data:{ workers:enriched } });
});

// GET /workers/my-queue — for logged-in worker
workerRouter.get('/my-queue', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const worker = await prisma.worker.findFirst({ where:{ userId:req.user.id } });
  if (!worker) return res.status(404).json({ success:false, message:'Worker profile not found' });

  const orders = await prisma.order.findMany({
    where:{ workerId:worker.id, status:{ notIn:['delivered','cancelled'] } },
    include:{ customer:{ select:{ firstName:true, lastName:true, phone:true } }, images:true },
    orderBy:{ dueDate:'asc' },
  });
  res.json({ success:true, data:{ worker, orders } });
});

// PATCH /workers/:id — update worker capacity/availability
workerRouter.patch('/:id', requireRole(['admin']), async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { maxCapacity, isAvailable, specialties } = req.body;
  const worker = await prisma.worker.update({
    where:{ id:req.params.id },
    data:{ maxCapacity, isAvailable, specialties },
    include:{ user:{ select:{ firstName:true, lastName:true } } },
  });
  res.json({ success:true, data:worker });
});
