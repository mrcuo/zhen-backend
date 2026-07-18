const crypto = require('crypto');

const AFDIAN_USER_ID = "a494b920829a11f1b3bb5254001e7c00";
const AFDIAN_TOKEN = "tucnKdvB3N46GEsXTfPrY5SqajRW9MD7";

async function queryOrder(outTradeNo) {
  const ts = Math.floor(Date.now() / 1000);
  const paramsStr = JSON.stringify({ out_trade_no: outTradeNo });
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

async function run() {
  try {
    const res = await queryOrder("20260718202050504951997854"); // The order ID from previous test
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();
