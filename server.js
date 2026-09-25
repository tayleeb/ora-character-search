const http = require("node:http");

const PORT = Number(process.env.PORT || 3000);
const MAX_RESULTS = 20;
const CACHE_MS = 60_000;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 45;
const cache = new Map();
const rateLimits = new Map();

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=30",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(body));
}

function validQuery(value) {
  return typeof value === "string" && /^[A-Za-z0-9_ ]{1,30}$/.test(value.trim());
}

function isRateLimited(request) {
  const key = request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt >= RATE_WINDOW_MS) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

async function searchRobloxUsers(query) {
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return cached.results;

  async function getPage(cursor) {
    const endpoint = new URL("https://users.roblox.com/v1/users/search");
    endpoint.searchParams.set("keyword", query);
    // Roblox caps this endpoint at ten results per page.
    endpoint.searchParams.set("limit", "10");
    if (cursor) endpoint.searchParams.set("cursor", cursor);

    const upstream = await fetch(endpoint, {
      headers: { "User-Agent": "ORA-Character-Search/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) throw new Error(`Roblox returned ${upstream.status}`);
    return upstream.json();
  }

  const firstPage = await getPage();
  const secondPage = firstPage.nextPageCursor ? await getPage(firstPage.nextPageCursor) : { data: [] };
  const results = [...(firstPage.data || []), ...(secondPage.data || [])]
    .slice(0, MAX_RESULTS).map((user) => ({
      UserId: user.id,
      Username: user.name,
      DisplayName: user.displayName || user.name,
    }));

  cache.set(key, { createdAt: Date.now(), results });
  return results;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method !== "GET" || url.pathname !== "/search-users") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (isRateLimited(request)) {
    sendJson(response, 429, { error: "Try again in a moment" });
    return;
  }

  const query = url.searchParams.get("query") || "";
  if (!validQuery(query)) {
    sendJson(response, 400, { error: "Use 1-30 letters, numbers, spaces, or underscores" });
    return;
  }

  try {
    sendJson(response, 200, { data: await searchRobloxUsers(query.trim()) });
  } catch (error) {
    console.error("Roblox search failed:", error.message);
    sendJson(response, 502, { error: "Roblox search is temporarily unavailable" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`ORA character search listening on ${PORT}`));
