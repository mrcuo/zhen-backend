const crypto = require('crypto');

// XunHuPay config
const XUNHU_APPSECRET = process.env.XUNHU_APPSECRET;

// KV for device activation
let kv;
try { kv = require('@vercel/kv').kv; } catch (e) {}

/**
 * Verify XunHuPay callback signature
 */
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
  // CORS
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

    // XunHuPay requires us to verify the callback hash
    if (XUNHU_APPSECRET) {
      if (!verifyHash(params, XUNHU_APPSECRET)) {
        console.error('[Notify] Hash verification failed');
        return res.status(403).send('Hash verification failed');
      }
    }

    // Extract order info from callback
    const tradeOrderId = params.trade_order_id;
    const status = params.status; // 'OD' = success in XunHuPay
    const paymentSuccess = status === 'OD' || status === 'success';

    if (!paymentSuccess) {
      console.log('[Notify] Payment not successful, status:', status);
      return res.send('success'); // Acknowledge receipt even if not paid
    }

    console.log('[Notify] Payment confirmed for order:', tradeOrderId);

    // Look up order in KV to find the deviceId
    if (process.env.KV_REST_API_URL && kv) {
      const order = await kv.get(`order:${tradeOrderId}`);
      if (order && order.deviceId) {
        // Activate the user's device
        await kv.set(`device:${order.deviceId}`, {
          tier: 'basic',
          paidAt: Date.now(),
          orderId: tradeOrderId
        });
        // Update order status
        await kv.set(`order:${tradeOrderId}`, {
          ...order,
          status: 'success'
        }, { ex: 3600 * 24 * 30 }); // Keep for 30 days

        console.log('[Notify] Device activated:', order.deviceId);
      } else {
        console.error('[Notify] Order not found in KV:', tradeOrderId);
      }
    }

    // XunHuPay requires returning the string "success" to acknowledge
    return res.send('success');
  } catch (error) {
    console.error('Notify Error:', error);
    return res.status(500).send('error');
  }
}
