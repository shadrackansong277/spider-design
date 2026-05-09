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
