// utils/localDate.js
// schedules.start_at(UTC ISO)을 유저의 user_settings.timezone 기준 'YYYY-MM-DD'로 변환.
// Intl.DateTimeFormat이 IANA 타임존을 직접 지원해서 별도 라이브러리 없이 처리 가능.

function toLocalDate(utcIsoString, timezone) {
  const date = new Date(utcIsoString);

  // en-CA 로케일은 YYYY-MM-DD 포맷을 그대로 반환해서 파싱이 필요 없음.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date); // 'YYYY-MM-DD'
}

module.exports = { toLocalDate };
