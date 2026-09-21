/**
 * REVIEWER: skip this file (and vercel.json).
 *
 * Not part of the frontend assessment. It exists only so the Vercel static
 * Vite deploy can serve `/api/*`. Local `npm run dev` still uses `server/`
 * via the Vite proxy — this file is unused there. `server/` is not modified.
 *
 * Behaviour is a port of `server/index.mjs` over the same seed
 * (`server/data.mjs`). SSE `/api/events` is omitted (poor fit for serverless).
 *
 * Vite on Vercel only matches one path segment for `api/[...path].mjs`, so
 * `vercel.json` rewrites nested `/api/...` here as `?p=/api/...`.
 */
import { randomUUID } from "node:crypto";
import {
  assets,
  COLLECTIONS,
  ALL_TAGS,
  ALL_OWNERS,
  ASSET_STATUSES,
  ASSET_KINDS,
  thumbColors,
} from "../server/data.mjs";

const CHAOS = process.env.CHAOS !== "0";
const LATENCY = process.env.LATENCY !== "0";

// Same hostile defaults as server/index.mjs: latency, flaky reads/writes, rate limit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chance = (p) => CHAOS && Math.random() < p;

function latencyFor(pathname, query) {
  if (!LATENCY) return 0;
  let ms = 90 + Math.random() * 260;
  if (pathname === "/api/assets") {
    const q = (query.get("q") ?? "").trim();
    if (q.length === 0) ms += 180;
    else if (q.length <= 2) ms += 700;
    else if (q.length <= 4) ms += 320;
    if (query.get("cursor")) ms *= 0.7;
  }
  if (pathname === "/api/stats") ms += 1100;
  if (pathname.startsWith("/api/thumb/")) ms = 40 + Math.random() * 220;
  return Math.round(ms);
}

// 80 requests / 10s, thumbnails exempt. Process-local — resets on cold start.
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 80;
const hits = new Map();

function rateLimited(ip) {
  if (!CHAOS) return false;
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_IN_WINDOW;
}

// Cursors are bound to the filter fingerprint; reuse after a query change → 400 stale_cursor.
function fingerprint(query) {
  const parts = [
    "q",
    "status",
    "kind",
    "tag",
    "collectionId",
    "owner",
    "sort",
  ].map((k) => `${k}=${(query.get(k) ?? "").trim().toLowerCase()}`);
  return Buffer.from(parts.join("&")).toString("base64url");
}
const encodeCursor = (offset, fp) =>
  Buffer.from(JSON.stringify({ o: offset, f: fp })).toString("base64url");
function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (typeof parsed.o !== "number" || typeof parsed.f !== "string")
      return null;
    return parsed;
  } catch {
    return null;
  }
}

const csv = (v) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

function queryAssets(query) {
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const statuses = csv(query.get("status"));
  const kinds = csv(query.get("kind"));
  const tags = csv(query.get("tag"));
  const collectionId = query.get("collectionId") ?? "";
  const owner = query.get("owner") ?? "";

  let rows = [...assets.values()];
  if (q) {
    rows = rows.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)),
    );
  }
  if (statuses.length) rows = rows.filter((a) => statuses.includes(a.status));
  if (kinds.length) rows = rows.filter((a) => kinds.includes(a.kind));
  if (tags.length)
    rows = rows.filter((a) => tags.every((t) => a.tags.includes(t)));
  if (collectionId) rows = rows.filter((a) => a.collectionId === collectionId);
  if (owner) rows = rows.filter((a) => a.owner.id === owner);

  const sort = query.get("sort") ?? "updatedAt:desc";
  const [field, dir] = sort.split(":");
  const sign = dir === "asc" ? 1 : -1;
  const allowed = { updatedAt: 1, createdAt: 1, name: 1, sizeBytes: 1 };
  if (!allowed[field]) return { error: `Unsupported sort: ${sort}` };

  rows.sort((a, b) => {
    const x = a[field];
    const y = b[field];
    if (x === y) return a.id < b.id ? -1 : 1;
    return (x > y ? 1 : -1) * sign;
  });

  return { rows };
}

function send(res, status, body, headers = {}) {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-request-id",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-expose-headers": "x-request-id,retry-after",
    "x-request-id": randomUUID(),
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, code, message, headers) =>
  send(res, status, { error: { code, message } }, headers);

// Vercel may already parse JSON onto req.body; fall back to the raw stream.
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body))
      return req.body;
    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : String(req.body);
    if (!raw) return {};
    return JSON.parse(raw);
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const VALID_STATUS = new Set(ASSET_STATUSES);
const touch = (asset) => {
  asset.version += 1;
  asset.updatedAt = new Date().toISOString();
};

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length)
    return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "local";
}

// Nested /api/* is rewritten to this function with ?p=/api/... (see vercel.json).
function parseRequest(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headerPath = [
    req.headers["x-forwarded-uri"],
    req.headers["x-invoke-path"],
  ].find(
    (v) => typeof v === "string" && v.startsWith("/api") && !v.includes("["),
  );
  if (headerPath) return new URL(headerPath, "http://localhost");

  const rewritten = url.searchParams.get("p");
  if (rewritten && rewritten.startsWith("/api")) {
    const original = new URL(rewritten, "http://localhost");
    url.searchParams.delete("p");
    for (const [key, value] of url.searchParams)
      original.searchParams.set(key, value);
    return original;
  }

  return url;
}

export default async function handler(req, res) {
  const url = parseRequest(req);
  const { pathname } = url;
  const query = url.searchParams;
  const ip = clientIp(req);

  if (req.method === "OPTIONS") return send(res, 204, null);

  if (pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      assets: assets.size,
      chaos: CHAOS,
      latency: LATENCY,
    });
  }

  // SSE is unused by the app and does not fit a request/response function.
  if (pathname === "/api/events") {
    return fail(
      res,
      404,
      "not_found",
      "SSE is not available on this deployment.",
    );
  }

  if (!pathname.startsWith("/api/thumb/") && rateLimited(ip)) {
    return fail(
      res,
      429,
      "rate_limited",
      "Too many requests in the last 10 seconds.",
      {
        "retry-after": "3",
      },
    );
  }

  await sleep(latencyFor(pathname, query));

  // GET /api/thumb/:id.svg — ~4% of assets have no thumbnail (404).
  const thumbMatch = pathname.match(/^\/api\/thumb\/(a_\d{5})\.svg$/);
  if (thumbMatch && req.method === "GET") {
    const asset = assets.get(thumbMatch[1]);
    if (!asset) return fail(res, 404, "not_found", "No such asset.");
    if (!asset.hasThumbnail) {
      return fail(
        res,
        404,
        "thumbnail_missing",
        "This asset has no rendered thumbnail.",
      );
    }
    const { a, b } = thumbColors(asset.id);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200" role="img" aria-label="${asset.kind}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="320" height="200" fill="url(#g)"/>
<text x="16" y="184" font-family="ui-monospace,monospace" font-size="13" fill="rgba(255,255,255,.82)">${asset.id}</text>
</svg>`;
    res.writeHead(200, {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    });
    return res.end(svg);
  }

  // Reference data (unused by the current UI, kept for API parity).
  if (pathname === "/api/collections" && req.method === "GET") {
    return send(res, 200, { items: COLLECTIONS });
  }
  if (pathname === "/api/facets" && req.method === "GET") {
    return send(res, 200, {
      tags: ALL_TAGS,
      owners: ALL_OWNERS,
      statuses: ASSET_STATUSES,
      kinds: ASSET_KINDS,
    });
  }
  if (pathname === "/api/stats" && req.method === "GET") {
    const byStatus = {};
    const byKind = {};
    let bytes = 0;
    for (const a of assets.values()) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
      bytes += a.sizeBytes;
    }
    return send(res, 200, {
      total: assets.size,
      byStatus,
      byKind,
      totalBytes: bytes,
    });
  }

  // GET /api/assets/batch?ids= — cap 25.
  if (pathname === "/api/assets/batch" && req.method === "GET") {
    const ids = csv(query.get("ids"));
    if (ids.length === 0)
      return fail(res, 400, "bad_request", "ids is required.");
    if (ids.length > 25) {
      return fail(res, 400, "too_many_ids", "Request at most 25 ids per call.");
    }
    const items = ids.map((id) => assets.get(id)).filter(Boolean);
    const missing = ids.filter((id) => !assets.has(id));
    return send(res, 200, { items, missing });
  }

  // GET /api/assets — ~6% 503, cursor-paged, limit capped at 50.
  if (pathname === "/api/assets" && req.method === "GET") {
    if (chance(0.06)) {
      return fail(
        res,
        503,
        "upstream_unavailable",
        "Search index is warming up.",
        {
          "retry-after": "2",
        },
      );
    }

    const limit = Math.min(Number(query.get("limit") ?? 24) || 24, 50);
    const fp = fingerprint(query);
    let offset = 0;
    const cursor = query.get("cursor");
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded)
        return fail(res, 400, "bad_cursor", "Cursor could not be decoded.");
      if (decoded.f !== fp) {
        return fail(
          res,
          400,
          "stale_cursor",
          "This cursor was issued for a different query. Start again without a cursor.",
        );
      }
      offset = decoded.o;
    }

    const { rows, error } = queryAssets(query);
    if (error) return fail(res, 400, "bad_request", error);

    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return send(res, 200, {
      items: page,
      total: rows.length,
      nextCursor:
        nextOffset < rows.length ? encodeCursor(nextOffset, fp) : null,
    });
  }

  // POST /api/assets/bulk-status — cap 50 ids; 207 on partial failure.
  if (pathname === "/api/assets/bulk-status" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return fail(res, 400, "bad_request", e.message);
    }
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const status = body.status;
    if (!VALID_STATUS.has(status)) {
      return fail(
        res,
        422,
        "invalid_status",
        `status must be one of ${ASSET_STATUSES.join(", ")}.`,
      );
    }
    if (ids.length === 0)
      return fail(res, 400, "bad_request", "ids must not be empty.");
    if (ids.length > 50) {
      return fail(
        res,
        400,
        "too_many_ids",
        "Update at most 50 assets per call.",
      );
    }

    const results = ids.map((id) => {
      const asset = assets.get(id);
      if (!asset) return { id, ok: false, code: "not_found" };
      if (asset.tags.includes("legal-hold")) {
        return {
          id,
          ok: false,
          code: "legal_hold",
          message: "Asset is on legal hold.",
        };
      }
      if (chance(0.07))
        return { id, ok: false, code: "conflict", message: "Write conflict." };
      asset.status = status;
      touch(asset);
      return { id, ok: true, asset };
    });

    const failed = results.filter((r) => !r.ok).length;
    return send(res, failed === 0 ? 200 : 207, {
      results,
      applied: results.length - failed,
      failed,
    });
  }

  // GET/PATCH /api/assets/:id — PATCH requires version; ~12% 500 write_failed.
  const idMatch = pathname.match(/^\/api\/assets\/(a_\d{5})$/);
  if (idMatch) {
    const asset = assets.get(idMatch[1]);
    if (!asset) return fail(res, 404, "not_found", "No such asset.");

    if (req.method === "GET") return send(res, 200, asset);

    if (req.method === "PATCH") {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        return fail(res, 400, "bad_request", e.message);
      }
      if (typeof body.version !== "number") {
        return fail(res, 400, "bad_request", "version is required.");
      }
      if (body.version !== asset.version) {
        return fail(
          res,
          409,
          "version_conflict",
          "Asset changed since you loaded it.",
          {},
        );
      }
      if (chance(0.12)) {
        return fail(res, 500, "write_failed", "Write failed. Safe to retry.");
      }

      const patch = body.patch ?? {};
      if (patch.name !== undefined) {
        if (typeof patch.name !== "string" || patch.name.trim().length < 3) {
          return fail(
            res,
            422,
            "invalid_name",
            "name must be at least 3 characters.",
          );
        }
        asset.name = patch.name.trim();
      }
      if (patch.status !== undefined) {
        if (!VALID_STATUS.has(patch.status)) {
          return fail(res, 422, "invalid_status", "Unknown status.");
        }
        if (asset.tags.includes("legal-hold") && patch.status === "archived") {
          return fail(
            res,
            422,
            "legal_hold",
            "Assets on legal hold cannot be archived.",
          );
        }
        asset.status = patch.status;
      }
      if (patch.tags !== undefined) {
        if (
          !Array.isArray(patch.tags) ||
          patch.tags.some((t) => typeof t !== "string")
        ) {
          return fail(
            res,
            422,
            "invalid_tags",
            "tags must be an array of strings.",
          );
        }
        asset.tags = [
          ...new Set(patch.tags.map((t) => t.trim()).filter(Boolean)),
        ];
      }

      touch(asset);
      return send(res, 200, asset);
    }
  }

  return fail(res, 404, "not_found", `No route for ${req.method} ${pathname}`);
}
