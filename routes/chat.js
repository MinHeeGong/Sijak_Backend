// routes/chat.js
const express = require('express');
const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');
const { callClaude } = require('../services/anthropic');
const { tools } = require('../services/tools');
const { executors } = require('../services/toolExecutors');
const { SYSTEM_PROMPT } = require('../services/systemPrompt');

const router = express.Router();

const MAX_TOOL_LOOPS = 6; // 무한루프 방지 (함수 호출이 이 횟수를 넘으면 강제 종료)

const PURPOSE_LABELS = {
  project_mgmt: '프로젝트 관리',
  simple_schedule: '단순 일정관리',
  priority_mgmt: '우선순위 정리',
  low_activation: '시작하는 것 자체가 힘든 상태 (에너지 낮음, 작게 쪼개서 제안 필요)',
};

// assignment_mode에 더해, 온보딩에서 받은 목적/상태 신호도 같이 로드.
// (온보딩 페이지를 만들어도 여기서 실제로 안 읽으면 무용지물이라 함께 처리)
function loadUserContext(userId) {
  db.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`).run(userId);
  return db
    .prepare(
      `SELECT assignment_mode, purpose, planning_type, burnout_signal, adhd_signal, onboarding_notes
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId);
}

function loadRecentHistory(userId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT role, content FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit);

  // DB는 최신순으로 가져왔으니 시간순으로 뒤집고, Claude가 이해하는 형태로 변환
  return rows.reverse().map((r) => ({
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.content,
  }));
}

function saveMessage(userId, role, content) {
  db.prepare(`INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)`).run(
    userId,
    role,
    content
  );
}

function logAction(conversationRowId, actionType, payload) {
  db.prepare(`INSERT INTO action_logs (conversation_id, action_type, payload) VALUES (?, ?, ?)`).run(
    conversationRowId,
    actionType,
    JSON.stringify(payload)
  );
}

// POST /api/chat
// body: { user_id, message }
router.post('/', async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) return fail(res, 'user_id, message는 필수입니다.');

  try {
    // 1) 유저 메시지 저장
    saveMessage(user_id, 'user', message);
    const userMsgRow = db
      .prepare(`SELECT id FROM conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
      .get(user_id);

    // 2) 최근 대화 이력 + 이번 메시지로 messages 배열 구성
    let messages = loadRecentHistory(user_id, 12);

    // system prompt는 assignment_mode에 따라 동작이 달라진다고 설명하고 있었지만,
    // 정작 실제 값을 한 번도 전달받은 적이 없었음 (버그) - 여기서 실제 값을 주입.
    // system prompt는 assignment_mode에 따라 동작이 달라진다고 설명하고 있었지만,
    // 정작 실제 값을 한 번도 전달받은 적이 없었음 (버그) - 여기서 실제 값을 주입.
    // + 온보딩에서 받은 목적/상태 신호도 같이 넣어서 개인화에 실제로 반영되게 함.
    const ctx = loadUserContext(user_id);
    const signals = [];
    if (ctx.burnout_signal === 1) signals.push('번아웃 신호 있음 (하루 시작이 유독 힘들다고 응답)');
    if (ctx.adhd_signal === 1) signals.push('할일이 많아지면 오히려 손을 못 대는 편이라고 응답 (ADHD 유사 패턴)');
    if (ctx.planning_type === 0) signals.push('계획을 세워도 잘 안 지키는 편이라고 응답 (너무 빡빡한 계획 지양)');

    const dynamicSystem = `${SYSTEM_PROMPT}

## 현재 유저 설정 (실시간 값)
- user_settings.assignment_mode = "${ctx.assignment_mode}"
  (auto: 확인 없이 즉시 배치 / ask: 배치 전 반드시 확인받고 승낙 시에만 함수 호출)
- 온보딩 목적: ${ctx.purpose ? PURPOSE_LABELS[ctx.purpose] ?? ctx.purpose : '미설정 (온보딩 건너뜀 - 일반적으로 대응)'}
- 상태 신호: ${signals.length > 0 ? signals.join(' / ') : '없음'}
- 유저가 직접 남긴 참고 메모: ${ctx.onboarding_notes ? `"${ctx.onboarding_notes}"` : '없음'}`;

    // 3) Claude 호출 -> 함수 호출이 나오면 실행 후 결과를 다시 넣어서 재호출 (반복)
    let finalText = '';
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const response = await callClaude({ system: dynamicSystem, messages, tools });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks = response.content.filter((b) => b.type === 'text');

      // present_choices는 DB에 아무 영향 없는 UI 전용 pseudo-tool. 나오면 다른 tool
      // 호출을 실행하지 않고 바로 여기서 끊어서 프론트에 선택지를 구조화된 형태로 전달.
      const choiceBlock = toolUseBlocks.find((b) => b.name === 'present_choices');
      if (choiceBlock) {
        const { prompt: choicePrompt, options } = choiceBlock.input;
        saveMessage(user_id, 'assistant', choicePrompt);
        logAction(userMsgRow.id, 'present_choices', { input: choiceBlock.input });
        return ok(res, { reply: choicePrompt, choices: options });
      }

      if (toolUseBlocks.length === 0) {
        // 함수 호출 없이 텍스트만 왔으면 대화 종료
        finalText = textBlocks.map((b) => b.text).join('\n');
        break;
      }

      // 함수 호출들을 실제로 실행
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const executor = executors[block.name];
        let resultPayload;
        try {
          if (!executor) throw new Error(`알 수 없는 함수: ${block.name}`);
          resultPayload = executor(user_id, block.input);
          logAction(userMsgRow.id, block.name, { input: block.input, result: resultPayload });
        } catch (err) {
          resultPayload = { error: err.message };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(resultPayload),
        });
      }

      // assistant의 tool_use 메시지 + 그 결과(tool_result)를 대화에 이어붙여서 재호출
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];

      // 마지막 루프였는데도 계속 함수 호출 중이면, 지금까지의 텍스트라도 반환
      if (i === MAX_TOOL_LOOPS - 1) {
        finalText = textBlocks.map((b) => b.text).join('\n') || '요청을 처리했어요.';
      }
    }

    // 4) 최종 답변 저장 + 반환
    saveMessage(user_id, 'assistant', finalText);
    return ok(res, { reply: finalText });
  } catch (err) {
    console.error('chat 처리 실패', err);
    return fail(res, err.message, 500);
  }
});

module.exports = router;
