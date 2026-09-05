// services/toolExecutors.js
// chat.js가 Claude로부터 받은 tool_use 블록을 이 함수들로 실행합니다.
// routes/*.js와 로직이 겹치지만(카테고리 생성, task 생성 등), 여긴 HTTP 계층을
// 거치지 않고 DB에 직접 접근합니다 (같은 프로세스 안이라 굳이 자기 자신에게
// HTTP 요청을 보낼 필요가 없어서).

const db = require('../db/connection');
const { toLocalDate } = require('../utils/localDate');

const DEFAULT_COLOR_PALETTE = ['#D5F1FF', '#E4DCFC', '#CCFAE4', '#CBF0EA', '#FDF0DC', '#FDDFEB'];

function getUserTimezone(userId) {
  const row = db.prepare(`SELECT timezone FROM user_settings WHERE user_id = ?`).get(userId);
  return row ? row.timezone : 'Asia/Seoul';
}

// ---- find_tasks ----
function findTasks(userId, { keyword }) {
  const rows = db
    .prepare(
      `SELECT t.id AS task_id, t.title, t.due_date, c.name AS category_name,
              s.id AS schedule_id, s.start_at, s.end_at
       FROM tasks t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN schedules s ON s.task_id = t.id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.title LIKE ?
       ORDER BY t.created_at DESC
       LIMIT 10`
    )
    .all(userId, `%${keyword}%`);

  return { matches: rows };
}

// ---- create_category ----
function createCategory(userId, { name, parent_id = null }) {
  const existing = db
    .prepare(`SELECT color FROM categories WHERE user_id = ? AND deleted_at IS NULL`)
    .all(userId)
    .map((r) => r.color);

  const nextColor =
    DEFAULT_COLOR_PALETTE.find((c) => !existing.includes(c)) ??
    DEFAULT_COLOR_PALETTE[existing.length % DEFAULT_COLOR_PALETTE.length];

  const info = db
    .prepare(`INSERT INTO categories (user_id, parent_id, name, color) VALUES (?, ?, ?, ?)`)
    .run(userId, parent_id, name, nextColor);

  return db.prepare(`SELECT * FROM categories WHERE id = ?`).get(info.lastInsertRowid);
}

function findCategoryByName(userId, name) {
  return db
    .prepare(
      `SELECT * FROM categories WHERE user_id = ? AND deleted_at IS NULL AND name = ? LIMIT 1`
    )
    .get(userId, name);
}

// ---- add_task ----
function addTask(userId, { title, category_id, category_name, memo, due_date, estimated_minutes }) {
  let categoryId = category_id ?? null;

  if (!categoryId && category_name) {
    const found = findCategoryByName(userId, category_name);
    categoryId = found ? found.id : createCategory(userId, { name: category_name }).id;
  }

  if (!categoryId) {
    throw new Error('category_id 또는 category_name 중 하나는 필요합니다.');
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (user_id, category_id, title, memo, due_date, estimated_minutes, deletion_policy, expires_at)
       VALUES (@user_id, @category_id, @title, @memo, @due_date, @estimated_minutes, '24h', datetime('now', '+1 day'))`
    )
    .run({
      user_id: userId,
      category_id: categoryId,
      title,
      memo: memo ?? null,
      due_date: due_date ?? null,
      estimated_minutes: estimated_minutes ?? null,
    });

  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid);
}

// ---- classify_priority ----
function classifyPriority(userId, { task_id, ai_urgency, ai_importance, ai_reasoning }) {
  if (ai_urgency < 0 || ai_urgency > 1 || ai_importance < 0 || ai_importance > 1) {
    throw new Error('ai_urgency, ai_importance는 0.0~1.0 범위여야 합니다.');
  }

  db.prepare(
    `INSERT INTO priority_pins (task_id, ai_urgency, ai_importance, ai_reasoning, is_ai_classified)
     VALUES (@task_id, @ai_urgency, @ai_importance, @ai_reasoning, 1)
     ON CONFLICT(task_id) DO UPDATE SET
       ai_urgency = excluded.ai_urgency,
       ai_importance = excluded.ai_importance,
       ai_reasoning = excluded.ai_reasoning,
       is_ai_classified = 1,
       updated_at = datetime('now')`
  ).run({ task_id, ai_urgency, ai_importance, ai_reasoning });

  return db.prepare(`SELECT * FROM priority_pins WHERE task_id = ?`).get(task_id);
}

// ---- schedule_task ----
function scheduleTask(userId, { task_id, start_at, end_at }) {
  const timezone = getUserTimezone(userId);
  const localDate = toLocalDate(start_at, timezone);

  const info = db
    .prepare(`INSERT INTO schedules (task_id, start_at, end_at, local_date) VALUES (?, ?, ?, ?)`)
    .run(task_id, start_at, end_at, localDate);

  return db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(info.lastInsertRowid);
}

// ---- schedule_tasks_batch ----
function scheduleTasksBatch(userId, { items }) {
  return items.map((item) => scheduleTask(userId, item));
}

// ---- reschedule_task ----
function rescheduleTask(userId, { schedule_id, start_at, end_at }) {
  const timezone = getUserTimezone(userId);
  const localDate = toLocalDate(start_at, timezone);

  db.prepare(
    `UPDATE schedules SET start_at = ?, end_at = ?, local_date = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(start_at, end_at, localDate, schedule_id);

  return db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(schedule_id);
}

// ---- log_energy ----
function logEnergy(userId, { date, time_slot, energy_level }) {
  if (energy_level < 1 || energy_level > 5) {
    throw new Error('energy_level은 1~5 사이여야 합니다.');
  }

  const existing = db
    .prepare(`SELECT id FROM energy_logs WHERE user_id = ? AND date = ? AND time_slot = ?`)
    .get(userId, date, time_slot);

  if (existing) {
    db.prepare(`UPDATE energy_logs SET energy_level = ? WHERE id = ?`).run(energy_level, existing.id);
    return db.prepare(`SELECT * FROM energy_logs WHERE id = ?`).get(existing.id);
  }

  const info = db
    .prepare(`INSERT INTO energy_logs (user_id, date, time_slot, energy_level) VALUES (?, ?, ?, ?)`)
    .run(userId, date, time_slot, energy_level);

  return db.prepare(`SELECT * FROM energy_logs WHERE id = ?`).get(info.lastInsertRowid);
}

// ---- create_followup_flag ----
function createFollowupFlag(userId, { task_id, event_date }) {
  const info = db
    .prepare(`INSERT INTO event_followups (task_id, event_date) VALUES (?, ?)`)
    .run(task_id, event_date);

  return db.prepare(`SELECT * FROM event_followups WHERE id = ?`).get(info.lastInsertRowid);
}

// ---- complete_task ----
// "이거 했어" 류의 완료 처리. 여태 이 함수가 없어서 DB에 completed_at을 채울 방법이 없었음.
function completeTask(userId, { task_id }) {
  db.prepare(
    `UPDATE tasks SET completed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(task_id, userId);

  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(task_id);
}

// ---- update_task ----
// routes/tasks.js의 PUT 로직과 같은 패턴. 넘긴 필드만 갱신.
function updateTaskTool(userId, { task_id, ...updates }) {
  const allowed = ['title', 'memo', 'due_date', 'category_id', 'estimated_minutes'];
  const fields = allowed.filter((key) => key in updates);
  if (fields.length === 0) throw new Error('수정할 필드가 없습니다.');

  const setClause = fields.map((key) => `${key} = @${key}`).join(', ');
  const params = { task_id, updated_at: new Date().toISOString() };
  fields.forEach((key) => (params[key] = updates[key]));

  db.prepare(`UPDATE tasks SET ${setClause}, updated_at = @updated_at WHERE id = @task_id`).run(params);

  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(task_id);
}

// ---- delete_task ----
function deleteTaskTool(userId, { task_id }) {
  db.prepare(`UPDATE tasks SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`).run(task_id, userId);
  return { task_id, deleted: true };
}

// ---- find_schedules ----
// "내일 일정 뭐있어" 류 조회. reschedule_task에 필요한 schedule_id를 모델이 스스로
// 못 찾아서 막히는 경우가 많았던 것의 해결책.
function findSchedules(userId, { date, start_date, end_date }) {
  const from = start_date ?? date;
  const to = end_date ?? date;
  if (!from || !to) throw new Error('date 또는 start_date/end_date 중 하나는 필요합니다.');

  const rows = db
    .prepare(
      `SELECT s.id AS schedule_id, s.start_at, s.end_at, s.local_date, t.id AS task_id, t.title
       FROM schedules s
       JOIN tasks t ON t.id = s.task_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND s.local_date BETWEEN ? AND ?
       ORDER BY s.start_at ASC`
    )
    .all(userId, from, to);

  return { matches: rows };
}

// dispatch 테이블: tools.js의 name과 정확히 일치해야 함.
// present_choices는 여기 없음 - chat.js가 DB 실행 전에 먼저 가로채서 처리함.
const executors = {
  find_tasks: findTasks,
  create_category: createCategory,
  add_task: addTask,
  classify_priority: classifyPriority,
  schedule_task: scheduleTask,
  schedule_tasks_batch: scheduleTasksBatch,
  reschedule_task: rescheduleTask,
  log_energy: logEnergy,
  create_followup_flag: createFollowupFlag,
  complete_task: completeTask,
  update_task: updateTaskTool,
  delete_task: deleteTaskTool,
  find_schedules: findSchedules,
};

module.exports = { executors };
