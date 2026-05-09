// ════════════════════════════════════════
// src/services/sms.service.ts
// ════════════════════════════════════════
import AfricasTalking from 'africastalking';

let at: any = null;
let smsService: any = null;

function getAT() {
  if (!at) {
    at = AfricasTalking({
      apiKey:   process.env.AT_API_KEY!,
      username: process.env.AT_USERNAME || 'sandbox',
    });
    smsService = at.SMS;
  }
  return smsService;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  try {
    const sms = getAT();
    // Normalise Ghana number to +233 format
    const normalised = phone.startsWith('0') ? '+233' + phone.slice(1) : phone;
    await sms.send({ to: normalised, message, from: process.env.AT_SENDER_ID || 'SpiderGH' });
  } catch (err) {
    console.error('SMS send failed:', err);
    // Non-fatal
  }
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  const message = `Your Spider Designs verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
  await sendSms(phone, message);
}


// ════════════════════════════════════════
// src/services/push.service.ts
// ════════════════════════════════════════
import admin from 'firebase-admin';

let firebaseInitialised = false;

function initFirebase() {
  if (firebaseInitialised) return;
  if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    firebaseInitialised = true;
  }
}

export async function sendPushNotification(
  fcmToken: string, title: string, body: string, data: Record<string, string> = {}
): Promise<void> {
  try {
    initFirebase();
    if (!firebaseInitialised) return;
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k,v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (err) {
    console.error('Push notification failed:', err);
  }
}


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

  const base = basePrice || 450; // default minimum if not set

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
  const year = new Date().getFullYear();
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
