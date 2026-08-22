// routes/event_followups.js
// create_followup_flag 함수가 POST를 호출해 플래그를 답니다.
// GET /pending은 "하루의 첫 방문일 때만" 프론트가 호출해서 언급할 이벤트를 가져오는 용도입니다.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// GET /api/event-followups/pending?user_id=1&today=2026-08-21
// event_date가 오늘보다 과거이고, 아직 안 보여준(followup_shown=0) 것만.
router.get('/pending', (req, res) => {
  const { user_id, today } = req.query;
  if (!user_id || !today) return fail(res, 'user_id, today는 필수 쿼리 파라미터입니다.');

  const rows = db
    .prepare(
      `SELECT ef.*, t.title AS task_title
       FROM event_followups ef
       JOIN tasks t ON t.id = ef.task_id
       WHERE t.user_id = ? AND ef.event_date < ? AND ef.followup_shown = 0
       ORDER BY ef.event_date ASC`
    )
    .all(user_id, today);

  return ok(res, rows);
});

// POST /api/event-followups  (create_followup_flag 함수가 호출 - 유의미한 이벤트에만 선별적으로)
// body: { task_id, event_date }
router.post('/', (req, res) => {
  const { task_id, event_date } = req.body;
  if (!task_id || !event_date) return fail(res, 'task_id, event_date는 필수입니다.');

  try {
    const info = db
      .prepare(`INSERT INTO event_followups (task_id, event_date) VALUES (?, ?)`)
      .run(task_id, event_date);

    const created = db.prepare(`SELECT * FROM event_followups WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/event-followups/:id  (언급 후 유저 반응 기록)
// body: { user_response: 'acknowledged' | 'declined' }
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM event_followups WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 followup을 찾을 수 없습니다.', 404);

  const { user_response } = req.body;
  if (!['acknowledged', 'declined'].includes(user_response)) {
    return fail(res, "user_response는 'acknowledged' 또는 'declined'여야 합니다.");
  }

  db.prepare(
    `UPDATE event_followups SET followup_shown = 1, user_response = ? WHERE id = ?`
  ).run(user_response, req.params.id);

  const updated = db.prepare(`SELECT * FROM event_followups WHERE id = ?`).get(req.params.id);
  return ok(res, updated);
});

module.exports = router;
