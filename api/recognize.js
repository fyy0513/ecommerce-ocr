const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const EMPTY_RESULT = {
  '标题': '',
  '价格': '',
  '原价': '',
  '销量': '',
  '评价数': '',
  '店铺': '',
  '平台': '',
  '活动标签': [],
  '原始识别文本': ''
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function extractJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('模型未返回 JSON');
    return JSON.parse(match[0]);
  }
}

function normalizeResult(value) {
  const data = value && typeof value === 'object' ? value : {};
  const aliases = {
    '标题': ['标题', '商品标题', 'title', 'product_title'],
    '价格': ['价格', '现价', '到手价', '券后价', 'price'],
    '原价': ['原价', '划线价', '参考价', 'original_price', 'originalPrice'],
    '销量': ['销量', '月销量', '已售', 'sales'],
    '评价数': ['评价数', '评论数', '评价', '评论', 'reviews', 'review_count'],
    '店铺': ['店铺', '店铺名', '商家', 'shop', 'store'],
    '平台': ['平台', 'platform'],
    '活动标签': ['活动标签', '优惠活动', '活动', '促销', 'activity_tags', 'promotions'],
    '原始识别文本': ['原始识别文本', '识别文本', 'raw_text', 'rawText']
  };

  const result = { ...EMPTY_RESULT };
  for (const [target, keys] of Object.entries(aliases)) {
    for (const key of keys) {
      if (data[key] !== undefined && data[key] !== null) {
        result[target] = data[key];
        break;
      }
    }
  }
  if (!Array.isArray(result['活动标签'])) {
    result['活动标签'] = String(result['活动标签'] || '')
      .split(/[、,，;；|]/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: '只支持 POST 请求' });
  }

  const apiKey = process.env.QWEN_API_KEY || process.env.QREN_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      ok: false,
      error: '服务端缺少环境变量 QWEN_API_KEY'
    });
  }

  try {
    const body = await readJsonBody(req);
    const image = body.image || body.imageDataUrl || body.dataUrl;
    if (!image || typeof image !== 'string') {
      return sendJson(res, 400, {
        ok: false,
        error: '请提供 imageDataUrl'
      });
    }

    const userPrompt = [
      '你是电商运营截图识别助手。',
      '请识别淘宝、京东、抖音等电商商品详情页截图中的字段。',
      '必须只返回 JSON，不要 Markdown，不要解释。',
      'JSON 字段必须固定为：标题、价格、原价、销量、评价数、店铺、平台、活动标签、原始识别文本。',
      '要求：',
      '1. 标题尽量完整，不要截断。',
      '2. 价格、原价、销量、评价数保留截图中的原始单位，例如 "2.3万+"、"1000+"、"¥39.9"。',
      '3. 活动标签用数组，例如 ["满减", "包邮", "券后价"]。',
      '4. 不确定的字段返回空字符串或空数组，不要编造。',
      '5. 原始识别文本填写你从截图中读取到的主要文字，供人工校验。'
    ].join('\n');

    const response = await fetch(DASHSCOPE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-vl-max',
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: { url: image }
              }
            ]
          }
        ]
      })
    });

    const dashscopePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return sendJson(res, response.status, {
        ok: false,
        error: dashscopePayload?.error?.message || `DashScope 请求失败：${response.status}`,
        detail: dashscopePayload
      });
    }

    const content = dashscopePayload?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);
    const result = normalizeResult(parsed);

    return sendJson(res, 200, {
      ok: true,
      result,
      raw: content
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || '识别失败'
    });
  }
}
