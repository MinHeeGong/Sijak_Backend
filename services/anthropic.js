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
      max_tokens: 1024,
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
