// MCP server (Streamable HTTP transport) — listener-facing.
// Lets ChatGPT custom connectors, Claude.ai integrations, Cursor, and
// other native MCP clients consume the show via JSON-RPC tool calls.
//
// Tools (all read-only, all driven by static episode data):
//   search_episodes(query, limit?)   — ranked match
//   get_episode(id)                  — full detail incl. transcript
//   get_latest_episode()             — most recent
//   list_episodes(limit?, offset?)   — paginated browse
//   subscribe_via_rss()              — return RSS URL

import episodes from "./_episodes.js";
import config from "./_config.js";
import { searchEpisodes, summarizeEpisode } from "./_search.js";

const SERVER_INFO = {
  name: "coil-podcast-mcp",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "search_episodes",
    description:
      `Search ${config.title || "podcast"} episodes by topic, person, company, or keyword. ` +
      "Returns ranked results with title, date, URL, and a snippet from the transcript.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (free text)." },
        limit: { type: "integer", description: "Max results (1–50).", default: 10, minimum: 1, maximum: 50 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_episode",
    description:
      "Fetch a single episode by its numeric ID. Returns title, date, description, audio URL, transcript URL, and full transcript text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Episode number (1, 2, …)." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_latest_episode",
    description: "Return the most recently published episode with metadata, audio URL, and transcript URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_episodes",
    description: "Return episodes in reverse-chronological order with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 20, minimum: 1, maximum: 100 },
        offset: { type: "integer", default: 0, minimum: 0 },
      },
    },
  },
  {
    name: "subscribe_via_rss",
    description: "Return the canonical RSS feed URL so the user can subscribe in their podcast app.",
    inputSchema: { type: "object", properties: {} },
  },
];

function ok(id, result) {
  return Response.json({ jsonrpc: "2.0", id, result });
}
function err(id, code, message, data) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}
function textContent(obj) {
  return [{ type: "text", text: JSON.stringify(obj, null, 2) }];
}

function callTool(name, args, baseUrl) {
  switch (name) {
    case "search_episodes": {
      const query = String(args.query || "").trim();
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
      if (!query) throw new Error("query is required");
      const results = searchEpisodes(query, { limit, baseUrl });
      return { query, count: results.length, results };
    }
    case "get_episode": {
      const id = Number(args.id);
      if (!Number.isInteger(id)) throw new Error("id must be an integer");
      const ep = episodes.find((e) => e.id === id);
      if (!ep) throw new Error(`episode ${id} not found`);
      return {
        ...summarizeEpisode(ep, baseUrl),
        fullText: ep.fullText || null,
      };
    }
    case "get_latest_episode": {
      const sorted = [...episodes].sort((a, b) => b.id - a.id);
      const ep = sorted[0];
      if (!ep) throw new Error("no episodes published yet");
      return summarizeEpisode(ep, baseUrl);
    }
    case "list_episodes": {
      const sorted = [...episodes].sort((a, b) => b.id - a.id);
      const offset = Math.max(0, Number(args.offset) || 0);
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      return {
        total: sorted.length,
        offset,
        limit,
        episodes: sorted.slice(offset, offset + limit).map((e) => summarizeEpisode(e, baseUrl)),
      };
    }
    case "subscribe_via_rss": {
      return { rss: `${baseUrl}/rss.xml` };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function onRequestPost({ request }) {
  const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;

  let body;
  try {
    body = await request.json();
  } catch {
    return err(null, -32700, "Parse error: invalid JSON body");
  }

  const { id = null, method, params } = body || {};
  if (!method) return err(id, -32600, "Invalid Request: missing method");

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (!name) return err(id, -32602, "Invalid params: missing tool name");
    try {
      const result = callTool(name, args, baseUrl);
      return ok(id, { content: textContent(result), isError: false });
    } catch (e) {
      return ok(id, {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }

  return err(id, -32601, `Method not found: ${method}`);
}

// GET /mcp returns a manifest summary so curl/browser inspection is friendly.
export async function onRequestGet({ request }) {
  const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
  return Response.json({
    server: SERVER_INFO,
    protocolVersion: PROTOCOL_VERSION,
    transport: "streamable-http",
    endpoint: `${baseUrl}/mcp`,
    methods: ["initialize", "ping", "tools/list", "tools/call"],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    docs: `${baseUrl}/.well-known/openapi.json`,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
