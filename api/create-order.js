const crypto = require('crypto');

// XunHuPay (虎皮椒) config
const XUNHU_APPID = process.env.XUNHU_APPID;
const XUNHU_APPSECRET = process.env.XUNHU_APPSECRET;

// KV for order storage
let kv;
try { kv = require('@vercel/kv').kv; } catch (e) {}

/**
 * Generate XunHuPay MD5 hash signature
 * 1. Sort params by key (ASCII ascending)
 * 2. Join as key1=value1&key2=value2... (skip empty values and 'hash')
 * 3. Append APPSECRET directly (no separator)
 * 4. MD5 → 32-char lowercase hex
 */
function generateHash(params, appSecret) {
  const keys = Object.keys(params).sort();
  const parts = keys
    .filter(k => k !== 'hash' && params[k] !== null && params[k] !== '' && params[k] !== undefined)
    .map(k => `${k}=${params[k]}`);
  const signStr = parts.join('&') + appSecret;
  return crypto.createHash('md5').update(signStr).digest('hex');
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
    const { deviceId, plan } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    const outTradeNo = `ZHEN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let qrCodeUrl = '';

    if (XUNHU_APPID && XUNHU_APPSECRET) {
      // ── Real XunHuPay Integration ──
      const params = {
        version: '1.1',
        appid: XUNHU_APPID,
        trade_order_id: outTradeNo,
        total_fee: '9.90',
        title: 'Zhen · 国翻 买断版（终身）',
        time: Math.floor(Date.now() / 1000).toString(),
        notify_url: `https://${req.headers.host}/api/notify`,
        nonce_str: crypto.randomBytes(16).toString('hex'),
      };
      params.hash = generateHash(params, XUNHU_APPSECRET);

      const response = await fetch('https://api.xunhupay.com/payment/do.html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (data.errcode) {
        console.error('XunHuPay error:', data);
        return res.status(500).json({ error: 'Payment service error', details: data.errmsg || data.errcode });
      }

      qrCodeUrl = data.url_qrcode || data.url || '';
    } else {
      // ── Mock Mode ──
      console.log('[Mock] No XUNHU keys configured. Using mock QR code.');
      const mockPayUrl = `https://${req.headers.host}/api/mock-pay?orderId=${outTradeNo}&deviceId=${deviceId}`;
      qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(mockPayUrl)}`;
    }

    // Save order in KV (if available)
    if (process.env.KV_REST_API_URL && kv) {
      await kv.set(`order:${outTradeNo}`, {
        deviceId,
        plan: plan || 'basic',
        status: 'pending',
        createdAt: Date.now()
      }, { ex: 3600 }); // 1 hour expiry
    }

    return res.status(200).json({
      orderId: outTradeNo,
      qrCodeUrl: qrCodeUrl,
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
