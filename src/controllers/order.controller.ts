import { Request, Response } from 'express';
import { prisma }            from '../config/database';
import { AppError }          from '../utils/AppError';
import { sendOrderNotification } from '../services/notification.service';
import { generateOrderNumber }   from '../utils/orderNumber';
import { calculateOrderPrice }   from '../utils/pricing';

// ─────────────────────────────────────────────────
// POST /orders  — Create a new order
// ─────────────────────────────────────────────────
export const createOrder = async (req: any, res: Response) => {
  const {
    orderType, productId, productSize,
    garmentType, fabricType, fabricColor,
    embroideryStyle, specialNotes, styleDescription,
    urgency = 'standard', deliveryType = 'pickup',
    deliveryAddress, dueDate, paymentMethod,
    paymentPlan = 'deposit',
    // measurements
    measurementId, chest, shoulder, sleeve, waist,
    hip, thigh, inseam, totalLength, trouserWaist, trouserLength,
  } = req.body;

  // Get pricing settings
  const settings = await prisma.setting.findMany({
    where: { key: { in: ['express_surcharge_pct','rush_surcharge_pct','delivery_fee_accra','embroidery_simple','embroidery_full','deposit_percentage'] } },
  });
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, parseFloat(s.value)]));

  // Get base price from product if ready_made
  let basePrice = 0;
  if (orderType === 'ready_made' && productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Product not found.', 404);
    basePrice = Number(product.price);
  }

  const pricing = calculateOrderPrice({ basePrice, urgency, embroideryStyle, deliveryType, settingsMap });

  const orderNumber = await generateOrderNumber(prisma);

  const order = await prisma.order.create({
    data: {
      orderNumber,
      customerId: req.user.id,
      orderType,
      productId: productId || null,
      productSize: productSize || null,
      garmentType,
      fabricType,
      fabricColor,
      embroideryStyle,
      specialNotes,
      styleDescription,
      urgency,
      deliveryType,
      deliveryAddress,
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentMethod,
      measurementId: measurementId || null,
      chest, shoulder, sleeve, waist, hip, thigh, inseam,
      totalLength, trouserWaist, trouserLength,
      basePrice: pricing.basePrice,
      expressFee: pricing.expressFee,
      embroideryFee: pricing.embroideryFee,
      deliveryFee: pricing.deliveryFee,
      totalAmount: pricing.total,
      depositAmount: pricing.deposit,
      status: 'pending',
      paymentStatus: 'unpaid',
    },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      product: { include: { images: { where: { isPrimary: true } } } },
    },
  });

  // Log initial status
  await prisma.orderStatusHistory.create({
    data: { orderId: order.id, status: 'pending', changedBy: req.user.id, note: 'Order submitted by customer' },
  });

  // Send confirmation notification
  await sendOrderNotification(order, 'order_confirmed', req.io);

  res.status(201).json({
    success: true,
    message: `Order ${orderNumber} created. Please complete your deposit payment.`,
    data: { order, pricing },
  });
};

// ─────────────────────────────────────────────────
// GET /orders/my
// ─────────────────────────────────────────────────
export const getMyOrders = async (req: any, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = { customerId: req.user.id };
  if (status) where.status = status;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { include: { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
        product: { include: { images: { where: { isPrimary: true }, take: 1 } } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        images: true,
      },
    }),
    prisma.order.count({ where }),
  ]);

  res.json({
    success: true,
    data: { orders, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } },
  });
};

// ─────────────────────────────────────────────────
// GET /orders/:id
// ─────────────────────────────────────────────────
export const getOrderById = async (req: any, res: Response) => {
  const { id } = req.params;

  const where: any = { id };
  // Customers can only see their own orders
  if (req.user.role === 'customer') where.customerId = req.user.id;

  const order = await prisma.order.findFirst({
    where,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      worker: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, phone: true } } } },
      product: { include: { images: true } },
      statusHistory: { orderBy: { createdAt: 'asc' }, include: { changedByUser: { select: { firstName: true, role: true } } } },
      images: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 50, include: { sender: { select: { firstName: true, role: true } } } },
      payments: true,
      review: true,
    },
  });

  if (!order) throw new AppError('Order not found.', 404);
  res.json({ success: true, data: order });
};

// ─────────────────────────────────────────────────
// POST /orders/:id/cancel
// ─────────────────────────────────────────────────
export const cancelOrder = async (req: any, res: Response) => {
  const { id }     = req.params;
  const { reason } = req.body;

  const order = await prisma.order.findFirst({
    where: { id, ...(req.user.role === 'customer' ? { customerId: req.user.id } : {}) },
  });
  if (!order) throw new AppError('Order not found.', 404);

  const cancellable: string[] = ['pending', 'confirmed'];
  if (!cancellable.includes(order.status)) {
    throw new AppError('Order cannot be cancelled at this stage. Please contact us.', 400);
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: 'cancelled', cancelledReason: reason, cancelledAt: new Date() },
  });

  await prisma.orderStatusHistory.create({
    data: { orderId: id, status: 'cancelled', changedBy: req.user.id, note: reason },
  });

  res.json({ success: true, message: 'Order cancelled.', data: updated });
};

// ─────────────────────────────────────────────────
// POST /orders/:id/images
// ─────────────────────────────────────────────────
export const uploadOrderImages = async (req: any, res: Response) => {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[] & { path: string; filename: string }[];

  if (!files || !files.length) throw new AppError('No images uploaded.', 400);

  const order = await prisma.order.findFirst({
    where: { id, customerId: req.user.id },
  });
  if (!order) throw new AppError('Order not found.', 404);

  const images = await Promise.all(
    files.map((f: any) =>
      prisma.orderImage.create({
        data: { orderId: id, url: f.path, publicId: f.filename, label: 'reference' },
      })
    )
  );

  res.status(201).json({ success: true, data: images });
};

// ─────────────────────────────────────────────────
// GET /orders (admin) — all orders with filters
// ─────────────────────────────────────────────────
export const getAllOrders = async (req: any, res: Response) => {
  const { status, workerId, orderType, page = 1, limit = 25, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: any = {};
  if (status)    where.status    = status;
  if (workerId)  where.workerId  = workerId;
  if (orderType) where.orderType = orderType;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customer: { firstName: { contains: search, mode: 'insensitive' } } },
      { customer: { lastName:  { contains: search, mode: 'insensitive' } } },
      { customer: { phone:     { contains: search } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, skip, take: Number(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        worker: { include: { user: { select: { firstName: true, lastName: true } } } },
        product: { include: { images: { where: { isPrimary: true }, take: 1 } } },
        _count: { select: { messages: true, images: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  res.json({
    success: true,
    data: { orders, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } },
  });
};

// ─────────────────────────────────────────────────
// GET /orders/stats/overview  (admin dashboard)
// ─────────────────────────────────────────────────
export const getOrderStats = async (_req: any, res: Response) => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1); // first of month

  const [
    totalOrders, newOrders, inProgress, ready, delivered,
    monthRevenue, pendingAssignment, weekOrders,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: 'pending' } }),
    prisma.order.count({ where: { status: { in: ['confirmed','cutting','sewing','embroidery','finishing','qc'] } } }),
    prisma.order.count({ where: { status: 'ready' } }),
    prisma.order.count({ where: { status: 'delivered', deliveredAt: { gte: start } } }),
    prisma.order.aggregate({ where: { paymentStatus: { in: ['deposit_paid','fully_paid'] }, createdAt: { gte: start } }, _sum: { totalAmount: true } }),
    prisma.order.count({ where: { status: 'confirmed', workerId: null } }),
    prisma.order.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } } }),
  ]);

  // Monthly revenue breakdown (last 6 months)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const revenueByMonth = await prisma.$queryRaw`
    SELECT
      DATE_TRUNC('month', created_at) AS month,
      COUNT(*)::int                   AS order_count,
      COALESCE(SUM(total_amount), 0)  AS revenue
    FROM orders
    WHERE created_at >= ${sixMonthsAgo}
      AND payment_status IN ('deposit_paid', 'fully_paid')
    GROUP BY 1
    ORDER BY 1
  `;

  // Worker performance
  const workerStats = await prisma.worker.findMany({
    include: {
      user: { select: { firstName: true, lastName: true } },
      _count: { select: { orders: true } },
    },
  });

  res.json({
    success: true,
    data: {
      overview: { totalOrders, newOrders, inProgress, ready, delivered, pendingAssignment, weekOrders },
      monthRevenue: Number(monthRevenue._sum.totalAmount || 0),
      revenueByMonth,
      workerStats,
    },
  });
};

// ─────────────────────────────────────────────────
// PATCH /orders/:id/assign  (admin)
// ─────────────────────────────────────────────────
export const assignWorker = async (req: any, res: Response) => {
  const { id }       = req.params;
  const { workerId } = req.body;

  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) throw new AppError('Worker not found.', 404);

  // Check capacity
  const activeCount = await prisma.order.count({
    where: { workerId, status: { notIn: ['delivered','cancelled','ready'] } },
  });
  if (activeCount >= worker.maxCapacity) {
    throw new AppError(`${worker.id} is at full capacity. Please choose another worker.`, 400);
  }

  const order = await prisma.order.update({
    where: { id },
    data: { workerId, assignedBy: req.user.id, assignedAt: new Date(), status: 'confirmed' },
    include: { customer: true, worker: { include: { user: true } } },
  });

  await prisma.orderStatusHistory.create({
    data: { orderId: id, status: 'confirmed', changedBy: req.user.id, note: `Assigned to ${order.worker?.user.firstName}` },
  });

  await sendOrderNotification(order, 'worker_assigned', req.io);

  res.json({ success: true, message: 'Worker assigned.', data: order });
};

// ─────────────────────────────────────────────────
// PATCH /orders/:id/status  (admin + worker)
// ─────────────────────────────────────────────────
export const updateOrderStatus = async (req: any, res: Response) => {
  const { id }          = req.params;
  const { status, note } = req.body;

  // Workers can only update their own assigned orders
  const where: any = { id };
  if (req.user.role === 'worker') {
    const worker = await prisma.worker.findFirst({ where: { userId: req.user.id } });
    if (!worker) throw new AppError('Worker profile not found.', 403);
    where.workerId = worker.id;
  }

  const order = await prisma.order.update({
    where,
    data: {
      status,
      ...(status === 'delivered' ? { deliveredAt: new Date() } : {}),
    },
    include: { customer: true, worker: { include: { user: true } } },
  });

  await prisma.orderStatusHistory.create({
    data: { orderId: id, status, changedBy: req.user.id, note },
  });

  // Update worker completed count on delivery
  if (status === 'delivered' && order.workerId) {
    await prisma.worker.update({
      where: { id: order.workerId },
      data: { totalCompleted: { increment: 1 } },
    });
  }

  await sendOrderNotification(order, 'status_update', req.io);

  res.json({ success: true, message: `Order status updated to ${status}.`, data: order });
};

// ─────────────────────────────────────────────────
// POST /orders/:id/notes  (admin)
// ─────────────────────────────────────────────────
export const addOrderNote = async (req: any, res: Response) => {
  const { id }   = req.params;
  const { note } = req.body;

  const history = await prisma.orderStatusHistory.create({
    data: { orderId: id, status: 'pending', changedBy: req.user.id, note }, // status kept as current
  });

  res.json({ success: true, data: history });
};
