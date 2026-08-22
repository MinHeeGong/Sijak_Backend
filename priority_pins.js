// routes/priority_pins.js
// priority_pins는 task 1:1이라 "생성"이 아니라 사실상 upsert입니다.
// - AI 판단(classify_priority)은 POST로: ai_urgency/ai_importance/ai_reasoning을 채우고 is_ai_classified=1
// - 유저 드래그 수정은 PUT으로: user_urgency/user_importance만 덮어씀 (ai_* 값은 그대로 보존 -> 되짚어보기용)
// 4개 탭(최우선/무조건/덜 급함/언젠가)은 저장하지 않고 조회 시점에 계산합니다 (파생값).

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

const THRESHOLD = 0.5; // urgency/importance 0.5 기준 4분면 분리

// 최종 표시값: user가 덮어쓴 값이 있으면 그걸 우선, 없으면 ai 값
function resolveFinalValues(pin) {
  const urgency = pin.user_urgency ?? pin.ai_urgency;
  const importance = pin.user_importance ?? pin.ai_importance;
  return { urgency, importance };
}

// urgency/importance -> 4개 탭 라벨
function resolveQuadrant(urgency, importance) {
  if (urgency == null || importance == null) return null; // 아직 AI 판단 전

  const urgent = urgency >= THRESHOLD;
  const important = importance >= THRESHOLD;

  if (urgent && important) return '최우선';   // 긴급 + 중요
  if (!urgent && important) return '무조건';   // 안 긴급 + 중요
  if (urgent && !important) return '덜 급함';  // 긴급 + 안 중요
  return '언젠가';                              // 안 긴급 + 안 중요
}

function withDerived(pin) {
  const { urgency, importance } = resolveFinalValues(pin);
  return {
    ...pin,
    final_urgency: urgency,
    final_importance: importance,
    quadrant: resolveQuadrant(urgency, importance),
  };
}

// GET /api/priority-pins?user_id=1
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  const rows = db
    .prepare(
      `SELECT p.* FROM priority_pins p
       JOIN tasks t ON t.id = p.task_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL`
    )
    .all(user_id);

  return ok(res, rows.map(withDerived));
});

// GET /api/priority-pins/:task_id  (task_id 기준 조회 - pin은 task 1:1이라 이게 자연스러움)
router.get('/:task_id', (req, res) => {
  const row = db.prepare(`SELECT * FROM priority_pins WHERE task_id = ?`).get(req.params.task_id);
  if (!row) return fail(res, '해당 task의 우선순위 정보가 없습니다.', 404);
  return ok(res, withDerived(row));
});

// POST /api/priority-pins  (classify_priority 함수가 호출하는 지점 - AI 판단 upsert)
// body: { task_id, ai_urgency, ai_importance, ai_reasoning }
router.post('/', (req, res) => {
  const { task_id, ai_urgency, ai_importance, ai_reasoning = null } = req.body;

  if (!task_id || ai_urgency == null || ai_importance == null) {
    return fail(res, 'task_id, ai_urgency, ai_importance는 필수입니다.');
  }
  if (ai_urgency < 0 || ai_urgency > 1 || ai_importance < 0 || ai_importance > 1) {
    return fail(res, 'ai_urgency, ai_importance는 0.0~1.0 범위여야 합니다.');
  }

  const stmt = db.prepare(`
    INSERT INTO priority_pins (task_id, ai_urgency, ai_importance, ai_reasoning, is_ai_classified)
    VALUES (@task_id, @ai_urgency, @ai_importance, @ai_reasoning, 1)
    ON CONFLICT(task_id) DO UPDATE SET
      ai_urgency = excluded.ai_urgency,
      ai_importance = excluded.ai_importance,
      ai_reasoning = excluded.ai_reasoning,
      is_ai_classified = 1,
      updated_at = @updated_at
  `);

  try {
    stmt.run({
      task_id,
      ai_urgency,
      ai_importance,
      ai_reasoning,
      updated_at: new Date().toISOString(),
    });

    const saved = db.prepare(`SELECT * FROM priority_pins WHERE task_id = ?`).get(task_id);
    return ok(res, withDerived(saved), 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/priority-pins/:task_id  (유저가 매트릭스에서 드래그로 직접 수정 - ai_* 값은 보존)
// body: { user_urgency, user_importance }
router.put('/:task_id', (req, res) => {
  const existing = db
    .prepare(`SELECT * FROM priority_pins WHERE task_id = ?`)
    .get(req.params.task_id);
  if (!existing) return fail(res, '해당 task의 우선순위 정보가 없습니다. 먼저 AI 판단이 필요합니다.', 404);

  const { user_urgency, user_importance } = req.body;
  if (user_urgency == null && user_importance == null) {
    return fail(res, 'user_urgency 또는 user_importance 중 하나는 필요합니다.');
  }
  if (
    (user_urgency != null && (user_urgency < 0 || user_urgency > 1)) ||
    (user_importance != null && (user_importance < 0 || user_importance > 1))
  ) {
    return fail(res, 'user_urgency, user_importance는 0.0~1.0 범위여야 합니다.');
  }

  db.prepare(
    `UPDATE priority_pins
     SET user_urgency = COALESCE(@user_urgency, user_urgency),
         user_importance = COALESCE(@user_importance, user_importance),
         updated_at = @updated_at
     WHERE task_id = @task_id`
  ).run({
    task_id: req.params.task_id,
    user_urgency: user_urgency ?? null,
    user_importance: user_importance ?? null,
    updated_at: new Date().toISOString(),
  });

  const updated = db.prepare(`SELECT * FROM priority_pins WHERE task_id = ?`).get(req.params.task_id);
  return ok(res, withDerived(updated));
});

module.exports = router;
