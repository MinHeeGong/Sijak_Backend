// routes/projects.js
// projects 리소스 CRUD. categories.js와 동일한 패턴.
// self-reference(parent_id)로 서브프로젝트 지원, category_id로 카테고리 하위 배치도 가능(nullable).

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// GET /api/projects?user_id=1
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  const rows = db
    .prepare(
      `SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`
    )
    .all(user_id);

  return ok(res, rows);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '해당 프로젝트를 찾을 수 없습니다.', 404);
  return ok(res, row);
});

// POST /api/projects
// body: { user_id, name, color, category_id?, parent_id?, deadline? }
router.post('/', (req, res) => {
  const { user_id, name, color, category_id = null, parent_id = null, deadline = null } = req.body;

  if (!user_id || !name || !color) {
    return fail(res, 'user_id, name, color는 필수입니다.');
  }

  const stmt = db.prepare(`
    INSERT INTO projects (user_id, category_id, parent_id, name, color, deadline)
    VALUES (@user_id, @category_id, @parent_id, @name, @color, @deadline)
  `);

  try {
    const info = stmt.run({ user_id, category_id, parent_id, name, color, deadline });
    const created = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PATCH /api/projects/bulk  (다중 선택 후 일괄 이동)
// body: { project_ids: [1,2,3], category_id?, parent_id? }
// 반드시 /:id 라우트보다 위에 있어야 '/bulk'가 :id로 잘못 매칭되지 않음.
router.patch('/bulk', (req, res) => {
  const { project_ids, ...updates } = req.body;
  if (!Array.isArray(project_ids) || project_ids.length === 0) {
    return fail(res, 'project_ids는 비어있지 않은 배열이어야 합니다.');
  }
  if (updates.parent_id != null && project_ids.includes(updates.parent_id)) {
    return fail(res, '프로젝트를 자기 자신의 하위로 옮길 수 없습니다.');
  }

  const allowed = ['category_id', 'parent_id', 'deleted_at'];
  const fields = allowed.filter((key) => key in updates);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');

  const txn = db.transaction((ids) => {
    const stmt = db.prepare(
      `UPDATE projects SET ${setClause}, updated_at = @updated_at WHERE id = @id`
    );
    const results = [];
    for (const id of ids) {
      const params = { id, updated_at: new Date().toISOString() };
      fields.forEach((key) => (params[key] = updates[key]));
      stmt.run(params);
      results.push(db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id));
    }
    return results;
  });

  try {
    return ok(res, txn(project_ids));
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 프로젝트를 찾을 수 없습니다.', 404);

  const updatable = ['name', 'color', 'category_id', 'parent_id', 'deadline', 'last_task_updated_at'];
  const fields = updatable.filter((key) => key in req.body);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');
  const params = { id: req.params.id, updated_at: new Date().toISOString() };
  fields.forEach((key) => (params[key] = req.body[key]));

  db.prepare(`UPDATE projects SET ${setClause}, updated_at = @updated_at WHERE id = @id`).run(params);

  const updated = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
  return ok(res, updated);
});

// DELETE /api/projects/:id  (soft delete)
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 프로젝트를 찾을 수 없습니다.', 404);

  db.prepare(`UPDATE projects SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    req.params.id
  );

  return ok(res, { id: Number(req.params.id), deleted: true });
});

module.exports = router;
