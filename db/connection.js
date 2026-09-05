// db/connection.js
// scheduler.db 연결을 앱 전체에서 하나만 공유해서 씁니다 (better-sqlite3는 동기 API).
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'scheduler.db');

const db = new Database(DB_PATH);

// SQLite는 기본적으로 FK 제약이 꺼져 있어서, 연결마다 켜줘야 합니다.
db.pragma('foreign_keys = ON');

// Render 같은 호스팅은 배포/재시작마다 파일시스템을 새로 시작해서
// scheduler.db가 비어있는 상태로 켜질 수 있습니다. 서버가 뜰 때마다
// 스키마를 항상 적용해두면(테이블이 이미 있으면 CREATE TABLE IF NOT EXISTS라
// 아무 일도 안 일어남) "no such table" 에러를 원천적으로 방지할 수 있습니다.
const schemaPath = path.join(__dirname, 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf-8'));

// CREATE TABLE IF NOT EXISTS는 이미 존재하는 테이블엔 새 컬럼을 추가해주지 않아서,
// 이전에 만들어진 scheduler.db(서버가 이미 한 번이라도 떠서 users/user_settings가
// 옛날 스키마로 이미 존재하는 경우)에는 이 마이그레이션이 따로 필요함.
// ALTER TABLE ADD COLUMN은 이미 있으면 에러가 나므로 매번 try/catch로 무시.
function safeAddColumn(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}
safeAddColumn('users', `provider TEXT`);
safeAddColumn('users', `provider_user_id TEXT`);
safeAddColumn('user_settings', `purpose TEXT`);
safeAddColumn('user_settings', `planning_type INTEGER`);
safeAddColumn('user_settings', `burnout_signal INTEGER`);
safeAddColumn('user_settings', `adhd_signal INTEGER`);
safeAddColumn('user_settings', `onboarding_notes TEXT`);
safeAddColumn('user_settings', `onboarding_completed INTEGER NOT NULL DEFAULT 0`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_user_id)`);

// 프론트엔드가 로그인 기능이 생기기 전까지 user_id=1로 고정해서 요청을 보냅니다.
// 배포 환경마다 이 유저가 실제로 존재해야 task/schedule 등을 만들 때
// FOREIGN KEY constraint failed가 나지 않으므로, 없으면 자동으로 만들어둡니다.
db.prepare(`INSERT OR IGNORE INTO users (id, email) VALUES (1, 'demo@tdi.ai')`).run();
db.prepare(`INSERT OR IGNORE INTO user_settings (user_id, timezone) VALUES (1, 'Asia/Seoul')`).run();

module.exports = db;
