// ════════════════════════════════════════
// src/services/notification.service.ts
// ════════════════════════════════════════
import { prisma }              from '../config/database';
import { sendPushNotification } from './push.service';
import { sendSms }              from './sms.service';

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  order_confirmed:  { title: 'Order Confirmed ✦', body: 'Your order has been confirmed and assigned to a tailor.' },
  status_update:    { title: 'Order Update', body: 'Your order status has been updated.' },
  ready_for_pickup: { title: 'Ready for Pickup! 🎉', body: 'Your garment is ready. Come pick it up or we\'ll deliver soon.' },
  payment_received: { title: 'Payment Received ✓', body: 'We\'ve received your payment. Thank you!' },
  worker_assigned:  { title: 'Tailor Assigned', body: 'A tailor has been assigned to your order and work begins soon.' },
};

const STATUS_SMS: Record<string, string> = {
  cutting:         'Your Spider Designs order is now being cut. We\'ll keep you updated!',
  sewing:          'Great news! Your garment is now being sewn. Stay tuned.',
  qc:              'Your order has passed quality check and is almost ready!',
  ready:           'Your Spider Designs garment is READY! Visit us to collect or await delivery.',
  out_for_delivery:'Your order is on its way! Our rider will contact you shortly.',
  delivered:       'Order delivered! We hope you love it. Thank you for choosing Spider Designs.',
};

export async function sendOrderNotification(order: any, type: string, io: any) {
  try {
    const msg = STATUS_MESSAGES[type] || { title: 'Order Update', body: 'Your order has been updated.' };

    // Save to DB
    const notification = await prisma.notification.create({
      data: {
        userId: order.customerId || order.customer?.id,
        type: type as any,
        title: msg.title,
        body: msg.body,
        data: { orderId: order.id, orderNumber: order.orderNumber, status: order.status },
      },
    });

    // Push notification
    const customer = await prisma.user.findUnique({ where: { id: order.customerId || order.customer?.id } });
    if (customer?.fcmToken) {
      await sendPushNotification(customer.fcmToken, msg.title, msg.body, { orderId: order.id });
      await prisma.notification.update({ where: { id: notification.id }, data: { sentPush: true } });
    }

    // SMS for key status changes
    const smsText = STATUS_SMS[order.status];
    if (smsText && customer?.phone) {
      await sendSms(customer.phone, `Spider Designs: ${smsText} Order: ${order.orderNumber}`);
      await prisma.notification.update({ where: { id: notification.id }, data: { sentSms: true } });
    }

    // Socket.io real-time update
    if (io) {
      io.to(`customer:${order.customerId || order.customer?.id}`).emit('order:updated', {
        orderId: order.id, orderNumber: order.orderNumber,
        status: order.status, notification: msg,
      });
    }
  } catch (err) {
    console.error('Notification error:', err);
    // Non-fatal — log but don't crash the order flow
  }
}
