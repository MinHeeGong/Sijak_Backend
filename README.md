# Tdi.ai Backend (예제 스켈레톤)

## PowerShell 셋업 명령어

```powershell
cd backend
pnpm add express cors better-sqlite3
pnpm run db:init   # scheduler.db 최초 생성 (schema.sql 적용)
pnpm start         # http://localhost:4000
```

DB를 처음부터 다시 만들고 싶으면 `db/scheduler.db` 파일을 지우고 `pnpm run db:init`을 다시 실행하세요.

## 구조

```
backend/
  db/
    schema.sql        # 스키마 원본 (Claude와 정한 최신 버전)
    connection.js      # DB 연결 (better-sqlite3, 앱 전체 공유)
    init.js             # 스키마 최초 적용 스크립트
  routes/
    tasks.js            # tasks CRUD (기준 패턴 - 다른 테이블도 이 구조로 복제)
  utils/
    respond.js          # { success, data } 응답 포맷 통일
  index.js               # Express 앱 진입점
```

## 이미 검증된 것

- `POST /api/tasks`: `category_id` 없이 호출 시 400 에러 반환 확인
- `POST /api/tasks`: 정상 생성 + `deletion_policy`에 따른 `expires_at` 자동 계산 확인
- `GET /api/tasks?user_id=`: soft delete 안 된 것만 조회 확인
- `PUT /api/tasks/:id`: 부분 필드 수정 확인
- `DELETE /api/tasks/:id`: soft delete(실제 row는 안 지워짐, `deleted_at`만 채워짐) 확인

## 다음에 할 일

1. `routes/tasks.js` 패턴을 그대로 복제해서 `routes/categories.js`, `routes/schedules.js`, `routes/priority_pins.js` 등 만들기
2. `index.js`에 라우트 추가 (`app.use('/api/categories', categoriesRouter)` 형태)
3. LLM 함수(add_task, classify_priority 등) 호출 시 이 엔드포인트들을 그대로 재사용하도록 연결
4. 만료된 soft-deleted 항목 정리용 n8n 크론잡 (또는 간단히는 `node-cron`)으로 `expires_at` 지난 row 처리
