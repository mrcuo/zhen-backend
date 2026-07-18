const Redis = require('ioredis');
const crypto = require('crypto');

const AFDIAN_USER_ID = process.env.AFDIAN_USER_ID;
const AFDIAN_TOKEN = process.env.AFDIAN_TOKEN;

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
}

async function queryAfdianOrder(page = 1) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsStr = JSON.stringify({ page });
  const signStr = `${AFDIAN_TOKEN}params${paramsStr}ts${ts}user_id${AFDIAN_USER_ID}`;
  const sign = crypto.createHash('md5').update(signStr).digest('hex');

  const res = await fetch('https://ifdian.net/api/open/query-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: AFDIAN_USER_ID,
      params: paramsStr,
      ts,
      sign
    })
  });
  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const payload = req.body;
    
    // Log the payload for debugging
    console.log('[Afdian Webhook] Received:', JSON.stringify(payload));

    if (!payload || !payload.data || payload.data.type !== 'order') {
      return res.status(400).send('Ignore non-order webhook');
    }

    const orderData = payload.data.order;
    if (!orderData || orderData.status !== 2) {
      return res.status(200).send('Order not paid');
    }

    const outTradeNo = orderData.custom_order_id;
    if (!outTradeNo || !outTradeNo.startsWith('ZHEN_')) {
      console.log('Ignored order without valid ZHEN custom_order_id');
      return res.status(200).send('success');
    }

    // Verify order using Afdian API
    if (AFDIAN_USER_ID && AFDIAN_TOKEN) {
      const apiRes = await queryAfdianOrder(1);
      
      let isValid = false;
      if (apiRes && apiRes.data && apiRes.data.list) {
        // Check if the order is in the recent list
        isValid = apiRes.data.list.some(o => o.out_trade_no === orderData.out_trade_no);
      }
      
      if (!isValid) {
        console.error('[Afdian Webhook] Security Warning: Order not found in recent API query!');
        return res.status(400).send('Order verification failed');
      }
    }

    if (!redis) {
      console.error('Redis not configured, cannot unlock device');
      return res.status(500).send('Redis error');
    }

    // Retrieve pending order from Redis
    const orderStr = await redis.get(`order:${outTradeNo}`);
    if (!orderStr) {
      console.error(`Order ${outTradeNo} not found in Redis`);
      return res.status(200).send('success');
    }

    const order = JSON.parse(orderStr);
    const deviceId = order.deviceId;

    // Mark order as paid
    order.status = 'paid';
    await redis.set(`order:${outTradeNo}`, JSON.stringify(order), 'EX', 86400 * 7);

    // Update device tier to pro or premium
    const deviceKey = `device:${deviceId}`;
    const deviceStr = await redis.get(deviceKey);
    let deviceState = deviceStr ? JSON.parse(deviceStr) : { deviceId };
    
    if (order.plan === 'premium') {
      deviceState.tier = 'premium';
      deviceState.expiresAt = Date.now() + 31 * 24 * 60 * 60 * 1000; // 31 days
    } else {
      deviceState.tier = 'pro';
      // Basic plan has no expiration
      if (deviceState.expiresAt) {
        delete deviceState.expiresAt;
      }
    }
    
    deviceState.updatedAt = Date.now();
    await redis.set(deviceKey, JSON.stringify(deviceState));
    
    console.log(`[Afdian Webhook] Successfully unlocked device ${deviceId} to ${deviceState.tier} via order ${outTradeNo}`);

    return res.status(200).json({ ec: 200, em: '' });
  } catch (error) {
    console.error('[Afdian Webhook Error]:', error);
    return res.status(500).send('Internal Error');
  }
}
