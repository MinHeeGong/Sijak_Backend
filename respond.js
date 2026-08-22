// utils/respond.js
// 코드 가이드라인 규칙: API 응답은 항상 { success, data } 형태로 통일.

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 400) {
  return res.status(status).json({ success: false, error: message });
}

module.exports = { ok, fail };
