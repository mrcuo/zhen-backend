const { kv } = require('@vercel/kv');


const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

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
    const { deviceId, texts } = req.body;

    if (!deviceId || !Array.isArray(texts)) {
      return res.status(400).json({ error: 'Missing deviceId or texts' });
    }

    if (process.env.KV_REST_API_URL) {
      // Verify if user is premium
      const device = await kv.get(`device:${deviceId}`);
      if (!device || device.tier !== 'premium') {
        return res.status(403).json({ error: 'Forbidden: Requires premium tier' });
      }
    }

    // Translate via DeepSeek V4 (or other best model)
    const translations = await translateWithLLM(texts);

    return res.status(200).json({ translations });
  } catch (error) {
    console.error('Translate Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function translateWithLLM(texts) {
  // In a real scenario, you might send batches or individual requests to DeepSeek
  // For demonstration, we'll format them as a single prompt with separators, or map concurrently
  
  const separator = '\n\n|||\n\n';
  const joined = texts.join(separator);

  if (!DEEPSEEK_API_KEY) {
    // Mock translation for demo purposes
    return texts.map(t => `[Pro] ${t}`);
  }

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: "deepseek-chat", // DeepSeek V4-Flash analog
      messages: [
        {
          role: "system",
          content: "你是一个专业的英中翻译引擎。将以下英文文本翻译为简体中文。要求：准确、自然、符合中文表达习惯。保留原文本的所有的 `|||` 分隔符，并在翻译结果中使用相同的分隔符。不要添加解释或注释，只输出翻译结果。"
        },
        {
          role: "user",
          content: joined
        }
      ],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API returned ${response.status}`);
  }

  const data = await response.json();
  const translatedStr = data.choices[0].message.content || '';
  
  const results = translatedStr.split(/\s*\|\|\|\s*/);
  
  // Basic validation
  if (results.length === texts.length) {
    return results;
  }
  
  // If parsing fails or length mismatch, fallback or try one by one (simplification for this plan)
  return texts.map(() => '翻译失败'); // Real logic would retry sequentially
}
