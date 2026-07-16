const AlipaySdk = require('alipay-sdk').default;
const { kv } = require('@vercel/kv');
const crypto = require('crypto');

// Check env vars
const {
  ALIPAY_APP_ID,
  ALIPAY_PRIVATE_KEY,
  ALIPAY_PUBLIC_KEY,
} = process.env;


module.exports = async function handler(req, res) {
  // Setup CORS
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
    const { deviceId, plan } = req.body;

    if (!deviceId || !plan) {
      return res.status(400).json({ error: 'Missing deviceId or plan' });
    }

    let totalAmount = '9.90';
    let subject = 'Zhen · 国翻 基础版 (终身)';

    if (plan === 'premium') {
      totalAmount = '6.90'; // First month or monthly subscription via other API, but for now we'll just mock it.
      subject = 'Zhen · 国翻 进阶版 (首月)';
      // Note: for auto-renewal, Alipay requires specific cycle deduction APIs.
      // We'll use standard precreate here for simplicity in this demo.
    }

    const outTradeNo = `ZHEN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let qrCodeUrl = '';

    if (ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY) {
      const alipaySdk = new AlipaySdk({
        appId: ALIPAY_APP_ID,
        privateKey: ALIPAY_PRIVATE_KEY,
        alipayPublicKey: ALIPAY_PUBLIC_KEY,
        gateway: 'https://openapi.alipay.com/gateway.do',
        timeout: 5000,
        camelcase: true,
      });

      const result = await alipaySdk.exec('alipay.trade.precreate', {
        notifyUrl: 'https://zhen-backend.vercel.app/api/notify', // Will need to update this URL to actual domain
        bizContent: {
          outTradeNo: outTradeNo,
          totalAmount: totalAmount,
          subject: subject,
        },
      });

      if (result.code !== '10000') {
        console.error('Alipay error:', result);
        return res.status(500).json({ error: 'Failed to create order with Alipay' });
      }
      qrCodeUrl = result.qrCode;
    } else {
      // Mock mode for testing without real Alipay keys
      console.log('Running in MOCK mode. Generating fake QR code.');
      const mockPayUrl = `https://${req.headers.host}/api/mock-pay?orderId=${outTradeNo}`;
      qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(mockPayUrl)}`;
    }

    // Save order status in KV (if configured)
    if (process.env.KV_REST_API_URL) {
      await kv.set(`order:${outTradeNo}`, {
        deviceId,
        plan,
        status: 'pending',
        createdAt: Date.now()
      }, { ex: 3600 }); // Expire in 1 hour
    }
    return res.status(200).json({
      orderId: outTradeNo,
      qrCodeUrl: qrCodeUrl,
    });
  } catch (error) {
    console.error('Error in create-order:', error);
    if (error.message && error.message.includes('URL is missing')) {
      return res.status(500).json({ error: 'KV Database not configured' });
    }
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
