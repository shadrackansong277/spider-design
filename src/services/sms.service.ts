export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendSms(phone: string, message: string): Promise<void> {
  try {
    const AfricasTalking = require('africastalking');
    const at = AfricasTalking({ apiKey: process.env.AT_API_KEY!, username: process.env.AT_USERNAME || 'sandbox' });
    const normalised = phone.startsWith('0') ? '+233' + phone.slice(1) : phone;
    await at.SMS.send({ to: normalised, message, from: process.env.AT_SENDER_ID || 'SpiderGH' });
  } catch (err) { console.error('SMS send failed:', err); }
}

export async function sendOtpSms(phone: string, otp: string): Promise<void> {
  await sendSms(phone, `Spider Designs verification code: ${otp}. Valid for 10 minutes.`);
}
