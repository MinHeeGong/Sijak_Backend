// routes/categories.js
// categories 리소스 CRUD. self-reference(parent_id)로 서브카테고리 지원.
// deleted_at은 soft delete. 실제 삭제 확인 팝업(30일 미갱신) 로직은
// 별도 배치/조회 엔드포인트에서 last_task_updated_at 기준으로 처리 예정(다음 단계).

const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

// GET /api/categories?user_id=1  (soft delete 안 된 것만, 트리 순서 아님 - 프론트에서 parent_id로 조립)
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return fail(res, 'user_id는 필수 쿼리 파라미터입니다.');

  const rows = db
    .prepare(
      `SELECT * FROM categories WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`
    )
    .all(user_id);

  return ok(res, rows);
});

// GET /api/categories/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '해당 카테고리를 찾을 수 없습니다.', 404);
  return ok(res, row);
});

// POST /api/categories
// body: { user_id, name, color, parent_id? }
router.post('/', (req, res) => {
  const { user_id, name, color, parent_id = null } = req.body;

  if (!user_id || !name || !color) {
    return fail(res, 'user_id, name, color는 필수입니다.');
  }

  const stmt = db.prepare(`
    INSERT INTO categories (user_id, parent_id, name, color)
    VALUES (@user_id, @parent_id, @name, @color)
  `);

  try {
    const info = stmt.run({ user_id, parent_id, name, color });
    const created = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(info.lastInsertRowid);
    return ok(res, created, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PATCH /api/categories/bulk  (마인드맵뷰: 라쏘로 다중 선택 후 부모 카테고리 일괄 변경)
// body: { category_ids: [1,2,3], parent_id }  (parent_id는 null 가능 - 최상위로 이동)
// 반드시 /:id 라우트보다 위에 있어야 '/bulk'가 :id로 잘못 매칭되지 않음.
router.patch('/bulk', (req, res) => {
  const { category_ids, parent_id = null } = req.body;
  if (!Array.isArray(category_ids) || category_ids.length === 0) {
    return fail(res, 'category_ids는 비어있지 않은 배열이어야 합니다.');
  }
  if (parent_id != null && category_ids.includes(parent_id)) {
    return fail(res, '카테고리를 자기 자신(또는 선택된 항목)의 하위로 옮길 수 없습니다.');
  }

  const txn = db.transaction((ids) => {
    const stmt = db.prepare(
      `UPDATE categories SET parent_id = @parent_id, updated_at = @updated_at WHERE id = @id`
    );
    const results = [];
    for (const id of ids) {
      stmt.run({ id, parent_id, updated_at: new Date().toISOString() });
      results.push(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id));
    }
    return results;
  });

  try {
    return ok(res, txn(category_ids));
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

// PUT /api/categories/:id  (이름/색상 변경 등)
router.put('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 카테고리를 찾을 수 없습니다.', 404);

  const updatable = ['name', 'color', 'parent_id', 'last_task_updated_at'];
  const fields = updatable.filter((key) => key in req.body);
  if (fields.length === 0) return fail(res, '수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');
  const params = { id: req.params.id, updated_at: new Date().toISOString() };
  fields.forEach((key) => (params[key] = req.body[key]));

  db.prepare(`UPDATE categories SET ${setClause}, updated_at = @updated_at WHERE id = @id`).run(params);

  const updated = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  return ok(res, updated);
});

// DELETE /api/categories/:id  (soft delete)
router.delete('/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  if (!existing) return fail(res, '해당 카테고리를 찾을 수 없습니다.', 404);

  db.prepare(`UPDATE categories SET deleted_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    req.params.id
  );

  return ok(res, { id: Number(req.params.id), deleted: true });
});

module.exports = router;
