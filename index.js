// index.js
const express = require('express');
const cors = require('cors');
const tasksRouter = require('./routes/tasks');
const categoriesRouter = require('./routes/categories');
const schedulesRouter = require('./routes/schedules');
const priorityPinsRouter = require('./routes/priority_pins');
const energyLogsRouter = require('./routes/energy_logs');
const eventFollowupsRouter = require('./routes/event_followups');

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// 기존에 있던 GET 확인용 엔드포인트는 그대로 두셔도 됩니다.
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: 'ok' });
});

app.use('/api/tasks', tasksRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/priority-pins', priorityPinsRouter);
app.use('/api/energy-logs', energyLogsRouter);
app.use('/api/event-followups', eventFollowupsRouter);

app.listen(PORT, () => {
  console.log(`Tdi.ai backend listening on http://localhost:${PORT}`);
});
