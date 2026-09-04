// services/anthropic.js
// Node 18+ 기본 내장 fetch를 사용합니다 (별도 SDK 설치 없이 동작).

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

async function callClaude({ system, messages, tools }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY 환경변수가 설정되어 있지 않습니다. Render > Environment에 등록해주세요.'
    );
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      // 1024였던 걸 4096으로 올림 - 길게 답할 때 문장 중간에서 잘리던 버그의 원인.
      // (참고: MAX_TOOL_LOOPS 안에서 도구 호출을 여러 번 거치는 경우엔 이 값과 별개로
      //  services/chat.js의 반복 횟수 제한 때문에 끊길 수 있음 - 그건 별도 이슈로 관리 중)
      max_tokens: 4096,
      system,
      messages,
      tools,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API 오류 (${res.status}): ${text}`);
  }

  return res.json();
}

module.exports = { callClaude };
