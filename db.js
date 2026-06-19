const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "divkit.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    domain        TEXT    NOT NULL UNIQUE,
    server_backend_url TEXT NOT NULL DEFAULT '',
    server_api_key     TEXT NOT NULL DEFAULT '',
    clear_json    TEXT    NOT NULL DEFAULT '',
    offer_json    TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    domain        TEXT    NOT NULL DEFAULT '',
    started_at    TEXT    NOT NULL DEFAULT '',
    ended_at      TEXT    NOT NULL DEFAULT '',
    has_error     INTEGER NOT NULL DEFAULT 0,
    result_type   TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS session_steps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    step_number   INTEGER NOT NULL,
    step_name     TEXT    NOT NULL DEFAULT '',
    started_at    TEXT    NOT NULL DEFAULT '',
    ended_at      TEXT    NOT NULL DEFAULT '',
    has_error     INTEGER NOT NULL DEFAULT 0,
    error_message TEXT    NOT NULL DEFAULT '',
    details_json  TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_domain    ON sessions(domain);
  CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_steps_session_id   ON session_steps(session_id);
`);

// ===== Domains =====

const stmtAllDomains = db.prepare("SELECT * FROM domains ORDER BY domain ASC");
const stmtGetDomain = db.prepare("SELECT * FROM domains WHERE domain = ?");
const stmtGetDomainById = db.prepare("SELECT * FROM domains WHERE id = ?");
const stmtInsertDomain = db.prepare(
  "INSERT INTO domains (domain, server_backend_url, server_api_key) VALUES (?, ?, ?)"
);
const stmtUpdateBackendUrl = db.prepare(
  "UPDATE domains SET server_backend_url = ?, updated_at = datetime('now') WHERE id = ?"
);
const stmtUpdateApiKey = db.prepare(
  "UPDATE domains SET server_api_key = ?, updated_at = datetime('now') WHERE id = ?"
);
const stmtUpdateClearJson = db.prepare(
  "UPDATE domains SET clear_json = ?, updated_at = datetime('now') WHERE id = ?"
);
const stmtUpdateOfferJson = db.prepare(
  "UPDATE domains SET offer_json = ?, updated_at = datetime('now') WHERE id = ?"
);
const stmtDeleteClearJson = db.prepare(
  "UPDATE domains SET clear_json = '', updated_at = datetime('now') WHERE id = ?"
);
const stmtDeleteOfferJson = db.prepare(
  "UPDATE domains SET offer_json = '', updated_at = datetime('now') WHERE id = ?"
);
const stmtDeleteDomain = db.prepare("DELETE FROM domains WHERE id = ?");

function getAllDomains() {
  return stmtAllDomains.all();
}

function getDomainByHost(host) {
  return stmtGetDomain.get(host) || null;
}

function getDomainById(id) {
  return stmtGetDomainById.get(id) || null;
}

function addDomain(domain, serverBackendUrl, serverApiKey) {
  return stmtInsertDomain.run(domain, serverBackendUrl || "", serverApiKey || "");
}

function updateBackendUrl(id, url) {
  return stmtUpdateBackendUrl.run(url, id);
}

function updateApiKey(id, key) {
  return stmtUpdateApiKey.run(key, id);
}

function updateClearJson(id, json) {
  return stmtUpdateClearJson.run(json, id);
}

function updateOfferJson(id, json) {
  return stmtUpdateOfferJson.run(json, id);
}

function deleteClearJson(id) {
  return stmtDeleteClearJson.run(id);
}

function deleteOfferJson(id) {
  return stmtDeleteOfferJson.run(id);
}

function deleteDomain(id) {
  return stmtDeleteDomain.run(id);
}

// ===== Sessions & Steps =====

const stmtInsertSession = db.prepare(
  "INSERT INTO sessions (domain, started_at, ended_at, has_error, result_type) VALUES (?, ?, '', 0, '')"
);
const stmtUpdateSession = db.prepare(
  "UPDATE sessions SET ended_at = ?, has_error = ?, result_type = ? WHERE id = ?"
);
const stmtInsertStep = db.prepare(
  "INSERT INTO session_steps (session_id, step_number, step_name, started_at, ended_at, has_error, error_message, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

function createSession(domain, startedAt) {
  const info = stmtInsertSession.run(domain, startedAt);
  return info.lastInsertRowid;
}

function finalizeSession(id, endedAt, hasError, resultType) {
  stmtUpdateSession.run(endedAt, hasError ? 1 : 0, resultType, id);
}

function addStep(sessionId, stepNumber, stepName, startedAt, endedAt, hasError, errorMessage, detailsJson) {
  stmtInsertStep.run(
    sessionId,
    stepNumber,
    stepName,
    startedAt,
    endedAt,
    hasError ? 1 : 0,
    errorMessage || "",
    typeof detailsJson === "string" ? detailsJson : JSON.stringify(detailsJson || {})
  );
}

function getSessions(options = {}) {
  let where = [];
  let params = [];

  if (options.domain) {
    where.push("s.domain = ?");
    params.push(options.domain);
  }
  if (options.from) {
    where.push("s.started_at >= ?");
    params.push(options.from);
  }
  if (options.to) {
    where.push("s.started_at <= ?");
    params.push(options.to);
  }
  if (options.hasError === "1") {
    where.push("s.has_error = 1");
  }

  const order = options.order === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 5000);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const sql = `
    SELECT s.* FROM sessions s
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY s.started_at ${order}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

function getSessionSteps(sessionId) {
  return db.prepare(
    "SELECT * FROM session_steps WHERE session_id = ? ORDER BY step_number ASC"
  ).all(sessionId);
}

function getSessionDomains() {
  return db.prepare(
    "SELECT DISTINCT domain FROM sessions WHERE domain != '' ORDER BY domain ASC"
  ).all().map(r => r.domain);
}

module.exports = {
  db,
  getAllDomains,
  getDomainByHost,
  getDomainById,
  addDomain,
  updateBackendUrl,
  updateApiKey,
  updateClearJson,
  updateOfferJson,
  deleteClearJson,
  deleteOfferJson,
  deleteDomain,
  createSession,
  finalizeSession,
  addStep,
  getSessions,
  getSessionSteps,
  getSessionDomains
};
