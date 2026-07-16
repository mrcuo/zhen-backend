const { kv } = require('@vercel/kv');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).send('Missing orderId');
    }

    const order = await kv.get(`order:${orderId}`);
    
    if (order) {
      // Update device status in KV
      await kv.set(`device:${order.deviceId}`, {
        tier: order.plan,
        paidAt: Date.now(),
        orderId: orderId
      });
      
      // Update order status
      await kv.set(`order:${orderId}`, { ...order, status: 'success' }, { ex: 3600 * 24 * 7 });
      
      return res.status(200).send(`
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Mock Payment Success</title>
            <style>
              body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f9fafb; }
              .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #10b981; margin-top: 0; }
              p { color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>支付模拟成功 🎉</h1>
              <p>订单号: ${orderId}</p>
              <p>你可以关掉这个页面，回到浏览器插件，你会发现页面已经被自动解锁，并开始翻译了！</p>
            </div>
          </body>
        </html>
      `);
    }

    return res.status(404).send('Order not found');
  } catch (error) {
    console.error('Mock Pay Error:', error);
    return res.status(500).send('Internal Server Error');
  }
}
