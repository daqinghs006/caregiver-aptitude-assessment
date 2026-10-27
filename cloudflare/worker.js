/**
 * Cloudflare Workers + D1：居服職涯適性評估匿名資料 API
 * Secrets: ADMIN_TOKEN (在 Cloudflare 設定，不得放進 GitHub)
 * Variables: ALLOWED_ORIGIN=https://daqinghs006.github.io
 * D1 binding: DB
 * 不儲存 IP、姓名、信箱、電話或 User-Agent；請額外檢查 Cloudflare 記錄政策。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUESTION_FIELDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
const DEFAULT_ORIGIN = 'https://daqinghs006.github.io';

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  const origin = request.headers.get('Origin');
  return origin === allowed ? {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '3600',
    'Vary': 'Origin',
  } : { 'Vary': 'Origin' };
}

function responseJSON(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...corsHeaders(request, env),
    },
  });
}

function responseError(request, env, status, message) {
  return responseJSON(request, env, { ok: false, error: message }, status);
}

async function safeSameSecret(actual, expected) {
  // 固定長度 SHA-256 摘要的常數時間比較，避免逐字比對洩漏前綴。
  const encoder = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(actual)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function checkAdmin(request, env) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const credential = header.slice('Bearer '.length);
  if (!credential || credential.length > 500) return false;
  return safeSameSecret(credential, env.ADMIN_TOKEN);
}

function isValidPayload(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && typeof body.id === 'string' && UUID_RE.test(body.id)
    && Array.isArray(body.answers) && body.answers.length === 8
    && body.answers.every(x => Number.isInteger(x) && x >= 1 && x <= 3);
}

async function collectSubmission(request, env) {
  const raw = await request.text();
  if (raw.length > 2000) return responseError(request, env, 413, '資料長度超過限制');
  let body;
  try { body = JSON.parse(raw); }
  catch { return responseError(request, env, 400, '請提供正確的 JSON'); }
  if (!isValidPayload(body)) return responseError(request, env, 400, '請提供 8 題有效分數（1～3）');
  // 分數以伺服器計算為準，不信任用戶端的總分。
  const scores = body.answers;
  const total = scores.reduce((sum, n) => sum + n, 0);
  await env.DB.prepare(`
    INSERT INTO submissions (id, q1, q2, q3, q4, q5, q6, q7, q8, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      q1=excluded.q1, q2=excluded.q2, q3=excluded.q3, q4=excluded.q4,
      q5=excluded.q5, q6=excluded.q6, q7=excluded.q7, q8=excluded.q8,
      total=excluded.total,
      updated_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  `).bind(body.id, ...scores, total).run();
  return responseJSON(request, env, { ok: true, stored: true, total });
}

async function getAggregates(env) {
  const summary = await env.DB.prepare(`
    SELECT COUNT(*) AS count, ROUND(AVG(total), 2) AS average, MIN(total) AS minimum, MAX(total) AS maximum,
      SUM(CASE WHEN total BETWEEN 20 AND 24 THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN total BETWEEN 15 AND 19 THEN 1 ELSE 0 END) AS medium,
      SUM(CASE WHEN total BETWEEN 8 AND 14 THEN 1 ELSE 0 END) AS exploring
    FROM submissions
  `).first();
  const distribution = await env.DB.prepare('SELECT total AS score, COUNT(*) AS count FROM submissions GROUP BY total ORDER BY total').all();
  const sums = QUESTION_FIELDS.map((field, i) => `SUM(${field}) AS s${i + 1}`);
  const optionCounts = QUESTION_FIELDS.flatMap((field, i) => [1,2,3].map(
    v => `SUM(CASE WHEN ${field}=${v} THEN 1 ELSE 0 END) AS q${i + 1}_${v}`
  ));
  const traits = await env.DB.prepare(`SELECT ${[...sums, ...optionCounts].join(', ')} FROM submissions`).first();
  const count = Number(summary?.count || 0);
  return {
    ok: true,
    updated_at: new Date().toISOString(),
    count,
    average: count ? Number(summary.average) : null,
    minimum: count ? Number(summary.minimum) : null,
    maximum: count ? Number(summary.maximum) : null,
    groups: {
      high: Number(summary?.high || 0),
      medium: Number(summary?.medium || 0),
      exploring: Number(summary?.exploring || 0),
    },
    distribution: Array.from({ length: 17 }, (_, i) => {
      const score = i + 8;
      const found = distribution.results.find(row => Number(row.score) === score);
      return { score, count: found ? Number(found.count) : 0 };
    }),
    traits: QUESTION_FIELDS.map((_, i) => ({
      number: i + 1,
      average: count ? Math.round(Number(traits[`s${i+1}`] || 0) / count * 100) / 100 : null,
      choices: [1,2,3].map(v => Number(traits[`q${i+1}_${v}`] || 0)),
    })),
  };
}

function csvCell(value) {
  // 資料皆由伺服器產生或已嚴格驗證；仍確保正確的 CSV escaping。
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function exportCsv(request, env) {
  // 伺服器限制上限，避免過大的資料集一次載入 Worker 記憶體。
  const cap = 20000;
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM submissions').first();
  if (Number(countRow?.count || 0) > cap) {
    return responseError(request, env, 413, '資料超過 20,000 筆，請使用後續的分批匯出功能');
  }
  const rows = await env.DB.prepare(`
    SELECT id, created_at, updated_at, q1, q2, q3, q4, q5, q6, q7, q8, total
    FROM submissions ORDER BY created_at DESC, id DESC LIMIT ?
  `).bind(cap).all();
  const header = ['匿名紀錄ID', '首次提交時間(UTC)', '更新時間(UTC)',
    '同理心', '耐心', '責任感', '尊重', '學習意願', '細心觀察', '溝通能力', '適應能力', '總分'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows.results) {
    lines.push([row.id, row.created_at, row.updated_at, ...QUESTION_FIELDS.map(f => row[f]), row.total].map(csvCell).join(','));
  }
  return new Response('\uFEFF' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="caregiver-assessment-results.csv"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(request, env),
    },
  });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const origin = request.headers.get('Origin');
    if (origin && origin !== (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) {
      return responseError(request, env, 403, '來源不允許');
    }
    if (request.method === 'OPTIONS') {
      if (origin !== (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) return responseError(request, env, 403, '來源不允許');
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (path === '/api/health' && request.method === 'GET') {
      return responseJSON(request, env, { ok: true, storage_ready: !!env.DB });
    }
    if (!env.DB) return responseError(request, env, 503, '資料庫尚未綁定');
    try {
      if (path === '/api/submissions' && request.method === 'POST') {
        return await collectSubmission(request, env);
      }
      if (path.startsWith('/api/admin/')) {
        if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) {
          return responseError(request, env, 503, '管理員金鑰尚未正確設定');
        }
        if (!(await checkAdmin(request, env))) {
          return responseError(request, env, 401, '管理員金鑰不正確');
        }
        if (path === '/api/admin/stats' && request.method === 'GET') {
          return responseJSON(request, env, await getAggregates(env));
        }
        if (path === '/api/admin/export' && request.method === 'GET') {
          return exportCsv(request, env);
        }
      }
      return responseError(request, env, 404, '找不到此 API');
    } catch (error) {
      // 不輸出包含 SQL 或環境變數的錯誤內容給使用者。
      console.error('API operation failed:', error?.name || 'UnknownError');
      return responseError(request, env, 500, '暫時無法處理資料，請稍後重試');
    }
  },
};
