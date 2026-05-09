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
