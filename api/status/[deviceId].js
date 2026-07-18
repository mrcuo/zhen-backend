const Redis = require('ioredis');

let redis;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
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

    return res.status(200).json({ tier: 'free' });
  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
// Force rebuild Sat Jul 18 08:56:41 CST 2026
