// routes/energy_logs.js
// log_energy 함수가 호출하는 지점. 같은 user_id + date + time_slot으로 또 기록되면
// (하루 중 같은 시간대를 다시 언급하는 경우) 새로 추가하지 않고 덮어씁니다.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// GET /api/energy-logs?user_id=1&date=2026-08-21  (date 생략 시 전체)
router.get('/', (req, res) => {
  const { user_id, date } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  let query = `SELECT * FROM energy_logs WHERE user_id = ?`;
  const params = [user_id];

  if (date) {
    query += ` AND date = ?`;
    params.push(date);
  }

  query += ` ORDER BY date DESC, time_slot ASC`;

  const rows = db.prepare(query).all(...params);
  return ok(res, rows);
});

// POST /api/energy-logs
// body: { user_id, date, time_slot, energy_level }  (energy_level: 1~5)
router.post('/', (req, res) => {
  const { user_id, date, time_slot, energy_level } = req.body;

  if (!user_id || !date || !time_slot || energy_level == null) {
    return fail(res, 'user_id, date, time_slot, energy_level은 필수입니다.');
  }
  if (energy_level < 1 || energy_level > 5) {
    return fail(res, 'energy_level은 1~5 사이여야 합니다.');
  }

  const existing = db
    .prepare(`SELECT id FROM energy_logs WHERE user_id = ? AND date = ? AND time_slot = ?`)
    .get(user_id, date, time_slot);

  try {
    if (existing) {
      db.prepare(`UPDATE energy_logs SET energy_level = ? WHERE id = ?`).run(
        energy_level,
        existing.id
      );
      const updated = db.prepare(`SELECT * FROM energy_logs WHERE id = ?`).get(existing.id);
      return ok(res, updated);
    }

    const info = db
      .prepare(
        `INSERT INTO energy_logs (user_id, date, time_slot, energy_level) VALUES (?, ?, ?, ?)`
      )
      .run(user_id, date, time_slot, energy_level);

    const created = db.prepare(`SELECT * FROM energy_logs WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

module.exports = router;
