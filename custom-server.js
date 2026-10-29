const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

// SQLite via built-in node:sqlite (no native module compile mismatches)
const { DatabaseSync } = require("node:sqlite");

// DB path helper (shared by all quota handlers)
function _dbPath() {
  return path.join(process.env.APPDATA || process.env.HOME, "kyorouter", "db", "data.sqlite");
}

const origCreate = http.createServer.bind(http);

// Per-process secret proving x-9r-real-ip was stamped below rather than sent by the client.
// A bare `next start` / `next dev` never loads this file, so it cannot produce a matching
// header even though the env var is inherited by child processes. Named like x-9r-cli-token
// so the request-detail header sanitizer redacts it too.
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

let backgroundRefreshStarted = false;

function startBackgroundTokenRefreshFromCustomServer() {
  if (backgroundRefreshStarted) return;
  backgroundRefreshStarted = true;
  // Prefer source path (repo / standalone that still has src). Fail-open if missing
  // — initializeApp also starts the same scheduler when the Next app boots.
  const modPath = path.join(__dirname, "src", "sse", "services", "backgroundTokenRefresh.js");
  import(pathToFileURL(modPath).href)
    .then((m) => {
      try {
        m.startBackgroundTokenRefresh();
      } catch (e) {
        console.error("[BackgroundTokenRefresh] start failed:", e && e.message ? e.message : e);
      }
      const stop = () => {
        try {
          m.stopBackgroundTokenRefresh();
        } catch {
          /* ignore */
        }
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((e) => {
      // Expected in published CLI standalone (src/ not on disk). App bootstrap covers it.
      if (process.env.DEBUG_BACKGROUND_TOKEN_REFRESH) {
        console.error("[BackgroundTokenRefresh] import failed:", e && e.message ? e.message : e);
      }
    });
}

// ─── Custom Tokens API Handlers ──────────────────────────────────────────────
const _quotaCache = new Map(); // cache: `${nodeId}:${keyId}` → {used, limit, remaining, percentage, timestamp}

function _cachedQuota(nodeId, keyId) {
  const key = `${nodeId}:${keyId}`;
  const cached = _quotaCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.timestamp < 60000) return cached.data;
  _quotaCache.delete(key);
  return undefined;
}

function _setQuotaCache(nodeId, keyId, data) {
  const key = `${nodeId}:${keyId}`;
  _quotaCache.set(key, { data, timestamp: Date.now() });
}

async function _probeQuota(baseUrl, apiKey) {
  // Dahl.global special case - different endpoint and auth
  if (baseUrl.includes('dahl.global')) {
    try {
      console.log('[Dahl] Probing with baseUrl:', baseUrl);
      const res = await fetch('https://inference.dahl.global/tokens/current', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      console.log('[Dahl] Response status:', res.status);
      if (!res.ok) {
        const errorText = await res.text();
        console.log('[Dahl] Error response:', errorText);
        return null;
      }
      
      const responseText = await res.text();
      console.log('[Dahl] Response text:', responseText);
      
      const json = JSON.parse(responseText);
      console.log('[Dahl] Parsed JSON:', json);
      
      // Dahl response: {available_tokens: 100000000}
      const remaining = json.available_tokens || json.remaining || null;
      
      // Dahl doesn't expose used or limit, only remaining
      if (remaining !== null) {
        return { 
          used: null, 
          limit: null, 
          remaining, 
          percentage: null 
        };
      }
    } catch (err) {
      console.log('[Dahl] Exception:', err.message);
    }
    return null;
  }
  
  // Standard OpenAI-compatible providers
  // Strip /v1 or /v1/ suffix from baseUrl for quota endpoints
  const baseUrlClean = baseUrl.replace(/\/v1\/?$/, "");
  const endpoints = ["/api/me", "/v1/me", "/dashboard/billing", "/api/user/usage", "/usage", "/v1/usage", "/quota", "/v1/quota", "/api/v1/me"];
  for (const ep of endpoints) {
    try {
      const url = baseUrlClean + ep;
      const res = await fetch(url, { 
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) continue;
      const json = await res.json();
      
      // Heuristic parsing
      const limit = json.limit || json.total_granted || json.soft_limit_usd || json.hard_limit_usd || json.bonus_tokens || null;
      
      // Handle nested used object (e.g. {chat: {monthly_token_used: 123}})
      let used = null;
      if (typeof json.used === 'number') {
        used = json.used;
      } else if (json.used?.chat?.monthly_token_used !== undefined) {
        used = json.used.chat.monthly_token_used;
      } else if (json.total_used !== undefined) {
        used = json.total_used;
      } else if (json.usage !== undefined) {
        used = typeof json.usage === 'number' ? json.usage : json.usage?.chat?.monthly_token_used || null;
      }
      
      const remaining = json.remaining || json.remaining_tokens || null;
      
      // Calculate/validate limit
      let finalLimit = limit;
      
      // If limit seems wrong (used > limit or used + remaining > limit), recalculate
      if (used !== null && remaining !== null) {
        const calculatedLimit = used + remaining;
        if (!finalLimit || used > finalLimit || calculatedLimit > finalLimit) {
          finalLimit = calculatedLimit;
        }
      }
      
      const percentage = finalLimit && used !== null ? Math.round((used / finalLimit) * 100) : null;
      
      if (finalLimit !== null || used !== null) {
        return { used, limit: finalLimit, remaining, percentage };
      }
    } catch {}
  }
  return null; // No quota API found
}

async function handleCustomUsageTotals(req, res) {
  const ip = req.headers["x-9r-real-ip"] || "";
  if (!ip.startsWith("127.") && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    res.writeHead(403); 
    return res.end(JSON.stringify({ error: "loopback only" }));
  }
  
  try {
    const db = new DatabaseSync(_dbPath(), { readOnly: true });
    
    // Query only provider nodes and connections, no usage history
    const query = `
      SELECT 
        pn.id as nodeId,
        pn.name as name,
        json_extract(pn.data, '$.prefix') as prefix,
        json_extract(pn.data, '$.baseUrl') as baseUrl,
        pc.id as connectionId,
        json_extract(pc.data, '$.name') as keyName,
        json_extract(pc.data, '$.apiKey') as apiKey,
        pc.isActive
      FROM providerNodes pn
      JOIN providerConnections pc ON pc.provider = pn.id
      WHERE pn.type = 'openai-compatible'
      ORDER BY pn.name, pc.id
    `;
    
    const rows = db.prepare(query).all();
    db.close();
    
    // Group by provider
    const providers = {};
    rows.forEach(r => {
      if (!providers[r.nodeId]) {
        providers[r.nodeId] = {
          nodeId: r.nodeId,
          name: r.name,
          prefix: r.prefix,
          baseUrl: r.baseUrl,
          keys: []
        };
      }
      const p = providers[r.nodeId];
      p.keys.push({
        connectionId: r.connectionId,
        keyName: r.keyName || `Key ${p.keys.length + 1}`,
        isActive: r.isActive,
        testStatus: r.isActive ? "active" : "inactive",
        apiKey: r.apiKey // Will be used for client-side quota probe
      });
    });
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      result: Object.values(providers),
      generatedAt: new Date().toISOString()
    }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleProbeQuota(req, res) {
  const ip = req.headers["x-9r-real-ip"] || "";
  if (!ip.startsWith("127.") && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: "loopback only" }));
  }
  
  const { search } = new URL(req.url, "http://localhost");
  const params = new URLSearchParams(search);
  const nodeId = params.get("nodeId");
  const keyId = params.get("keyId");
  const baseUrl = params.get("baseUrl");
  
  if (!nodeId || !keyId || !baseUrl) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: "missing params" }));
  }
  
  // Check cache
  const cached = _cachedQuota(nodeId, keyId);
  if (cached !== undefined) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    return res.end(JSON.stringify(cached));
  }
  
  console.log('[ProbeQuota] nodeId:', nodeId, 'keyId:', keyId, 'baseUrl:', baseUrl);
  
  // Read API key from DB
  try {
    const db = new DatabaseSync(_dbPath(), { readOnly: true });
    const row = db.prepare("SELECT json_extract(data, '$.apiKey') as apiKey FROM providerConnections WHERE id = ?").get(keyId);
    db.close();
    
    if (!row || !row.apiKey) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: "key not found" }));
    }
    
    console.log('[ProbeQuota] API key found, length:', row.apiKey.length);
      const data = await _probeQuota(baseUrl, row.apiKey);
      console.log('[ProbeQuota] _probeQuota returned:', data);
    
      // Special handling for Dahl: infer limit from first probe
      if (data && baseUrl.includes('dahl.global') && data.remaining !== null && data.limit === null) {
        // Load cached limit from SQLite
        _ensureQuotaCacheTable();
        const cacheDb = new DatabaseSync(_dbPath(), { readOnly: true });
        const cached = cacheDb.prepare("SELECT \"limit\" FROM quota_snapshots WHERE nodeId = ? AND connectionId = ?").get(nodeId, keyId);
        cacheDb.close();
      
        if (!cached || !cached.limit || data.remaining > cached.limit) {
          // First probe or top-up detected: assume remaining = full limit
          data.limit = data.remaining;
          data.used = 0;
          data.percentage = 0;
        } else {
          // Use cached limit, calculate used
          data.limit = cached.limit;
          data.used = data.limit - data.remaining;
          data.percentage = data.limit > 0 ? Math.round((data.used / data.limit) * 100) : 0;
        }
      }
    
      _setQuotaCache(nodeId, keyId, data);
    
      res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "MISS" });
      // null = definitively no quota endpoint found (all standard endpoints tried)
      // → tell frontend to mark provider unsupported instead of re-probing every time
      res.end(JSON.stringify(data || { unsupported: true }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ─── Quota Cache SQLite Handlers ─────────────────────────────────────────────
function _ensureQuotaCacheTable() {
  const db = new DatabaseSync(_dbPath());
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nodeId TEXT NOT NULL,
      connectionId TEXT NOT NULL,
      used INTEGER,
      "limit" INTEGER,
      remaining INTEGER,
      percentage INTEGER,
      timestamp INTEGER NOT NULL,
      UNIQUE(nodeId, connectionId)
    );
    CREATE INDEX IF NOT EXISTS idx_quota_timestamp ON quota_snapshots(timestamp);
  `);
  
  db.close();
}

async function handleQuotaCacheGet(req, res) {
  const ip = req.headers["x-9r-real-ip"] || "";
  if (!ip.startsWith("127.") && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: "loopback only" }));
  }
  
  try {
    _ensureQuotaCacheTable();
    const db = new DatabaseSync(_dbPath(), { readOnly: true });
    
    // Get all quota snapshots, delete older than 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const rows = db.prepare(`
      SELECT nodeId, connectionId, used, "limit", remaining, percentage, timestamp 
      FROM quota_snapshots 
      WHERE timestamp > ?
    `).all(sevenDaysAgo);
    
    db.close();
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ snapshots: rows }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handleQuotaCachePost(req, res) {
  const ip = req.headers["x-9r-real-ip"] || "";
  if (!ip.startsWith("127.") && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: "loopback only" }));
  }
  
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    try {
      const { nodeId, connectionId, used, limit, remaining, percentage } = JSON.parse(body);
      
      if (!nodeId || !connectionId) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: "missing nodeId or connectionId" }));
      }
      
      _ensureQuotaCacheTable();
      const db = new DatabaseSync(_dbPath());
      
      // Upsert quota snapshot
      db.prepare(`
        INSERT INTO quota_snapshots (nodeId, connectionId, used, "limit", remaining, percentage, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(nodeId, connectionId) DO UPDATE SET
          used = excluded.used,
          "limit" = excluded."limit",
          remaining = excluded.remaining,
          percentage = excluded.percentage,
          timestamp = excluded.timestamp
      `).run(nodeId, connectionId, used, limit, remaining, percentage, Date.now());
      
      // Cleanup old data (>7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      db.prepare("DELETE FROM quota_snapshots WHERE timestamp < ?").run(sevenDaysAgo);
      
      db.close();
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    
    // Custom tokens API endpoints
    const pathname = (() => { try { return new URL(req.url, "http://localhost").pathname; } catch { return req.url; } })();
    
    if (pathname === "/api/custom-usage/totals") {
      return handleCustomUsageTotals(req, res);
    }
    
    if (pathname === "/api/custom-usage/probe-quota") {
      return handleProbeQuota(req, res);
    }

    if (pathname === "/api/quota-cache" && req.method === "GET") {
      return handleQuotaCacheGet(req, res);
    }

    if (pathname === "/api/quota-cache" && req.method === "POST") {
      return handleQuotaCachePost(req, res);
    }
    
    if (pathname === "/api/custom-usage/page-content") {
      const htmlPath = path.join(__dirname, "public", "custom-tokens.html");
      return fs.readFile(htmlPath, "utf8", (err, data) => {
        if (err) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
      });
    }
    
    return handler(req, res);
  };
  const server = origCreate(...rest, wrapped);
  server.once("listening", () => {
    startBackgroundTokenRefreshFromCustomServer();
  });
  const origEmit = server.emit;
  // JBR 25 sends h2c upgrades that the HTTP/1.1 server would otherwise close.
  server.emit = function (event, ...eventArgs) {
    const [req, socket, head] = eventArgs;
    if (event !== "upgrade" || String(req.headers.upgrade || "").toLowerCase() !== "h2c") {
      return origEmit.call(this, event, ...eventArgs);
    }

    const contentLength = Number(req.headers["content-length"] || 0);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      socket.destroy();
      return true;
    }
    const chunks = [head];
    let received = head.length;
    const serve = () => {
      // Replay the upgraded request through the existing HTTP/1.1 handler.
      const replay = new http.IncomingMessage(socket);
      Object.assign(replay, { method: req.method, url: req.url, headers: req.headers, complete: true });
      if (received) replay.push(Buffer.concat(chunks, received).subarray(0, contentLength));
      replay.push(null);
      const res = new http.ServerResponse(replay);
      res.shouldKeepAlive = false;
      res.assignSocket(socket);
      res.once("finish", () => socket.end());
      Promise.resolve().then(() => wrapped(replay, res)).catch((error) => {
        console.error("Failed to downgrade h2c request", error);
        socket.destroy();
      });
    };
    if (received >= contentLength) serve();
    else {
      socket.on("data", function readBody(chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received < contentLength) return;
        socket.off("data", readBody);
        serve();
      });
      socket.resume();
    }
    delete req.headers.upgrade;
    delete req.headers["http2-settings"];
    req.headers.connection = "close";
    return true;
  };
  return server;
};

if (require.main === module) {
  const standalone = path.join(__dirname, "server.js");
  if (fs.existsSync(standalone)) {
    require(standalone);
  } else {
    // Repo checkout has no standalone build next to us. `next start` builds its HTTP
    // server in-process, so the wrapper above still sanitizes every request.
    const nextBin = require.resolve("next/dist/bin/next");
    process.argv = [process.argv[0], nextBin, "start", ...process.argv.slice(2)];
    require(nextBin);
  }
}
