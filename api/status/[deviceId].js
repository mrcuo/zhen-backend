const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    if (!process.env.KV_REST_API_URL) {
      return res.status(200).json({ tier: 'free', debug: 'NO_KV_ENV_FOUND' });
    }

    const device = await kv.get(`device:${deviceId}`);

    if (!device) {
      return res.status(200).json({ tier: 'free' });
    }

    return res.status(200).json({ tier: device.tier });
  } catch (error) {
    console.error('Status Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
