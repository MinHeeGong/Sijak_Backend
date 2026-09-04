-- =========================================================
-- Tdi.ai 스키마 (DDL 초안 v1)
-- SQLite3 기준. 파일 상단에서 FK 제약을 켜야 동작합니다:
--   PRAGMA foreign_keys = ON;
-- =========================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------
-- 2. user_settings
--    - 유저 1:1. 온보딩/개인화 설정값.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL UNIQUE
                            REFERENCES users(id) ON DELETE CASCADE,
  assignment_mode         TEXT NOT NULL DEFAULT 'ask'
                            CHECK (assignment_mode IN ('auto', 'ask')),
  timezone                TEXT NOT NULL DEFAULT 'Asia/Seoul', -- IANA 타임존 (예: 'Asia/Seoul')
  priority_trigger_words  TEXT,              -- JSON 배열 문자열로 저장 (예: '["마감","급함"]')
  inactivity_days         INTEGER NOT NULL DEFAULT 30,   -- 카테고리/프로젝트 미갱신 삭제 문의 기준일
  default_deletion_policy TEXT NOT NULL DEFAULT '24h'
                            CHECK (default_deletion_policy IN ('24h', '7d', '30d', 'manual')),
  max_habits_per_day      INTEGER NOT NULL DEFAULT 10,
  color_order             TEXT NOT NULL DEFAULT '["#D5F1FF","#E4DCFC","#CCFAE4","#CBF0EA","#FDF0DC","#FDDFEB"]',
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------
-- 3. categories
--    - 카테고리/서브카테고리 트리 (self-reference).
--    - project는 별도 테이블(projects)로 분리됨 (아래 3-1 참고).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL
                          REFERENCES users(id) ON DELETE CASCADE,
  parent_id             INTEGER
                          REFERENCES categories(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  color                 TEXT NOT NULL,        -- 카테고리 단위로 적용되는 색상
  last_task_updated_at  TEXT NOT NULL DEFAULT (datetime('now')), -- 30일 미갱신 판단 기준
  deleted_at            TEXT,                 -- soft delete
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categories_user      ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent    ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_last_used ON categories(last_task_updated_at);

-- ---------------------------------------------------------
-- 3-1. projects
--      - 마감일/진행률 등 project 고유 필드를 가지므로 분리.
--      - category 하위일 수도, 최상위(category_id null)일 수도 있음.
--      - 서브프로젝트는 parent_id self-reference로 지원.
--      - progress(진행률)는 컬럼으로 저장하지 않고, 하위 tasks의
--        완료/전체 개수를 조회 시점에 계산해서 사용 (COUNT 쿼리).
--        추후 성능 문제가 생기면 캐싱 컬럼을 추가하는 방향으로 전환.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL
                          REFERENCES users(id) ON DELETE CASCADE,
  category_id           INTEGER
                          REFERENCES categories(id) ON DELETE SET NULL, -- nullable: 최상위 프로젝트 허용
  parent_id             INTEGER
                          REFERENCES projects(id) ON DELETE CASCADE,    -- 서브프로젝트
  name                  TEXT NOT NULL,
  color                 TEXT NOT NULL,
  deadline              TEXT,                 -- 'YYYY-MM-DD', 없으면 마감일 미설정
  last_task_updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT,                 -- soft delete
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user      ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_category  ON projects(category_id);
CREATE INDEX IF NOT EXISTS idx_projects_parent    ON projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_last_used ON projects(last_task_updated_at);

-- ---------------------------------------------------------
-- 4. tasks
--    - 모든 할일의 원본. category 필수(FK not null).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL
                     REFERENCES users(id) ON DELETE CASCADE,
  category_id      INTEGER NOT NULL
                     REFERENCES categories(id) ON DELETE RESTRICT,
  project_id       INTEGER
                     REFERENCES projects(id) ON DELETE SET NULL,  -- nullable: project 소속은 선택
  title            TEXT NOT NULL,
  memo             TEXT,
  due_date         TEXT,                     -- 'YYYY-MM-DD', 유저가 언급한 개별 task 마감일 (nullable)
  estimated_minutes INTEGER,                 -- AI가 예측한 소요 시간
  deletion_policy  TEXT NOT NULL DEFAULT '24h'
                     CHECK (deletion_policy IN ('24h', '7d', '30d', 'manual')),
  expires_at       TEXT,                     -- deletion_policy에 따라 계산되어 채워짐
  completed_at     TEXT,                     -- 완료 시각 (통계/회고용, null이면 미완료)
  deleted_at       TEXT,                     -- soft delete
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user       ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category   ON tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project    ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date   ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_expires_at ON tasks(expires_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);

-- ---------------------------------------------------------
-- 5. schedules
--    - task에 배정된 실제 시간 블록.
--    - 일간/주간은 같은 row를 다르게 렌더링만 함.
--    - 습관은 여기 들어가지 않음(가상 렌더링).
--
--    시간 저장 방식(유입 폭주 대비 + 타임존 정확성):
--    - start_at/end_at은 UTC 기준 ISO 8601 문자열로 저장
--      (예: '2026-08-20T00:00:00Z')
--    - local_date는 user_settings.timezone 기준으로 변환된
--      'YYYY-MM-DD' 값을 백엔드에서 계산해 캐싱한 것.
--      UTC 자정과 유저 로컬 자정이 어긋나는 경우(자정 근처 일정)
--      때문에, 일간/주간 그리드 조회를 date만으로 빠르게 필터링
--      하려면 이 컬럼이 필요함. 항상 start_at으로부터 재계산 가능한
--      파생값이라 데이터 정합성 문제는 없음.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL
                REFERENCES tasks(id) ON DELETE CASCADE,
  start_at    TEXT NOT NULL,                 -- UTC ISO 8601, 예: '2026-08-20T00:00:00Z'
  end_at      TEXT NOT NULL,                 -- UTC ISO 8601
  local_date  TEXT NOT NULL,                 -- 유저 타임존 기준 'YYYY-MM-DD' (캐시, start_at에서 파생)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_task       ON schedules(task_id);
CREATE INDEX IF NOT EXISTS idx_schedules_local_date ON schedules(local_date);

-- ---------------------------------------------------------
-- 6. priority_pins
--    - 아이젠하워 매트릭스 좌표. task 1:1.
--    - AI값과 유저값을 분리 저장, 판단 근거도 보존.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS priority_pins (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id            INTEGER NOT NULL UNIQUE
                       REFERENCES tasks(id) ON DELETE CASCADE,
  ai_urgency         REAL,                   -- 연속값, 0.0 ~ 1.0 권장
  ai_importance      REAL,
  ai_reasoning       TEXT,                   -- "왜 이렇게 판단했는지" 되짚기용
  user_urgency       REAL,                   -- 유저가 드래그로 덮어쓴 값 (null이면 미수정)
  user_importance    REAL,
  is_ai_classified   INTEGER NOT NULL DEFAULT 0 CHECK (is_ai_classified IN (0, 1)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 최종 표시 좌표는 (user_urgency ?? ai_urgency), (user_importance ?? ai_importance)로
-- 애플리케이션/뷰 레벨에서 계산. 4개 탭(최우선/무조건/덜 급함/언젠가)도 이 값 기반 파생.

-- ---------------------------------------------------------
-- 7. habits
--    - 습관 기본 설정. task 1:1 참조.
--    - default_start_time/end_time은 UTC가 아니라 유저 로컬 시계
--      기준 'HH:MM'으로 유지. "매일 아침 9시"는 절대 시각이 아니라
--      유저 타임존 기준 반복 패턴이라 UTC로 저장하면 계산이 오히려
--      복잡해짐(서머타임 등). 실제 렌더링 시에는 user_settings.timezone +
--      이 값을 조합해 그날의 로컬 시간으로 표시.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS habits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id             INTEGER NOT NULL UNIQUE
                        REFERENCES tasks(id) ON DELETE CASCADE,
  default_start_time  TEXT NOT NULL,         -- 로컬 'HH:MM'
  default_end_time    TEXT NOT NULL,         -- 로컬 'HH:MM'
  default_duration    INTEGER,               -- 분 단위, start/end와 별개로 명시 가능
  target_cycle        INTEGER NOT NULL DEFAULT 10
                        CHECK (target_cycle IN (10, 20, 30)),
  current_day         INTEGER NOT NULL DEFAULT 0,   -- 진행 일차
  status               TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'stopped')),
  color                TEXT NOT NULL,         -- 월간 달력 점 색상 (최근 사용 색과 다르게 기본 지정)
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------
-- 8. habit_daily_overrides
--    - 특정 날짜만 시간을 다르게 세팅한 경우.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_daily_overrides (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id    INTEGER NOT NULL
                REFERENCES habits(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  duration    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (habit_id, date)
);

-- ---------------------------------------------------------
-- 9. habit_logs
--    - 일자별 달성 여부. 월간 캘린더 점 표시용.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id    INTEGER NOT NULL
                REFERENCES habits(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  completed   INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (habit_id, date)
);

CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(date);

-- ---------------------------------------------------------
-- 10. energy_logs
--     - 시간대별 에너지 상태 (독립 로그).
--     - AI가 "이 시간대 평소 에너지"를 참조할 때 사용.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS energy_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL
                 REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,                -- 'YYYY-MM-DD'
  time_slot    TEXT NOT NULL,                -- 예: '09:00-10:00'
  energy_level INTEGER NOT NULL CHECK (energy_level BETWEEN 1 AND 5),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_energy_logs_user_date ON energy_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_energy_logs_slot      ON energy_logs(time_slot);

-- ---------------------------------------------------------
-- 11. conversations
--     - 순수 대화 turn만 저장 (텍스트).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_created ON conversations(user_id, created_at);

-- ---------------------------------------------------------
-- 12. action_logs
--     - AI 함수 호출 기록. conversations와 FK로 연결.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL
                     REFERENCES conversations(id) ON DELETE CASCADE,
  action_type      TEXT NOT NULL,            -- 예: 'add_task', 'reschedule', 'classify'
  payload          TEXT,                     -- JSON 문자열
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_logs_conversation ON action_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_type         ON action_logs(action_type);

-- ---------------------------------------------------------
-- 13. event_followups
--     - "8/14 발표 어떠셨어요" 같은 사후 언급 플래그.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_followups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL
                    REFERENCES tasks(id) ON DELETE CASCADE,
  event_date      TEXT NOT NULL,             -- 'YYYY-MM-DD'
  followup_shown  INTEGER NOT NULL DEFAULT 0 CHECK (followup_shown IN (0, 1)),
  user_response   TEXT
                    CHECK (user_response IN ('acknowledged', 'declined', NULL)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_followups_task  ON event_followups(task_id);
CREATE INDEX IF NOT EXISTS idx_event_followups_shown ON event_followups(event_date, followup_shown);

-- ---------------------------------------------------------
-- 15. daily_memos
--     - 월간 캘린더 하단 메모 기능. 날짜당 1개만 허용.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_memos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,               -- 'YYYY-MM-DD'
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_memos_user_date ON daily_memos(user_id, date);
