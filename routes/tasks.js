// routes/tasks.js
// tasks 리소스의 기본 CRUD. category_id 필수, soft delete, deletion_policy에 따른
// expires_at 자동 계산까지 포함한 "기준 패턴"입니다. schedules, categories 등
// 다른 라우트도 이 파일 구조를 그대로 복제해서 만들면 됩니다.

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// deletion_policy에 따라 expires_at을 계산 (soft delete 대상 판단용)
function calcExpiresAt(deletionPolicy, fromDate = new Date()) {
  if (deletionPolicy === 'manual') return null;

  const ms = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }[deletionPolicy];

  if (!ms) return null;

  return new Date(fromDate.getTime() + ms).toISOString();
}

// GET /api/tasks?user_id=1  (soft delete 안 된 것만)
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  const rows = db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`
    )
    .all(user_id);

  return ok(res, rows);
});

// GET /api/tasks/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '해당 task를 찾을 수 없습니다.', 404);
  return ok(res, row);
});

// POST /api/tasks
// body: { user_id, category_id, title, memo?, due_date?, estimated_minutes?, deletion_policy? }
router.post('/', (req, res) => {
  const {
    user_id,
    category_id,
    project_id = null,
    title,
    memo = null,
    due_date = null,
    estimated_minutes = null,
    deletion_policy = '24h',
  } = req.body;

  if (!user_id || !category_id || !title) {
    return fail(res, 'user_id, category_id, title은 필수입니다.');
  }

  const expiresAt = calcExpiresAt(deletion_policy);

  const stmt = db.prepare(`
    INSERT INTO tasks
      (user_id, category_id, project_id, title, memo, due_date, estimated_minutes, deletion_policy, expires_at)
    VALUES
      (@user_id, @category_id, @project_id, @title, @memo, @due_date, @estimated_minutes, @deletion_policy, @expires_at)
  `);

  try {
    const info = stmt.run({
      user_id,
      category_id,
      project_id,
      title,
      memo,
      due_date,
      estimated_minutes,
      deletion_policy,
      expires_at: expiresAt,
    });

    const created = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    // FK 위반(category_id가 존재하지 않는 경우) 등을 여기서 잡습니다.
    return fail(res, err.message, 400);
  }
});

// PATCH /api/tasks/bulk  (카테고리 탭: 다중 선택 후 일괄 이동/삭제)
// body: { task_ids: [1,2,3], category_id?, project_id?, deleted_at? }
// 반드시 /:id 라우트보다 위에 있어야 '/bulk'가 :id로 잘못 매칭되지 않음.
router.patch('/bulk', (req, res) => {
  const { task_ids, ...updates } = req.body;
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return fail(res, 'task_ids는 비어있지 않은 배열이어야 합니다.');
  }

  const allowed = ['category_id', 'project_id', 'deleted_at', 'completed_at'];
  const fields = allowed.filter((key) => key in updates);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');

  const txn = db.transaction((ids) => {
    const stmt = db.prepare(
      `UPDATE tasks SET ${setClause}, updated_at = @updated_at WHERE id = @id`
    );
    const results = [];
    for (const id of ids) {
      const params = { id, updated_at: new Date().toISOString() };
      fields.forEach((key) => (params[key] = updates[key]));
      stmt.run(params);
      results.push(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id));
    }
    return results;
  });

  try {
    return ok(res, txn(task_ids));
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/tasks/:id  (부분 수정 지원 - 넘어온 필드만 업데이트)
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 task를 찾을 수 없습니다.', 404);

  const updatable = [
    'category_id',
    'project_id',
    'title',
    'memo',
    'due_date',
    'estimated_minutes',
    'deletion_policy',
    'completed_at',
  ];

  const fields = updatable.filter((key) => key in req.body);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');
  const params = { id: req.params.id, updated_at: new Date().toISOString() };
  fields.forEach((key) => (params[key] = req.body[key]));

  db.prepare(`UPDATE tasks SET ${setClause}, updated_at = @updated_at WHERE id = @id`).run(params);

  const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  return ok(res, updated);
});

// DELETE /api/tasks/:id  (soft delete - deleted_at만 채움, 실제 row는 안 지움)
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 task를 찾을 수 없습니다.', 404);

  db.prepare(`UPDATE tasks SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    req.params.id
  );

  return ok(res, { id: Number(req.params.id), deleted: true });
});

module.exports = router;
