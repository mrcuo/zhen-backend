const crypto = require('crypto');
const Redis = require('ioredis');

const XUNHU_APPSECRET = process.env.XUNHU_APPSECRET;

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
}

function verifyHash(params, appSecret) {
  const receivedHash = params.hash;
  const keys = Object.keys(params).sort();
  const parts = keys
    .filter(k => k !== 'hash' && params[k] !== null && params[k] !== '' && params[k] !== undefined)
    .map(k => `${k}=${params[k]}`);
  const signStr = parts.join('&') + appSecret;
  const expectedHash = crypto.createHash('md5').update(signStr).digest('hex');
  return receivedHash === expectedHash;
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
    const params = req.body;

    if (XUNHU_APPSECRET) {
      if (!verifyHash(params, XUNHU_APPSECRET)) {
        console.error('[Notify] Hash verification failed');
        return res.status(403).send('Hash verification failed');
      }
    }

    const tradeOrderId = params.trade_order_id;
    const status = params.status;
    const paymentSuccess = status === 'OD' || status === 'success';

    if (!paymentSuccess) {
      return res.send('success');
    }

    if (redis) {
      const orderData = await redis.get(`order:${tradeOrderId}`);
      if (orderData) {
        const order = JSON.parse(orderData);
        if (order.deviceId) {
          await redis.set(`device:${order.deviceId}`, JSON.stringify({
            tier: 'basic',
            paidAt: Date.now(),
            orderId: tradeOrderId
          }));
          await redis.set(`order:${tradeOrderId}`, JSON.stringify({
            ...order,
            status: 'success'
          }), 'EX', 3600 * 24 * 30);
        }
      }
    }

    return res.send('success');
  } catch (error) {
    console.error('Notify Error:', error);
    return res.status(500).send('error');
  }
}
