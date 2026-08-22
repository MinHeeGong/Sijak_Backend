// db/init.js
// 최초 1회, 또는 스키마를 다시 잡을 때 실행: pnpm run db:init
// 주의: schema.sql은 CREATE TABLE이라 이미 테이블이 있으면 에러가 납니다.
//       초기화하려면 scheduler.db 파일을 지우고 다시 실행하세요.
const fs = require('fs');
const path = require('path');
const db = require('./connection');

const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

db.exec(schemaSql);

console.log('스키마 적용 완료:', db.name);
console.log(
  '테이블 목록:',
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
);
