import { Router }       from 'express';
import { body, param, query } from 'express-validator';
import { validate }     from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';
import { upload }       from '../config/cloudinary';
import {
  createOrder, getMyOrders, getOrderById, cancelOrder,
  uploadOrderImages, getAllOrders, assignWorker,
  updateOrderStatus, getOrderStats, addOrderNote,
} from '../controllers/order.controller';

export const orderRouter = Router();
orderRouter.use(authenticate);

orderRouter.post('/', [
  body('orderType').isIn(['ready_made','custom']),
  body('garmentType').trim().notEmpty().withMessage('Garment type is required'),
  body('urgency').optional().isIn(['standard','express','rush']),
  body('deliveryType').optional().isIn(['pickup','delivery']),
  body('dueDate').optional().isISO8601(),
  body('paymentMethod').notEmpty().withMessage('Payment method is required'),
], validate, createOrder);

orderRouter.get('/my', getMyOrders);
orderRouter.get('/stats/overview', requireRole(['admin']), getOrderStats);
orderRouter.get('/', requireRole(['admin']), [
  query('status').optional(),
  query('workerId').optional().isUUID(),
  query('page').optional().isInt({ min:1 }),
  query('limit').optional().isInt({ min:1, max:100 }),
], validate, getAllOrders);
orderRouter.get('/:id', [param('id').isUUID()], validate, getOrderById);
orderRouter.post('/:id/cancel', [param('id').isUUID()], validate, cancelOrder);
orderRouter.post('/:id/images', upload.array('images', 5), uploadOrderImages);
orderRouter.patch('/:id/assign', requireRole(['admin']), [param('id').isUUID(), body('workerId').isUUID()], validate, assignWorker);
orderRouter.patch('/:id/status', requireRole(['admin','worker']), [param('id').isUUID(), body('status').isIn(['confirmed','cutting','sewing','embroidery','finishing','qc','ready','out_for_delivery','delivered'])], validate, updateOrderStatus);
orderRouter.post('/:id/notes', requireRole(['admin']), [param('id').isUUID(), body('note').trim().notEmpty()], validate, addOrderNote);
