const axios = require("axios");
const db = require("./db");

function nowIso() {
  return new Date().toISOString();
}

function getRealIp(req) {
  const xff = req.headers["x-forwarded-for"];
  let ip =
    (typeof xff === "string" && xff.split(",")[0].trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "";
  if (ip.startsWith("::ffff:")) ip = ip.substring(7);
  return ip;
}

function getRequestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();
}

// --- URL insertion into offer JSON ---
// DivKit uses variables. The offer JSON should contain a variable
// whose value we replace with the actual URL from the server backend.
// The placeholder key is configurable; default: "offer_url"
const OFFER_URL_VARIABLE = "offer_url";

function insertUrlIntoOfferJson(offerJsonStr, url) {
  if (!offerJsonStr || !url) return offerJsonStr;
  try {
    const obj = JSON.parse(offerJsonStr);
    // Strategy: look for a DivKit variable named OFFER_URL_VARIABLE
    // and replace its value with the actual URL.
    // DivKit variables are typically in a top-level "variables" array:
    //   "variables": [{ "name": "offer_url", "type": "string", "value": "PLACEHOLDER" }]
    if (Array.isArray(obj.variables)) {
      for (const v of obj.variables) {
        if (v && v.name === OFFER_URL_VARIABLE) {
          v.value = url;
        }
      }
    }
    // Fallback: also do a simple string replacement for any remaining placeholder
    return JSON.stringify(obj).replaceAll(`{{${OFFER_URL_VARIABLE}}}`, url);
  } catch {
    // If JSON is broken, do simple string replace
    return offerJsonStr.replaceAll(`{{${OFFER_URL_VARIABLE}}}`, url);
  }
}

async function handleAppRequest(req, res) {
  const sessionStartedAt = nowIso();
  const host = getRequestHost(req);
  const userIp = getRealIp(req);

  const sessionId = db.createSession(host, sessionStartedAt);

  // --- Step 1: Receive ---
  const step1Start = nowIso();
  const domainConfig = db.getDomainByHost(host);

  const receiveDetails = {
    host,
    userIp,
    method: req.method,
    headers: {
      "user-agent": req.headers["user-agent"] || "",
      "accept-language": req.headers["accept-language"] || "",
      "x-api-key": req.headers["x-api-key"] || ""
    },
    body: req.body || {}
  };

  if (!domainConfig) {
    const step1End = nowIso();
    db.addStep(sessionId, 1, "receive", step1Start, step1End, true, `Unknown domain: ${host}`, receiveDetails);
    db.finalizeSession(sessionId, step1End, true, "error");
    return res.status(404).json({ ok: false, error: "unknown_domain" });
  }

  if (!domainConfig.server_backend_url) {
    const step1End = nowIso();
    db.addStep(sessionId, 1, "receive", step1Start, step1End, true, "No server backend URL configured", receiveDetails);
    db.finalizeSession(sessionId, step1End, true, "error");
    return res.status(502).json({ ok: false, error: "backend_not_configured" });
  }

  const step1End = nowIso();
  db.addStep(sessionId, 1, "receive", step1Start, step1End, false, "", receiveDetails);

  // --- Step 2: Forward ---
  const step2Start = nowIso();
  const forwardBody = { ...req.body, ip: userIp };
  const forwardHeaders = { "Content-Type": "application/json" };
  if (domainConfig.server_api_key) {
    forwardHeaders["x-api-key"] = domainConfig.server_api_key;
  }

  const forwardDetails = {
    url: domainConfig.server_backend_url,
    headers: forwardHeaders,
    body: forwardBody
  };

  let serverResponse;
  try {
    serverResponse = await axios.post(domainConfig.server_backend_url, forwardBody, {
      headers: forwardHeaders,
      timeout: 15000,
      validateStatus: () => true
    });
  } catch (err) {
    const step2End = nowIso();
    const errMsg = `Request to server backend failed: ${err?.message || err}`;
    db.addStep(sessionId, 2, "forward", step2Start, step2End, true, errMsg, forwardDetails);
    db.finalizeSession(sessionId, step2End, true, "error");
    return res.status(502).json({ ok: false, error: "backend_request_failed" });
  }

  const step2End = nowIso();
  db.addStep(sessionId, 2, "forward", step2Start, step2End, false, "", forwardDetails);

  // --- Step 3: Response ---
  const step3Start = nowIso();
  const serverData = serverResponse.data || {};
  const responseDetails = {
    status: serverResponse.status,
    data: serverData
  };

  if (serverResponse.status < 200 || serverResponse.status >= 300) {
    const step3End = nowIso();
    const errMsg = `Server backend returned HTTP ${serverResponse.status}`;
    db.addStep(sessionId, 3, "response", step3Start, step3End, true, errMsg, responseDetails);
    db.finalizeSession(sessionId, step3End, true, "error");
    return res.status(502).json({ ok: false, error: "backend_error" });
  }

  const hasLink = serverData.ok === true && serverData.isBot === true && serverData.error;
  const step3End = nowIso();
  db.addStep(sessionId, 3, "response", step3Start, step3End, false, "", responseDetails);

  // --- Step 4: Deliver ---
  const step4Start = nowIso();
  let resultJson;
  let resultType;

  if (hasLink) {
    resultType = "offer";
    const offerUrl = String(serverData.error || "");
    if (!domainConfig.offer_json) {
      const step4End = nowIso();
      db.addStep(sessionId, 4, "deliver", step4Start, step4End, true, "No offer JSON configured for this domain", { resultType, offerUrl });
      db.finalizeSession(sessionId, step4End, true, "error");
      return res.status(502).json({ ok: false, error: "offer_json_not_configured" });
    }
    resultJson = insertUrlIntoOfferJson(domainConfig.offer_json, offerUrl);
  } else {
    resultType = "clear";
    if (!domainConfig.clear_json) {
      const step4End = nowIso();
      db.addStep(sessionId, 4, "deliver", step4Start, step4End, true, "No clear JSON configured for this domain", { resultType });
      db.finalizeSession(sessionId, step4End, true, "error");
      return res.status(502).json({ ok: false, error: "clear_json_not_configured" });
    }
    resultJson = domainConfig.clear_json;
  }

  const step4End = nowIso();
  db.addStep(sessionId, 4, "deliver", step4Start, step4End, false, "", { resultType });
  db.finalizeSession(sessionId, step4End, false, resultType);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.send(resultJson);
}

module.exports = { handleAppRequest };
