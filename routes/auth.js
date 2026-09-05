// routes/auth.js
// Google/Kakao/Naver OAuth -> JWT를 httpOnly 쿠키에 저장하는 방식.
//
// 필요한 환경변수 (Render > Environment에 등록):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET   (카카오 앱 설정에서 시크릿 안 쓰면 빈 문자열도 가능)
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
//   JWT_SECRET       (임의의 긴 랜덤 문자열)
//   BACKEND_URL       (예: https://sijak-backend.onrender.com, 콜백 URL 생성에 사용)
//   FRONTEND_URL      (예: https://sijak.netlify.app, 로그인 성공 후 리다이렉트 대상)
//
// 위 provider별 client id/secret이 없으면 그 provider는 등록되지 않고,
// 버튼을 눌러도 "아직 설정 안 됨" 에러를 명확히 반환합니다 (서버가 죽지 않음).

const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: KakaoStrategy } = require('passport-kakao');
const { Strategy: NaverStrategy } = require('passport-naver-v2');

const db = require('../db/connection');
const { ok, fail } = require('../utils/respond');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const COOKIE_NAME = 'sijak_token';
const isProd = process.env.NODE_ENV === 'production';

// ---- 공통: OAuth 성공 시 유저 찾기/생성 ----
function findOrCreateUser(provider, providerUserId, email, displayName) {
  let user = db
    .prepare(`SELECT * FROM users WHERE provider = ? AND provider_user_id = ?`)
    .get(provider, providerUserId);

  if (!user) {
    const info = db
      .prepare(`INSERT INTO users (email, display_name, provider, provider_user_id) VALUES (?, ?, ?, ?)`)
      .run(email, displayName, provider, providerUserId);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
    db.prepare(`INSERT INTO user_settings (user_id, timezone) VALUES (?, 'Asia/Seoul')`).run(user.id);
  }
  return user;
}

function verifyCallback(provider, extractProfile) {
  return (accessToken, refreshToken, profile, done) => {
    try {
      const { providerUserId, email, displayName } = extractProfile(profile);
      const user = findOrCreateUser(provider, providerUserId, email, displayName);
      done(null, user);
    } catch (err) {
      done(err);
    }
  };
}

// ---- 프로바이더별 전략 등록 (env var 없으면 건너뜀) ----
const configured = { google: false, kakao: false, naver: false };

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/google/callback`,
        scope: ['profile', 'email'],
      },
      verifyCallback('google', (profile) => ({
        providerUserId: profile.id,
        email: profile.emails?.[0]?.value ?? `google_${profile.id}@sijak.local`,
        displayName: profile.displayName ?? null,
      }))
    )
  );
  configured.google = true;
}

if (process.env.KAKAO_CLIENT_ID) {
  passport.use(
    'kakao',
    new KakaoStrategy(
      {
        clientID: process.env.KAKAO_CLIENT_ID,
        clientSecret: process.env.KAKAO_CLIENT_SECRET || '',
        callbackURL: `${BACKEND_URL}/api/auth/kakao/callback`,
      },
      verifyCallback('kakao', (profile) => ({
        providerUserId: String(profile.id),
        email: profile._json?.kakao_account?.email ?? `kakao_${profile.id}@sijak.local`,
        displayName: profile.displayName ?? profile.username ?? null,
      }))
    )
  );
  configured.kakao = true;
}

if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
  passport.use(
    'naver',
    new NaverStrategy(
      {
        clientID: process.env.NAVER_CLIENT_ID,
        clientSecret: process.env.NAVER_CLIENT_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/naver/callback`,
      },
      verifyCallback('naver', (profile) => ({
        providerUserId: profile.id,
        email: profile.email ?? `naver_${profile.id}@sijak.local`,
        displayName: profile.name ?? profile.nickname ?? null,
      }))
    )
  );
  configured.naver = true;
}

function issueCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // 로컬(http)에서는 false여야 쿠키가 저장됨
    sameSite: isProd ? 'none' : 'lax', // 백엔드/프론트가 다른 도메인(Render/Netlify)이라 none 필요
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

// GET /api/auth/me  - 지금 로그인된 유저 + 온보딩 완료 여부 확인
// 주의: 반드시 아래 '/:provider' 라우트보다 먼저 선언해야 함
// (안 그러면 'me'가 provider 파라미터로 잘못 매칭됨).
router.get('/me', (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return fail(res, '로그인되어 있지 않아요.', 401);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return fail(res, '세션이 만료됐어요. 다시 로그인해주세요.', 401);
  }

  const user = db.prepare(`SELECT id, email, display_name, provider FROM users WHERE id = ?`).get(payload.sub);
  if (!user) return fail(res, '유저를 찾을 수 없어요.', 404);

  db.prepare(`INSERT OR IGNORE INTO user_settings (user_id, timezone) VALUES (?, 'Asia/Seoul')`).run(user.id);
  const settings = db
    .prepare(`SELECT assignment_mode, purpose, planning_type, burnout_signal, adhd_signal, onboarding_notes, onboarding_completed FROM user_settings WHERE user_id = ?`)
    .get(user.id);

  return ok(res, { user, settings });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' });
  return ok(res, { loggedOut: true });
});

// GET /api/auth/:provider  - 로그인 버튼이 이동할 주소
router.get('/:provider', (req, res, next) => {
  const { provider } = req.params;
  if (!configured[provider]) {
    return fail(
      res,
      `${provider} 로그인이 아직 설정되지 않았어요. 서버 환경변수(${provider.toUpperCase()}_CLIENT_ID 등)를 등록해주세요.`,
      501
    );
  }
  passport.authenticate(provider, { session: false })(req, res, next);
});

// GET /api/auth/:provider/callback
router.get('/:provider/callback', (req, res, next) => {
  const { provider } = req.params;
  if (!configured[provider]) return res.redirect(`${FRONTEND_URL}/login?error=not_configured`);

  passport.authenticate(provider, { session: false, failureRedirect: `${FRONTEND_URL}/login?error=1` }, (err, user) => {
    if (err || !user) {
      console.error('OAuth 콜백 실패', err);
      return res.redirect(`${FRONTEND_URL}/login?error=1`);
    }
    issueCookie(res, user.id);
    // localStorage용 last-login-provider는 프론트에서 이 쿼리로 읽어서 저장
    res.redirect(`${FRONTEND_URL}/?login_provider=${provider}`);
  })(req, res, next);
});

module.exports = router;
