// routes/daily_memos.js
// 월간 캘린더 하단 메모. 날짜당 1개(UNIQUE user_id+date)라서 저장은 upsert로 처리.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// GET /api/daily-memos?user_id=1&start_date=2026-08-01&end_date=2026-08-31
// 월간 캘린더가 화면에 보이는 범위만큼만 조회 (start_date/end_date 없으면 전체)
router.get('/', (req, res) => {
  const { user_id, start_date, end_date } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  let rows;
  if (start_date && end_date) {
    rows = db
      .prepare(`SELECT * FROM daily_memos WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC`)
      .all(user_id, start_date, end_date);
  } else {
    rows = db.prepare(`SELECT * FROM daily_memos WHERE user_id = ? ORDER BY date ASC`).all(user_id);
  }

  return ok(res, rows);
});

// PUT /api/daily-memos  (upsert - 날짜당 1개라 생성/수정을 구분하지 않음)
// body: { user_id, date, content }
router.put('/', (req, res) => {
  const { user_id, date, content } = req.body;
  if (!user_id || !date || content == null) {
    return fail(res, 'user_id, date, content는 필수입니다.');
  }

  db.prepare(
    `INSERT INTO daily_memos (user_id, date, content)
     VALUES (@user_id, @date, @content)
     ON CONFLICT(user_id, date) DO UPDATE SET
       content = excluded.content,
       updated_at = datetime('now')`
  ).run({ user_id, date, content });

  const saved = db
    .prepare(`SELECT * FROM daily_memos WHERE user_id = ? AND date = ?`)
    .get(user_id, date);

  return ok(res, saved);
});

// DELETE /api/daily-memos?user_id=1&date=2026-08-14
router.delete('/', (req, res) => {
  const { user_id, date } = req.query;
  if (!user_id || !date) return fail(res, 'user_id, date는 필수 쿼리 파라미터입니다.');

  db.prepare(`DELETE FROM daily_memos WHERE user_id = ? AND date = ?`).run(user_id, date);
  return ok(res, { user_id: Number(user_id), date, deleted: true });
});

module.exports = router;
