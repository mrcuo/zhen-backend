const crypto = require('crypto');
const Redis = require('ioredis');

// Afdian Config
const AFDIAN_USER_ID = process.env.AFDIAN_USER_ID;

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { deviceId, plan } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    const outTradeNo = `ZHEN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let qrCodeUrl = '';

    if (AFDIAN_USER_ID) {
      // Create Afdian payment URL
      const afdianUrl = `https://ifdian.net/order/create?user_id=${AFDIAN_USER_ID}&custom_order_id=${outTradeNo}`;
      // We generate a QR code for this URL using the free qrserver API, so the user can scan it with their phone
      qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(afdianUrl)}`;
    } else {
      console.log('[Mock] No AFDIAN keys configured. Using mock QR code.');
      const mockPayUrl = `https://${req.headers.host}/api/mock-pay?orderId=${outTradeNo}&deviceId=${deviceId}`;
      qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(mockPayUrl)}`;
    }

    if (redis) {
      await redis.set(`order:${outTradeNo}`, JSON.stringify({
        deviceId,
        plan: plan || 'basic',
        status: 'pending',
        createdAt: Date.now()
      }), 'EX', 3600);
    }

    return res.status(200).json({
      orderId: outTradeNo,
      qrCodeUrl: qrCodeUrl,
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
