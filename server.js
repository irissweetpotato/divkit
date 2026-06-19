const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const db = require("./db");
const auth = require("./auth");
const proxy = require("./proxy");

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.set("trust proxy", true);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ===== Template helpers =====

function loadTemplate(name) {
  return fs.readFileSync(path.join(__dirname, "views", name), "utf8");
}

function html(template, vars) {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v ?? "")),
    template
  );
}

function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== App endpoint (proxy to server backend) =====
app.post("/get_stats", proxy.handleAppRequest);

// ===== Login =====
app.get("/login", (req, res) => {
  if (auth.isValidCookie(req)) return res.redirect("/admin");
  const tpl = loadTemplate("login.html");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html(tpl, { ERROR_BLOCK: "" }));
});

app.post("/login", (req, res) => {
  const login = String(req.body?.login || "");
  const password = String(req.body?.password || "");
  if (!auth.checkLogin(login, password)) {
    const tpl = loadTemplate("login.html");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send(html(tpl, {
      ERROR_BLOCK: '<div class="error">Invalid username or password</div>'
    }));
  }
  auth.setCookie(res);
  res.redirect("/admin");
});

app.get("/logout", (req, res) => {
  auth.clearCookie(res);
  res.redirect("/login");
});

// ===== Admin page =====
app.get("/admin", auth.requireAuth, (req, res) => {
  const domains = db.getAllDomains();
  const tpl = loadTemplate("admin.html");

  let content;
  if (!domains.length) {
    content = '<div class="empty-state">No domains configured yet. Add one above.</div>';
  } else {
    let rows = "";
    for (const d of domains) {
      const hasClear = d.clear_json.length > 0;
      const hasOffer = d.offer_json.length > 0;

      rows += `
        <tr class="domain-row" data-id="${d.id}">
          <td><span class="expand-icon">&#9654;</span></td>
          <td>${esc(d.domain)}</td>
          <td style="font-size:12px;color:#8b949e;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.server_backend_url || '—')}</td>
          <td>
            <span class="result-badge ${hasClear ? 'offer' : 'error'}">${hasClear ? 'Set' : 'Empty'}</span>
          </td>
          <td>
            <span class="result-badge ${hasOffer ? 'offer' : 'error'}">${hasOffer ? 'Set' : 'Empty'}</span>
          </td>
        </tr>
        <tr class="detail-row" id="detail-${d.id}">
          <td colspan="5" class="detail-cell">
            <div class="config-row">
              <label>Server Backend URL</label>
              <div class="inline">
                <input type="text" id="url-${d.id}" value="${esc(d.server_backend_url)}" placeholder="https://server-backend.example.com/get_stats">
                <button type="button" class="btn btn-blue btn-sm save-url-btn" data-id="${d.id}">Save</button>
              </div>
            </div>
            <div class="config-row">
              <label>Server API Key (x-api-key)</label>
              <div class="inline">
                <input type="text" id="key-${d.id}" value="${esc(d.server_api_key)}" placeholder="api_key_value">
                <button type="button" class="btn btn-blue btn-sm save-key-btn" data-id="${d.id}">Save</button>
              </div>
            </div>
            <div class="slots">
              <div class="slot-card">
                <h4>Clear JSON</h4>
                <div class="slot-status ${hasClear ? 'has-json' : ''}">${hasClear ? 'Uploaded (' + d.clear_json.length + ' bytes)' : 'Not uploaded'}</div>
                <div class="slot-actions">
                  <label for="upload-clear-${d.id}">Upload</label>
                  <input type="file" id="upload-clear-${d.id}" class="upload-json" data-id="${d.id}" data-slot="clear" accept=".json">
                  ${hasClear ? `
                    <a href="/admin/domains/${d.id}/json/clear/download" class="btn btn-blue btn-sm" onclick="event.stopPropagation()">Download</a>
                    <button type="button" class="btn btn-red btn-sm delete-json-btn" data-id="${d.id}" data-slot="clear">Delete</button>
                  ` : ''}
                </div>
              </div>
              <div class="slot-card">
                <h4>Offer JSON</h4>
                <div class="slot-status ${hasOffer ? 'has-json' : ''}">${hasOffer ? 'Uploaded (' + d.offer_json.length + ' bytes)' : 'Not uploaded'}</div>
                <div class="slot-actions">
                  <label for="upload-offer-${d.id}">Upload</label>
                  <input type="file" id="upload-offer-${d.id}" class="upload-json" data-id="${d.id}" data-slot="offer" accept=".json">
                  ${hasOffer ? `
                    <a href="/admin/domains/${d.id}/json/offer/download" class="btn btn-blue btn-sm" onclick="event.stopPropagation()">Download</a>
                    <button type="button" class="btn btn-red btn-sm delete-json-btn" data-id="${d.id}" data-slot="offer">Delete</button>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="danger-zone">
              <button type="button" class="btn btn-red btn-sm delete-domain-btn" data-id="${d.id}" data-name="${esc(d.domain)}">Delete domain</button>
            </div>
          </td>
        </tr>`;
    }

    content = `
      <table>
        <thead>
          <tr>
            <th style="width:30px"></th>
            <th>Domain</th>
            <th>Backend URL</th>
            <th>Clear</th>
            <th>Offer</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html(tpl, { CONTENT: content }));
});

// ===== Admin API =====

// Add domain
app.post("/admin/domains", auth.requireAuth, (req, res) => {
  const domain = String(req.body?.domain || "").trim().toLowerCase();
  if (!domain) return res.redirect("/admin");
  try {
    db.addDomain(domain, "", "");
  } catch (err) {
    // duplicate domain
  }
  res.redirect("/admin");
});

// Delete domain
app.delete("/admin/domains/:id", auth.requireAuth, (req, res) => {
  db.deleteDomain(Number(req.params.id));
  res.json({ ok: true });
});

// Update backend URL
app.post("/admin/domains/:id/url", auth.requireAuth, (req, res) => {
  const url = String(req.body?.url || "").trim();
  db.updateBackendUrl(Number(req.params.id), url);
  res.json({ ok: true });
});

// Update API key
app.post("/admin/domains/:id/apikey", auth.requireAuth, (req, res) => {
  const key = String(req.body?.key || "").trim();
  db.updateApiKey(Number(req.params.id), key);
  res.json({ ok: true });
});

// Upload JSON
app.post("/admin/domains/:id/json/:slot", auth.requireAuth, upload.single("file"), (req, res) => {
  const id = Number(req.params.id);
  const slot = req.params.slot;
  if (slot !== "clear" && slot !== "offer") return res.status(400).json({ ok: false, error: "Invalid slot" });
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  const content = req.file.buffer.toString("utf8");
  try {
    JSON.parse(content);
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON file" });
  }

  if (slot === "clear") db.updateClearJson(id, content);
  else db.updateOfferJson(id, content);

  res.json({ ok: true });
});

// Download JSON
app.get("/admin/domains/:id/json/:slot/download", auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const slot = req.params.slot;
  const domain = db.getDomainById(id);
  if (!domain) return res.status(404).json({ ok: false, error: "Domain not found" });

  const content = slot === "clear" ? domain.clear_json : domain.offer_json;
  if (!content) return res.status(404).json({ ok: false, error: "No JSON in this slot" });

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${domain.domain}-${slot}.json"`);
  res.send(content);
});

// Delete JSON
app.delete("/admin/domains/:id/json/:slot", auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const slot = req.params.slot;
  if (slot === "clear") db.deleteClearJson(id);
  else if (slot === "offer") db.deleteOfferJson(id);
  else return res.status(400).json({ ok: false, error: "Invalid slot" });
  res.json({ ok: true });
});

// ===== Logs page =====
app.get("/logs", auth.requireAuth, (req, res) => {
  const q = req.query || {};
  const domain = String(q.domain || "").trim();
  const from = String(q.from || "").trim();
  const to = String(q.to || "").trim();
  const hasError = String(q.hasError || "").trim();
  const order = String(q.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  const sessions = db.getSessions({ domain, from, to, hasError, order });
  const logDomains = db.getSessionDomains();

  const tpl = loadTemplate("logs.html");

  // Domain options
  const domainOptions = logDomains.map(d =>
    `<option value="${esc(d)}"${d === domain ? ' selected' : ''}>${esc(d)}</option>`
  ).join("");

  let content;
  if (!sessions.length) {
    content = '<div class="empty-state">No log sessions found for current filters.</div>';
  } else {
    let rows = "";
    for (const s of sessions) {
      const steps = db.getSessionSteps(s.id);
      const errorClass = s.has_error ? " has-error" : "";

      const resultClass = s.result_type === "offer" ? "offer" : s.result_type === "clear" ? "clear" : "error";

      rows += `
        <tr class="session-row${errorClass}" data-id="${s.id}">
          <td><span class="expand-icon">&#9654;</span></td>
          <td>${esc(s.domain)}</td>
          <td>
            <span class="result-badge ${resultClass}">${esc(s.result_type || 'error')}</span>
          </td>
          <td>
            <span class="time-small">${esc(s.started_at)} — ${esc(s.ended_at)}</span>
          </td>
        </tr>
        <tr class="steps-row" id="steps-${s.id}">
          <td colspan="4" class="steps-cell">
            <ul class="step-list">`;

      for (const step of steps) {
        const stepErr = step.has_error ? " has-error" : "";
        const detailsB64 = Buffer.from(step.details_json || "{}", "utf8").toString("base64");
        rows += `
              <li class="step-item${stepErr}">
                <span class="step-name">${esc(step.step_name)}</span>
                <span class="step-time">${esc(step.started_at)} — ${esc(step.ended_at)}</span>
                ${step.has_error ? `
                  <span class="step-error-icon" title="">&#9888;
                    <span class="tooltip">${esc(step.error_message)}</span>
                  </span>
                ` : ''}
                <button class="step-details-btn" data-step="${esc(step.step_name)}" data-details="${detailsB64}">Details</button>
              </li>`;
      }

      rows += `
            </ul>
          </td>
        </tr>`;
    }

    content = `
      <table>
        <thead>
          <tr>
            <th style="width:30px"></th>
            <th>Domain</th>
            <th>Result</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html(tpl, {
    DOMAIN_OPTIONS: domainOptions,
    FILTER_FROM: esc(from),
    FILTER_TO: esc(to),
    FILTER_ERROR_ALL: hasError !== "1" ? " selected" : "",
    FILTER_ERROR_YES: hasError === "1" ? " selected" : "",
    ORDER_DESC: order === "desc" ? " selected" : "",
    ORDER_ASC: order === "asc" ? " selected" : "",
    CONTENT: content
  }));
});

// ===== Root redirect =====
app.get("/", (req, res) => res.redirect("/admin"));

// ===== Start =====
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`DivKit backend started on port ${PORT}`);
});
