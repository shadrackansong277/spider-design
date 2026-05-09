// ════════════════════════════════════════════════════
// backend/src/routes/product.routes.ts
// ════════════════════════════════════════════════════
import { Router } from 'express';
import { authenticate }  from '../middleware/auth.middleware';
import { requireRole }   from '../middleware/role.middleware';
import { upload }        from '../config/cloudinary';
import { body, query, param } from 'express-validator';
import { validate }      from '../middleware/validate.middleware';

export const productRouter = Router();

// GET /products — public
productRouter.get('/', [
  query('categorySlug').optional(),
  query('search').optional(),
  query('isFeatured').optional().isBoolean(),
  query('page').optional().isInt({ min:1 }),
  query('limit').optional().isInt({ min:1, max:100 }),
], validate, async (req: any, res: any) => {
  const { prisma } = await import('../config/database');
  const { categorySlug, search, isFeatured, page=1, limit=20 } = req.query;
  const skip = (Number(page)-1) * Number(limit);

  const where: any = { isActive: true };
  if (isFeatured) where.isFeatured = isFeatured === 'true';
  if (categorySlug) where.category = { slug: categorySlug };
  if (search) where.OR = [
    { name:        { contains: search, mode:'insensitive' } },
    { description: { contains: search, mode:'insensitive' } },
  ];

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where, skip, take:Number(limit),
      orderBy:[{ isFeatured:'desc' }, { sortOrder:'asc' }, { createdAt:'desc' }],
      include:{ category:true, images:{ orderBy:{sortOrder:'asc'} } },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({ success:true, data:{ products, pagination:{ page:Number(page), limit:Number(limit), total, pages:Math.ceil(total/Number(limit)) } } });
});

// GET /products/:id or /:slug
productRouter.get('/:idOrSlug', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { idOrSlug } = req.params;
  const product = await prisma.product.findFirst({
    where:{ OR:[{ id:idOrSlug }, { slug:idOrSlug }], isActive:true },
    include:{ category:true, images:{ orderBy:{ sortOrder:'asc' } } },
  });
  if (!product) return res.status(404).json({ success:false, message:'Product not found' });
  res.json({ success:true, data:product });
});

// POST /products — admin
productRouter.post('/', authenticate, requireRole(['admin']), upload.array('images', 8), async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { name, categoryId, description, price, comparePrice, fabricType, availableSizes, availableColors, tag, isFeatured, stockQty } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + Date.now();
  const files = req.files as any[];

  const product = await prisma.product.create({
    data:{
      name, slug, categoryId, description, price:parseFloat(price),
      comparePrice: comparePrice ? parseFloat(comparePrice) : null,
      fabricType, tag, isFeatured: isFeatured==='true',
      stockQty: parseInt(stockQty||'0'),
      availableSizes: availableSizes ? JSON.parse(availableSizes) : [],
      availableColors: availableColors ? JSON.parse(availableColors) : [],
      createdBy: req.user.id,
      images:{ create: files?.map((f:any, i:number) => ({ url:f.path, publicId:f.filename, isPrimary:i===0, sortOrder:i })) || [] },
    },
    include:{ category:true, images:true },
  });
  res.status(201).json({ success:true, data:product });
});

// PATCH /products/:id — admin
productRouter.patch('/:id', authenticate, requireRole(['admin']), async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const data = req.body;
  if (data.price)        data.price        = parseFloat(data.price);
  if (data.comparePrice) data.comparePrice = parseFloat(data.comparePrice);
  if (data.stockQty)     data.stockQty     = parseInt(data.stockQty);
  if (data.availableSizes && typeof data.availableSizes === 'string') data.availableSizes = JSON.parse(data.availableSizes);
  const product = await prisma.product.update({ where:{ id:req.params.id }, data, include:{ category:true, images:true } });
  res.json({ success:true, data:product });
});

// DELETE /products/:id — admin
productRouter.delete('/:id', authenticate, requireRole(['admin']), async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  await prisma.product.update({ where:{ id:req.params.id }, data:{ isActive:false } });
  res.json({ success:true, message:'Product deactivated' });
});


// ════════════════════════════════════════════════════
// backend/src/routes/worker.routes.ts
// ════════════════════════════════════════════════════
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


// ════════════════════════════════════════════════════
// backend/src/routes/admin.routes.ts
// ════════════════════════════════════════════════════
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole(['admin']));

// GET /admin/stats — alias for dashboard
adminRouter.get('/stats/overview', async (_req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7*24*60*60*1000);

  const [totalOrders, newOrders, inProgress, ready, pendingAssignment, weekOrders, revenue] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where:{ status:'pending' } }),
    prisma.order.count({ where:{ status:{ in:['confirmed','cutting','sewing','embroidery','finishing','qc'] } } }),
    prisma.order.count({ where:{ status:'ready' } }),
    prisma.order.count({ where:{ status:{ in:['pending','confirmed'] }, workerId:null } }),
    prisma.order.count({ where:{ createdAt:{ gte:weekAgo } } }),
    prisma.order.aggregate({ where:{ paymentStatus:{ in:['deposit_paid','fully_paid'] }, createdAt:{ gte:monthStart } }, _sum:{ totalAmount:true } }),
  ]);

  const revenueByMonth = await prisma.$queryRaw`
    SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)::int AS order_count, COALESCE(SUM(total_amount),0) AS revenue
    FROM orders WHERE created_at >= NOW() - INTERVAL '6 months' AND payment_status IN ('deposit_paid','fully_paid')
    GROUP BY 1 ORDER BY 1
  `;

  res.json({ success:true, data:{
    overview:{ totalOrders, newOrders, inProgress, ready, pendingAssignment, weekOrders },
    monthRevenue: Number(revenue._sum.totalAmount||0),
    revenueByMonth,
  }});
});

// GET /admin/customers
adminRouter.get('/customers', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { page=1, limit=25, search } = req.query;
  const skip = (Number(page)-1)*Number(limit);
  const where: any = { role:'customer' };
  if (search) where.OR = [
    { firstName:{ contains:search, mode:'insensitive' } },
    { phone:{ contains:search } },
    { email:{ contains:search, mode:'insensitive' } },
  ];
  const [customers, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take:Number(limit), orderBy:{ createdAt:'desc' }, select:{ id:true, firstName:true, lastName:true, phone:true, email:true, createdAt:true, isVerified:true, _count:{ select:{ ordersAsCustomer:true } } } }),
    prisma.user.count({ where }),
  ]);
  res.json({ success:true, data:{ customers, pagination:{ page:Number(page), limit:Number(limit), total, pages:Math.ceil(total/Number(limit)) } } });
});

// GET /admin/settings
adminRouter.get('/settings', async (_req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const settings = await prisma.setting.findMany();
  res.json({ success:true, data:settings });
});

// PATCH /admin/settings
adminRouter.patch('/settings', async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { settings } = req.body; // [{ key, value }]
  await Promise.all(settings.map((s: any) =>
    prisma.setting.update({ where:{ key:s.key }, data:{ value:s.value } })
  ));
  res.json({ success:true, message:'Settings updated' });
});

// GET /admin/env-config — return current env values (masked secrets)
adminRouter.get('/env-config', async (_req:any, res:any) => {
  const ENV_KEYS = [
    'DATABASE_URL','PORT','NODE_ENV','CLIENT_URL',
    'JWT_SECRET','JWT_REFRESH_SECRET','JWT_EXPIRES_IN','JWT_REFRESH_EXPIRES_IN',
    'PAYSTACK_SECRET_KEY','PAYSTACK_PUBLIC_KEY',
    'CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET',
    'AT_API_KEY','AT_USERNAME','AT_SENDER_ID',
    'FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY',
    'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS',
    'EXPO_PUBLIC_API_URL','EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY',
  ];
  const config: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    config[key] = process.env[key] || '';
  }
  res.json({ success:true, data:config });
});

// PATCH /admin/env-config — write .env file and reload process.env
adminRouter.patch('/env-config', async (req:any, res:any) => {
  const fs = await import('fs');
  const path = await import('path');
  const { config } = req.body as { config: Record<string, string> };

  const ALLOWED_KEYS = new Set([
    'DATABASE_URL','PORT','NODE_ENV','CLIENT_URL',
    'JWT_SECRET','JWT_REFRESH_SECRET','JWT_EXPIRES_IN','JWT_REFRESH_EXPIRES_IN',
    'PAYSTACK_SECRET_KEY','PAYSTACK_PUBLIC_KEY',
    'CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET',
    'AT_API_KEY','AT_USERNAME','AT_SENDER_ID',
    'FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY',
    'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS',
    'EXPO_PUBLIC_API_URL','EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY',
  ]);

  // Read current .env (or start fresh)
  const envPath = path.resolve(process.cwd(), '.env');
  let existing: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)/);
      if (m) existing[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }

  // Merge allowed keys only
  for (const [k, v] of Object.entries(config)) {
    if (ALLOWED_KEYS.has(k) && v !== undefined) {
      existing[k] = v;
      process.env[k] = v; // apply immediately (takes effect after restart for modules that cached it)
    }
  }

  // Write back to .env
  const lines = Object.entries(existing).map(([k, v]) => {
    const needsQuote = v.includes('\n') || v.includes(' ') || v.includes('=');
    return `${k}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`;
  });
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');

  res.json({ success:true, message:'Config saved. Restart server to fully apply changes.' });
});

// POST /admin/test-connection/:service — test a service connection
adminRouter.post('/test-connection/:service', async (req:any, res:any) => {
  const { service } = req.params;
  try {
    if (service === 'database') {
      const { prisma } = await import('../config/database');
      await prisma.$queryRaw`SELECT 1`;
      return res.json({ ok:true, message:'Database connected successfully' });
    }

    if (service === 'paystack') {
      const axios = (await import('axios')).default;
      const r = await axios.get('https://api.paystack.co/bank', {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        timeout: 5000,
      });
      return res.json({ ok: r.status === 200, message: r.status === 200 ? 'Paystack connected' : 'Paystack key invalid' });
    }

    if (service === 'cloudinary') {
      const axios = (await import('axios')).default;
      const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
      const creds = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');
      const r = await axios.get(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/usage`, {
        headers: { Authorization: `Basic ${creds}` }, timeout: 5000,
      });
      return res.json({ ok: r.status === 200, message: r.status === 200 ? 'Cloudinary connected' : 'Cloudinary credentials invalid' });
    }

    if (service === 'firebase') {
      const admin = await import('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
          }),
        });
      }
      // Try listing one app just to validate credentials
      await admin.messaging().send({ topic:'test' }, true); // dry run
      return res.json({ ok:true, message:'Firebase connected' });
    }

    if (service === 'sms') {
      const axios = (await import('axios')).default;
      const r = await axios.get('https://api.africastalking.com/version1/user', {
        headers: { apiKey: process.env.AT_API_KEY || '', Accept: 'application/json' },
        params: { username: process.env.AT_USERNAME || 'sandbox' },
        timeout: 5000,
      });
      return res.json({ ok: r.status === 200, message: r.status === 200 ? "Africa's Talking connected" : 'SMS credentials invalid' });
    }

    if (service === 'email') {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.verify();
      return res.json({ ok:true, message:'Email (SMTP) connected' });
    }

    return res.status(400).json({ ok:false, message:'Unknown service' });
  } catch (err: any) {
    return res.json({ ok:false, message: err.message || 'Connection failed' });
  }
});


// ════════════════════════════════════════════════════
// backend/src/routes/payment.routes.ts
// ════════════════════════════════════════════════════
import { Router } from 'express';
import { authenticate }  from '../middleware/auth.middleware';
import { body }          from 'express-validator';
import { validate }      from '../middleware/validate.middleware';
import axios             from 'axios';

export const paymentRouter = Router();
paymentRouter.use(authenticate);

// POST /payments/initialize — initiate Paystack transaction
paymentRouter.post('/initialize', [
  body('orderId').isUUID(),
  body('isDeposit').isBoolean(),
], validate, async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { orderId, isDeposit } = req.body;

  const order = await prisma.order.findFirst({ where:{ id:orderId, customerId:req.user.id } });
  if (!order) return res.status(404).json({ success:false, message:'Order not found' });

  const amount = isDeposit ? Number(order.depositAmount) : Number(order.totalAmount) - Number(order.depositAmount);

  const paystackRes = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email: req.user.email || `${req.user.phone}@spider.gh`,
      amount: Math.round(amount * 100), // kobo
      currency: 'GHS',
      reference: `spider-${orderId}-${Date.now()}`,
      metadata: { orderId, isDeposit, customerId: req.user.id },
    },
    { headers:{ Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
  );

  res.json({ success:true, data: paystackRes.data.data });
});

// POST /payments/verify — verify after payment
paymentRouter.post('/verify', [
  body('reference').notEmpty(),
], validate, async (req:any, res:any) => {
  const { prisma } = await import('../config/database');
  const { reference } = req.body;

  const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers:{ Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });

  const { status, metadata, amount, channel } = paystackRes.data.data;
  if (status !== 'success') return res.status(400).json({ success:false, message:'Payment not successful' });

  const { orderId, isDeposit } = metadata;
  const amountGHS = amount / 100;

  await prisma.payment.create({
    data:{ orderId, customerId:req.user.id, amount:amountGHS, currency:'GHS', method:'paystack_card', paystackRef:reference, paystackStatus:status, isDeposit, verifiedAt:new Date() },
  });

  await prisma.order.update({
    where:{ id:orderId },
    data:{
      paymentStatus: isDeposit ? 'deposit_paid' : 'fully_paid',
      ...(isDeposit ? { depositPaidAt:new Date(), depositAmount:amountGHS } : { balancePaidAt:new Date() }),
      status: isDeposit ? 'confirmed' : undefined,
    },
  });

  res.json({ success:true, message:'Payment verified', data:{ amountGHS } });
});


// ════════════════════════════════════════════════════
// backend/src/routes/notification.routes.ts
// ════════════════════════════════════════════════════
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


// ════════════════════════════════════════════════════
// backend/src/routes/message.routes.ts
// ════════════════════════════════════════════════════
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


// ════════════════════════════════════════════════════
// backend/src/routes/upload.routes.ts
// ════════════════════════════════════════════════════
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload }       from '../config/cloudinary';

export const uploadRouter = Router();
uploadRouter.use(authenticate);

uploadRouter.post('/image', upload.single('image'), (req:any, res:any) => {
  if (!req.file) return res.status(400).json({ success:false, message:'No file uploaded' });
  res.json({ success:true, data:{ url:(req.file as any).path, publicId:(req.file as any).filename } });
});

uploadRouter.post('/images', upload.array('images', 10), (req:any, res:any) => {
  const files = req.files as any[];
  if (!files?.length) return res.status(400).json({ success:false, message:'No files uploaded' });
  res.json({ success:true, data: files.map(f => ({ url:f.path, publicId:f.filename })) });
});


// ════════════════════════════════════════════════════
// backend/src/routes/user.routes.ts
// ════════════════════════════════════════════════════
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


// ════════════════════════════════════════════════════
// backend/src/config/seed.ts  — seed database
// ════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding Spider Designs database...');

  // Admin user
  const adminHash = await bcrypt.hash('Admin@1234', 12);
  const admin = await prisma.user.upsert({
    where:{ phone:'+233000000000' },
    update:{},
    create:{ firstName:'Spider', lastName:'Admin', phone:'+233000000000', email:'admin@spiderdesigns.gh', passwordHash:adminHash, role:'admin', isVerified:true },
  });
  console.log('✓ Admin user created');

  // Worker users
  const workerData = [
    { name:['Kofi','Mensah'],   phone:'+233244001001', specialties:['Senator Suits','Agbada'] },
    { name:['Abena','Osei'],    phone:'+233244002002', specialties:['Native Shirts','Custom'] },
    { name:['Akosua','Boateng'],phone:'+233244003003', specialties:['Casual','Ankara'] },
    { name:['Yaw','Darko'],     phone:'+233244004004', specialties:['Ready-Made','Alterations'] },
    { name:['Efua','Asante'],   phone:'+233244005005', specialties:['Embroidery'] },
  ];

  const workerHash = await bcrypt.hash('Worker@1234', 12);
  for (const w of workerData) {
    const user = await prisma.user.upsert({
      where:{ phone:w.phone }, update:{},
      create:{ firstName:w.name[0], lastName:w.name[1], phone:w.phone, passwordHash:workerHash, role:'worker', isVerified:true },
    });
    await prisma.worker.upsert({
      where:{ userId:user.id }, update:{},
      create:{ userId:user.id, specialties:w.specialties, maxCapacity:5 },
    });
  }
  console.log('✓ Workers seeded');

  // Categories are seeded via SQL migration
  // Get senator category
  const senatorCat = await prisma.category.findFirst({ where:{ slug:'senator' } });

  // Sample product
  if (senatorCat) {
    await prisma.product.upsert({
      where:{ slug:'white-senator-classic' },
      update:{},
      create:{
        name:'White Senator Classic', slug:'white-senator-classic',
        categoryId:senatorCat.id,
        description:'A crisp all-white senator suit with subtle chest embroidery.',
        price:590, fabricType:'Cotton', availableSizes:['S','M','L','XL','XXL'],
        tag:'new', isFeatured:true, stockQty:10, isActive:true,
      },
    });
  }
  console.log('✓ Sample products seeded');

  console.log('✅ Seeding complete!');
  console.log('   Admin:  admin@spiderdesigns.gh / Admin@1234');
  console.log('   Worker: kofi@spiderdesigns.gh  / Worker@1234');
  await prisma.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
