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
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { deviceId } = req.query;

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    if (!redis) {
      return res.status(200).json({ tier: 'free', debug: 'NO_REDIS_URL_FOUND' });
    }

    const deviceData = await redis.get(`device:${deviceId}`);
    if (deviceData) {
      const device = JSON.parse(deviceData);
      if (device && device.tier) {
        return res.status(200).json({ tier: device.tier });
      }
    }

    // ── FALLBACK POLLING FOR AFDIAN ──
    const pendingOutTradeNo = await redis.get(`device_pending_order:${deviceId}`);
    
    if (pendingOutTradeNo && AFDIAN_USER_ID && AFDIAN_TOKEN) {
      // Throttle Afdian API requests (e.g. at most once every 5 seconds per device)
      const lastPoll = await redis.get(`afdian_poll_throttle:${deviceId}`);
      if (!lastPoll) {
        await redis.set(`afdian_poll_throttle:${deviceId}`, '1', 'EX', 5);
        
        try {
          const apiRes = await queryAfdianOrder(1);
          
          if (apiRes && apiRes.data && apiRes.data.list) {
            const paidOrder = apiRes.data.list.find(o => o.custom_order_id === pendingOutTradeNo || o.out_trade_no === pendingOutTradeNo);
            if (paidOrder) {
              console.log(`[Status Fallback] Found paid order ${pendingOutTradeNo} via API! Unlocking device ${deviceId}.`);
              
              // Mark order as paid
              const orderStr = await redis.get(`order:${pendingOutTradeNo}`);
              if (orderStr) {
                const order = JSON.parse(orderStr);
                order.status = 'paid';
                await redis.set(`order:${pendingOutTradeNo}`, JSON.stringify(order), 'EX', 86400 * 7);
              }
              
              // Unlock device
              const newDeviceState = deviceData ? JSON.parse(deviceData) : { deviceId };
              newDeviceState.tier = 'pro';
              newDeviceState.updatedAt = Date.now();
              await redis.set(`device:${deviceId}`, JSON.stringify(newDeviceState));
              await redis.del(`device_pending_order:${deviceId}`); // Clear pending flag
              
              return res.status(200).json({ tier: 'pro' });
            }
          }
        } catch (pollErr) {
          console.error('[Status Fallback] Error polling Afdian API:', pollErr.message);
        }
      }
    }

    return res.status(200).json({ tier: 'free' });
  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
