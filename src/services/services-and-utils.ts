// ════════════════════════════════════════
// src/utils/pricing.ts
// ════════════════════════════════════════
interface PricingInput {
  basePrice: number;
  urgency:   string;
  embroideryStyle?: string;
  deliveryType: string;
  settingsMap: Record<string, number>;
}

export function calculateOrderPrice(input: PricingInput) {
  const { basePrice, urgency, embroideryStyle, deliveryType, settingsMap } = input;
  const base = basePrice || 450;
  const expressPct = settingsMap['express_surcharge_pct'] || 30;
  const rushPct    = settingsMap['rush_surcharge_pct']    || 60;
  const delivFee   = settingsMap['delivery_fee_accra']    || 50;
  const embSimple  = settingsMap['embroidery_simple']     || 80;
  const embFull    = settingsMap['embroidery_full']       || 180;
  const depositPct = settingsMap['deposit_percentage']    || 50;
  const expressFee = urgency === 'express' ? (base * expressPct / 100) :
                     urgency === 'rush'    ? (base * rushPct    / 100) : 0;
  const embroideryFee = embroideryStyle?.toLowerCase().includes('simple') ? embSimple :
                        embroideryStyle?.toLowerCase().includes('full')   ? embFull   : 0;
  const deliveryFee = deliveryType === 'delivery' ? delivFee : 0;
  const subtotal = base + expressFee + embroideryFee;
  const total    = subtotal + deliveryFee;
  const deposit  = Math.ceil((total * depositPct) / 100);
  return { basePrice: base, expressFee, embroideryFee, deliveryFee, subtotal, total, deposit };
}


// ════════════════════════════════════════
// src/utils/orderNumber.ts
// ════════════════════════════════════════
export async function generateOrderNumber(prisma: any): Promise<string> {
  const year  = new Date().getFullYear();
  const count = await prisma.order.count();
  const seq   = String(count + 1000 + 1).padStart(4, '0');
  return `SD-${year}-${seq}`;
}


// ════════════════════════════════════════
// src/utils/AppError.ts
// ════════════════════════════════════════
export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}
