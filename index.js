// index.js
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const tasksRouter = require('./routes/tasks');
const categoriesRouter = require('./routes/categories');
const projectsRouter = require('./routes/projects');
const schedulesRouter = require('./routes/schedules');
const priorityPinsRouter = require('./routes/priority_pins');
const energyLogsRouter = require('./routes/energy_logs');
const eventFollowupsRouter = require('./routes/event_followups');
const dailyMemosRouter = require('./routes/daily_memos');
const userSettingsRouter = require('./routes/user_settings');
const chatRouter = require('./routes/chat');
const authRouter = require('./routes/auth');

const app = express();
// Render 같은 호스팅 서비스는 앱마다 랜덤한 포트를 배정하고
// process.env.PORT로 알려줍니다. 로컬 개발 시엔 이 값이 없으니 4000을 기본값으로 사용.
const PORT = process.env.PORT || 4000;

// 로그인 쿠키를 쓰려면 CORS가 origin을 '*'가 아니라 정확한 프론트 주소로,
// credentials: true로 열어줘야 함 (쿠키 포함 요청은 와일드카드 origin과 같이 못 씀).
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// 기존에 있던 GET 확인용 엔드포인트는 그대로 두셔도 됩니다.
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/priority-pins', priorityPinsRouter);
app.use('/api/energy-logs', energyLogsRouter);
app.use('/api/event-followups', eventFollowupsRouter);
app.use('/api/daily-memos', dailyMemosRouter);
app.use('/api/user-settings', userSettingsRouter);
app.use('/api/chat', chatRouter);

app.listen(PORT, () => {
  console.log(`Sijak backend listening on http://localhost:${PORT}`);
});
