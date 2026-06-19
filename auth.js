const crypto = require("crypto");

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change_me";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "divkit_change_this_secret";
const COOKIE_NAME = "divkit_admin_auth";
const COOKIE_MAX_AGE = 60 * 60 * 12; // 12 hours

function parseCookies(req) {
  const source = String(req.headers.cookie || "");
  const result = {};
  for (const part of source.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(val); } catch { result[key] = val; }
  }
  return result;
}

function signPayload(payload) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(payload).digest("hex");
}

function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function createCookieValue() {
  const expiresAt = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = `${ADMIN_LOGIN}:${expiresAt}`;
  const sig = signPayload(payload);
  return Buffer.from(`${payload}:${sig}`, "utf8").toString("base64url");
}

function isValidCookie(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return false;
    const [login, expiresRaw, sig] = parts;
    const expires = Number(expiresRaw);
    if (!Number.isFinite(expires) || Date.now() > expires) return false;
    if (login !== ADMIN_LOGIN) return false;
    return timingSafeEq(sig, signPayload(`${login}:${expiresRaw}`));
  } catch {
    return false;
  }
}

function setCookie(res) {
  const val = createCookieValue();
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
  );
}

function clearCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function checkLogin(login, password) {
  return timingSafeEq(login, ADMIN_LOGIN) && timingSafeEq(password, ADMIN_PASSWORD);
}

function requireAuth(req, res, next) {
  if (isValidCookie(req)) return next();
  return res.redirect("/login");
}

module.exports = { requireAuth, isValidCookie, setCookie, clearCookie, checkLogin };
