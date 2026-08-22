// routes/schedules.js
// schedules 리소스 CRUD. 일간/주간은 같은 row를 다르게 렌더링만 하므로
// 뷰별 엔드포인트를 따로 두지 않고, 프론트에서 local_date/기간 범위로 필터링해서 씁니다.
// schedules 테이블엔 deleted_at이 없으므로(스키마상 이력 보존 불필요로 결정) DELETE는 hard delete입니다.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');
const { toLocalDate } = require('../utils/localDate');

const router = express.Router();

// task_id로부터 소유 유저의 timezone을 조회 (schedules에는 user_id가 없어서 join 필요)
function getUserTimezoneByTaskId(taskId) {
  const row = db
    .prepare(
      `SELECT us.timezone AS timezone
       FROM tasks t
       JOIN user_settings us ON us.user_id = t.user_id
       WHERE t.id = ?`
    )
    .get(taskId);

  return row ? row.timezone : 'Asia/Seoul'; // user_settings row가 아직 없으면 기본값
}

// GET /api/schedules?user_id=1&date=2026-08-21  (date는 선택 - local_date 필터)
router.get('/', (req, res) => {
  const { user_id, date } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  let query = `
    SELECT s.* FROM schedules s
    JOIN tasks t ON t.id = s.task_id
    WHERE t.user_id = ? AND t.deleted_at IS NULL
  `;
  const params = [user_id];

  if (date) {
    query += ` AND s.local_date = ?`;
    params.push(date);
  }

  query += ` ORDER BY s.start_at ASC`;

  const rows = db.prepare(query).all(...params);
  return ok(res, rows);
});

// GET /api/schedules/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '해당 일정을 찾을 수 없습니다.', 404);
  return ok(res, row);
});

// POST /api/schedules
// body: { task_id, start_at, end_at }  (start_at/end_at은 UTC ISO 8601)
router.post('/', (req, res) => {
  const { task_id, start_at, end_at } = req.body;

  if (!task_id || !start_at || !end_at) {
    return fail(res, 'task_id, start_at, end_at은 필수입니다.');
  }

  const timezone = getUserTimezoneByTaskId(task_id);
  const localDate = toLocalDate(start_at, timezone);

  const stmt = db.prepare(`
    INSERT INTO schedules (task_id, start_at, end_at, local_date)
    VALUES (@task_id, @start_at, @end_at, @local_date)
  `);

  try {
    const info = stmt.run({ task_id, start_at, end_at, local_date: localDate });
    const created = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/schedules/:id  (reschedule_task 함수가 호출하는 지점 - 항상 즉시 반영)
// body: { start_at?, end_at? }
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 일정을 찾을 수 없습니다.', 404);

  const { start_at, end_at } = req.body;
  if (!start_at && !end_at) return fail(res, '수정할 필드가 없습니다.');

  const newStartAt = start_at || existing.start_at;
  const newEndAt = end_at || existing.end_at;

  // start_at이 바뀌면 local_date도 다시 계산 (날짜를 넘어서 재배치되는 경우 대응)
  const timezone = getUserTimezoneByTaskId(existing.task_id);
  const newLocalDate = toLocalDate(newStartAt, timezone);

  db.prepare(
    `UPDATE schedules SET start_at = ?, end_at = ?, local_date = ?, updated_at = ? WHERE id = ?`
  ).run(newStartAt, newEndAt, newLocalDate, new Date().toISOString(), req.params.id);

  const updated = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(req.params.id);
  return ok(res, updated);
});

// DELETE /api/schedules/:id  (hard delete - schedules는 이력 보존 안 하기로 확정됨)
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 일정을 찾을 수 없습니다.', 404);

  db.prepare(`DELETE FROM schedules WHERE id = ?`).run(req.params.id);

  return ok(res, { id: Number(req.params.id), deleted: true });
});

module.exports = router;
