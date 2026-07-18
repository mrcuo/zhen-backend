const Redis = require('ioredis');
const crypto = require('crypto');

const AFDIAN_USER_ID = process.env.AFDIAN_USER_ID;
const AFDIAN_TOKEN = process.env.AFDIAN_TOKEN;

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
}

async function queryAfdianOrder(outTradeNo) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsStr = JSON.stringify({ out_trade_no: outTradeNo });
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
  // CORS configuration
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

  const { deviceId, orderId } = req.body;

  if (!deviceId || !orderId) {
    return res.status(400).json({ error: 'Missing deviceId or orderId' });
  }

  try {
    if (!redis) {
      return res.status(500).json({ error: 'Redis is not configured' });
    }

    if (!AFDIAN_USER_ID || !AFDIAN_TOKEN) {
      return res.status(500).json({ error: 'Afdian is not configured' });
    }

    // Ensure they don't abuse rate limits
    const throttleKey = `restore_throttle:${deviceId}`;
    const attempts = await redis.incr(throttleKey);
    if (attempts === 1) {
      await redis.expire(throttleKey, 60); // Max attempts per minute
    }
    if (attempts > 5) {
      return res.status(429).json({ error: '请求太频繁，请稍后再试' });
    }

    // Verify order using Afdian API
    const apiRes = await queryAfdianOrder(orderId.trim());
    
    let paidOrder = null;
    if (apiRes && apiRes.data && apiRes.data.list) {
      paidOrder = apiRes.data.list.find(o => o.out_trade_no === orderId.trim());
    }
    
    if (!paidOrder || paidOrder.status !== 2) {
      return res.status(400).json({ error: '未找到该订单或订单未付款' });
    }

    // Limit how many devices a single order can restore (e.g., 3 devices) to prevent sharing
    const usageKey = `order_usage:${orderId}`;
    const usagesStr = await redis.get(usageKey);
    let usages = usagesStr ? JSON.parse(usagesStr) : [];
    
    if (!usages.includes(deviceId)) {
      if (usages.length >= 3) {
        return res.status(403).json({ error: '该订单号已绑定最大数量的设备' });
      }
      usages.push(deviceId);
      await redis.set(usageKey, JSON.stringify(usages));
    }

    // Unlock device
    const deviceKey = `device:${deviceId}`;
    const deviceData = await redis.get(deviceKey);
    const newDeviceState = deviceData ? JSON.parse(deviceData) : { deviceId };
    
    // Check if the order was for the premium plan
    const AFDIAN_PLAN_PREMIUM = process.env.AFDIAN_PLAN_PREMIUM || '';
    if (AFDIAN_PLAN_PREMIUM && paidOrder.plan_id === AFDIAN_PLAN_PREMIUM) {
      newDeviceState.tier = 'premium';
      newDeviceState.expiresAt = Date.now() + 31 * 24 * 60 * 60 * 1000;
    } else {
      newDeviceState.tier = 'pro';
      if (newDeviceState.expiresAt) {
        delete newDeviceState.expiresAt;
      }
    }
    
    newDeviceState.updatedAt = Date.now();
    await redis.set(deviceKey, JSON.stringify(newDeviceState));

    return res.status(200).json({ success: true, tier: newDeviceState.tier });

  } catch (error) {
    console.error('Restore Purchase error:', error);
    return res.status(500).json({ error: '服务器内部错误，请稍后再试' });
  }
}
