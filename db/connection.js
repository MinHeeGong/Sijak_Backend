// db/connection.js
// scheduler.db 연결을 앱 전체에서 하나만 공유해서 씁니다 (better-sqlite3는 동기 API).
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'scheduler.db');

const db = new Database(DB_PATH);

// SQLite는 기본적으로 FK 제약이 꺼져 있어서, 연결마다 켜줘야 합니다.
db.pragma('foreign_keys = ON');

module.exports = db;
