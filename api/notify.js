const Redis = require('ioredis');
const Afdian = require('afdian-api');

const AFDIAN_USER_ID = process.env.AFDIAN_USER_ID;
const AFDIAN_TOKEN = process.env.AFDIAN_TOKEN;

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
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
      const afdian = new Afdian({ userId: AFDIAN_USER_ID, token: AFDIAN_TOKEN });
      const apiRes = await afdian.queryOrder(1);
      
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

    // Update device tier to pro
    const deviceKey = `device:${deviceId}`;
    const deviceStr = await redis.get(deviceKey);
    let deviceState = deviceStr ? JSON.parse(deviceStr) : { deviceId };
    
    deviceState.tier = 'pro';
    deviceState.updatedAt = Date.now();
    await redis.set(deviceKey, JSON.stringify(deviceState));
    
    console.log(`[Afdian Webhook] Successfully unlocked device ${deviceId} via order ${outTradeNo}`);

    return res.status(200).json({ ec: 200, em: '' });
  } catch (error) {
    console.error('[Afdian Webhook Error]:', error);
    return res.status(500).send('Internal Error');
  }
}
