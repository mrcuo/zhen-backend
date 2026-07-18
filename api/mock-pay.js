const Redis = require('ioredis');

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderId, deviceId } = req.query;

    if (!orderId) {
      return res.status(400).send('Missing orderId');
    }

    // Activate the device in Redis if available
    if (redis) {
      const orderData = await redis.get(`order:${orderId}`);
      const order = orderData ? JSON.parse(orderData) : null;
      
      const targetDeviceId = order?.deviceId || deviceId;
      if (targetDeviceId) {
        await redis.set(`device:${targetDeviceId}`, JSON.stringify({
          tier: 'basic',
          paidAt: Date.now(),
          orderId: orderId
        }));
        
        if (order) {
          await redis.set(`order:${orderId}`, JSON.stringify({ ...order, status: 'success' }), 'EX', 3600 * 24 * 7);
        }
      }
    }
      
    return res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>支付成功</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #f5f7fa, #c3cfe2); }
            .card { background: white; padding: 48px; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { margin: 0 0 8px; font-size: 24px; color: #111; }
            p { color: #666; margin: 0 0 8px; line-height: 1.6; }
            .hint { font-size: 12px; margin-top: 16px; color: #999; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🎉</div>
            <h1>支付成功！</h1>
            <p>感谢你支持 Zhen · 国翻</p>
            <p>已永久解锁无限翻译，回到浏览器即可使用。</p>
            <p class="hint">弹窗将在几秒后自动关闭</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Mock Pay Error:', error);
    return res.status(500).send('支付处理失败');
  }
}
