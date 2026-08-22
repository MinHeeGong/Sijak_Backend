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

function loadRecentHistory(userId, limit = 20) {
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
    let messages = loadRecentHistory(user_id, 20);

    // 3) Claude 호출 -> 함수 호출이 나오면 실행 후 결과를 다시 넣어서 재호출 (반복)
    let finalText = '';
    for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
      const response = await callClaude({ system: SYSTEM_PROMPT, messages, tools });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks = response.content.filter((b) => b.type === 'text');

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
