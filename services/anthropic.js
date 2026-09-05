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
      // 응답을 2~3문장으로 제한하는 systemPrompt 지침이 주된 제어 수단이고,
      // 이 값은 물리적 안전장치. 너무 낮으면(예전 1024) 정상적으로 긴 답이
      // 필요한 경우(리스트 나열 등) 잘릴 수 있어서 800으로 여유를 둠.
      max_tokens: 800,
      // system을 문자열이 아니라 cache_control 붙은 블록으로 감싸서 prompt caching 적용.
      // chat.js가 매 요청 (거의 동일한) 긴 시스템 프롬프트 + 유저 설정을 다시 보내고 있어서,
      // 이렇게 하면 5분 이내 재요청은 이 블록을 다시 처리하지 않고 캐시를 씀 -> 응답 속도/비용 개선.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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
