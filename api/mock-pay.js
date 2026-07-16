const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).send('Missing orderId');
    }

    if (process.env.KV_REST_API_URL) {
      const order = await kv.get(`order:${orderId}`);
      if (order) {
        await kv.set(`device:${order.deviceId}`, {
          tier: order.plan,
          paidAt: Date.now(),
          orderId: orderId
        });
        await kv.set(`order:${orderId}`, { ...order, status: 'success' }, { ex: 3600 * 24 * 7 });
      }
    }
      
    return res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Mock Payment Success</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f9fafb; }
            .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { margin: 0 0 8px; font-size: 24px; color: #111; }
            p { color: #666; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>支付模拟成功！</h1>
            <p>沙箱环境测试完成，请查看浏览器插件状态。</p>
            <p style="font-size: 12px; margin-top: 16px; color: #999;">如果状态未更新，请确保已配置 Vercel KV。</p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Mock Pay Error:', error);
    return res.status(500).send('Mock Payment Failed');
  }
}
