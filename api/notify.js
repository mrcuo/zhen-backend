const AlipaySdk = require('alipay-sdk').default;
const { kv } = require('@vercel/kv');


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const postData = req.body;
    
    // Verify signature
    let isValid = false;
    if (process.env.ALIPAY_PUBLIC_KEY) {
      const alipaySdk = new AlipaySdk({
        alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
        camelcase: true,
      });
      isValid = alipaySdk.checkNotifySign(postData);
    }
    
    if (!isValid) {
      console.error('Invalid Alipay signature');
      return res.status(400).send('failure');
    }

    const { outTradeNo, tradeStatus } = postData;

    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
      // Get order info from KV
      const order = await kv.get(`order:${outTradeNo}`);
      
      if (order) {
        // Update device status in KV
        await kv.set(`device:${order.deviceId}`, {
          tier: order.plan,
          paidAt: Date.now(),
          orderId: outTradeNo
        });
        
        // Update order status
        await kv.set(`order:${outTradeNo}`, { ...order, status: 'success' }, { ex: 3600 * 24 * 7 }); // Keep order log for 7 days
      }
    }

    // Alipay expects exactly "success" to stop sending notifications
    return res.status(200).send('success');
  } catch (error) {
    console.error('Notify Error:', error);
    return res.status(500).send('failure');
  }
}
