export async function sendPushNotification(fcmToken: string, title: string, body: string, data: Record<string,string> = {}): Promise<void> {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) return;
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      })});
    }
    await admin.messaging().send({ token:fcmToken, notification:{ title, body }, data: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])), android:{ priority:'high' } });
  } catch (err) { console.error('Push notification failed:', err); }
}
