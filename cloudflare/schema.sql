-- 居服職涯適性自我評估｜匿名作答資料庫
-- 僅收集 8 題得分、總分和伺服器時間，不包含姓名、電話、email、IP 或 UA。
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  q1 INTEGER NOT NULL CHECK (q1 BETWEEN 1 AND 3),
  q2 INTEGER NOT NULL CHECK (q2 BETWEEN 1 AND 3),
  q3 INTEGER NOT NULL CHECK (q3 BETWEEN 1 AND 3),
  q4 INTEGER NOT NULL CHECK (q4 BETWEEN 1 AND 3),
  q5 INTEGER NOT NULL CHECK (q5 BETWEEN 1 AND 3),
  q6 INTEGER NOT NULL CHECK (q6 BETWEEN 1 AND 3),
  q7 INTEGER NOT NULL CHECK (q7 BETWEEN 1 AND 3),
  q8 INTEGER NOT NULL CHECK (q8 BETWEEN 1 AND 3),
  total INTEGER NOT NULL CHECK (total BETWEEN 8 AND 24),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_total ON submissions (total);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions (created_at);
