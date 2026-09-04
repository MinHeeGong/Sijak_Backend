// index.js
const express = require('express');
const cors = require('cors');
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

const app = express();
// Render 같은 호스팅 서비스는 앱마다 랜덤한 포트를 배정하고
// process.env.PORT로 알려줍니다. 로컬 개발 시엔 이 값이 없으니 4000을 기본값으로 사용.
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// 기존에 있던 GET 확인용 엔드포인트는 그대로 두셔도 됩니다.
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: 'ok' });
});

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
