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
