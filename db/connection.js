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

module.exports = db;
