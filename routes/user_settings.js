// routes/user_settings.js
// 유저 1:1 설정. connection.js에서 user_id=1은 이미 기본 row가 보장되지만,
// 다른 유저가 생기는 경우(로그인 붙인 뒤)를 대비해 GET에서도 없으면 만들어서 반환.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

function ensureRow(userId) {
  db.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`).run(userId);
  return db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`).get(userId);
}

// GET /api/user-settings?user_id=1
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');
  return ok(res, ensureRow(user_id));
});

// PUT /api/user-settings  body: { user_id, assignment_mode? , ... }
// 자주 바뀌는 값(assignment_mode)부터 지원. 다른 필드(timezone 등)도 같은 패턴으로 확장 가능.
router.put('/', (req, res) => {
  const { user_id, ...updates } = req.body;
  if (!user_id) return fail(res, 'user_id는 필수입니다.');

  ensureRow(user_id);

  const updatable = [
    'assignment_mode',
    'timezone',
    'priority_trigger_words',
    'inactivity_days',
    'default_deletion_policy',
    'max_habits_per_day',
    'color_order',
    'purpose',
    'planning_type',
    'burnout_signal',
    'adhd_signal',
    'onboarding_notes',
    'onboarding_completed',
  ];
  const fields = updatable.filter((key) => key in updates);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');
  const params = { user_id, updated_at: new Date().toISOString() };
  fields.forEach((key) => (params[key] = updates[key]));

  try {
    db.prepare(`UPDATE user_settings SET ${setClause}, updated_at = @updated_at WHERE user_id = @user_id`).run(params);
  } catch (err) {
    return fail(res, err.message, 400);
  }

  return ok(res, db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`).get(user_id));
});

module.exports = router;
