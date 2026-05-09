interface PricingInput {
  basePrice: number; urgency: string;
  embroideryStyle?: string; deliveryType: string;
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
  const expressFee = urgency==='express' ? base*expressPct/100 : urgency==='rush' ? base*rushPct/100 : 0;
  const embroideryFee = embroideryStyle?.includes('simple') ? embSimple : embroideryStyle?.includes('full') ? embFull : 0;
  const deliveryFee = deliveryType==='delivery' ? delivFee : 0;
  const total = base + expressFee + embroideryFee + deliveryFee;
  const deposit = Math.ceil(total * depositPct / 100);
  return { basePrice:base, expressFee, embroideryFee, deliveryFee, total, deposit };
}
