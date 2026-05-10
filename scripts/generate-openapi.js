// Generates /.well-known/openapi.json — describes the listener-facing
// read-only API surface so agents can introspect tools without scraping.
//
// Endpoints described:
//   GET  /api/search       — server-side full-text search
//   GET  /episodes.json    — full episode list (static)
//   GET  /search-index.json — flat search index (static)
//   GET  /rss.xml          — podcast feed
//   GET  /llms.txt         — agent briefing
//   GET  /mcp              — MCP server manifest
//   POST /mcp              — MCP JSON-RPC

import { writeFileSync, mkdirSync } from "fs";
import config from "./load-config.js";

const SITE = "{{SITE_URL}}";

const spec = {
  openapi: "3.1.0",
  info: {
    title: `${config.title} — Listener API`,
    version: "1.0.0",
    description:
      `Read-only API for consuming ${config.title} episodes. ` +
      `All endpoints are public, unauthenticated, and safe to call from ` +
      `assistant agents on behalf of a listener. ` +
      `For native MCP clients see POST ${SITE}/mcp.`,
    ...(config.author ? { contact: { name: config.author } } : {}),
    ...(config.license ? { license: { name: config.license } } : {}),
  },
  servers: [{ url: SITE }],
  paths: {
    "/api/search": {
      get: {
        summary: "Search episodes",
        description:
          "Free-text search over episode title, description, and transcript. " +
          "Returns ranked results with snippets.",
        operationId: "searchEpisodes",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1 },
            description: "Search query.",
            example: "agentic commerce",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            description: "Max results to return.",
          },
        ],
        responses: {
          "200": {
            description: "Ranked search results.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SearchResponse" },
              },
            },
          },
          "400": {
            description: "Missing query parameter.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/episodes.json": {
      get: {
        summary: "List all episodes",
        description: "Static JSON: every episode with id, title, date, duration, audio URL, etc.",
        operationId: "listEpisodes",
        responses: {
          "200": {
            description: "Array of episodes (sorted by id ascending).",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Episode" } },
              },
            },
          },
        },
      },
    },
    "/search-index.json": {
      get: {
        summary: "Full search index",
        description:
          "Flat object mapping episode id → indexed text (title + description + transcript). " +
          "Use /api/search for ranked queries; this is for offline indexing.",
        operationId: "getSearchIndex",
        responses: {
          "200": {
            description: "Episode-id → indexed text.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    "/rss.xml": {
      get: {
        summary: "Podcast RSS feed",
        description: "Subscribe via any podcast app.",
        operationId: "getRss",
        responses: {
          "200": {
            description: "RSS 2.0 feed.",
            content: { "application/rss+xml": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/llms.txt": {
      get: {
        summary: "Agent briefing",
        description: "Markdown briefing for assistant agents — what the show is, capabilities, latest episode.",
        operationId: "getLlmsTxt",
        responses: {
          "200": {
            description: "Markdown briefing.",
            content: { "text/plain": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/mcp": {
      get: {
        summary: "MCP server manifest",
        description: "Returns the MCP server manifest (tools list, transport, protocol version).",
        operationId: "getMcpManifest",
        responses: {
          "200": {
            description: "Server manifest.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
      post: {
        summary: "MCP JSON-RPC endpoint",
        description:
          "Streamable HTTP transport for the Model Context Protocol. " +
          "Methods: initialize, ping, tools/list, tools/call. " +
          "Tools: search_episodes, get_episode, get_latest_episode, list_episodes, subscribe_via_rss.",
        operationId: "callMcp",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/JsonRpcRequest" },
              example: {
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name: "search_episodes", arguments: { query: "agents", limit: 5 } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "JSON-RPC 2.0 response.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcResponse" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Episode: {
        type: "object",
        required: ["id", "season", "title"],
        properties: {
          id: { type: "integer", description: "Episode number." },
          season: { type: "integer" },
          title: { type: "string" },
          desc: { type: "string", description: "Episode description." },
          duration: { type: "string", description: "MM:SS or HH:MM:SS." },
          seconds: { type: "integer" },
          date: { type: "string", format: "date" },
          audioFile: { type: "string", description: "Filename of the MP3." },
          srtFile: { type: "string", description: "Filename of the SRT transcript." },
          guid: { type: "string" },
          spotifyUrl: { type: "string", format: "uri" },
          appleUrl: { type: "string", format: "uri" },
          amazonUrl: { type: "string", format: "uri" },
          youtubeUrl: { type: "string", format: "uri" },
          hasSrt: { type: "boolean" },
          guests: { type: "array", items: { type: "string" } },
          topics: { type: "array", items: { type: "string" } },
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: { start: { type: "string" }, title: { type: "string" } },
            },
          },
        },
      },
      SearchResult: {
        type: "object",
        required: ["id", "title", "url", "score"],
        properties: {
          id: { type: "integer" },
          title: { type: "string" },
          date: { type: "string" },
          season: { type: "integer" },
          duration: { type: "string" },
          url: { type: "string", format: "uri" },
          audio: { type: "string", format: "uri" },
          transcript: { type: ["string", "null"], format: "uri" },
          score: { type: "number" },
          snippet: { type: "string" },
        },
      },
      SearchResponse: {
        type: "object",
        required: ["query", "count", "results"],
        properties: {
          query: { type: "string" },
          count: { type: "integer" },
          took_ms: { type: "integer" },
          results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
        },
      },
      JsonRpcRequest: {
        type: "object",
        required: ["jsonrpc", "method"],
        properties: {
          jsonrpc: { type: "string", enum: ["2.0"] },
          id: { oneOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
          method: { type: "string" },
          params: { type: "object" },
        },
      },
      JsonRpcResponse: {
        type: "object",
        required: ["jsonrpc"],
        properties: {
          jsonrpc: { type: "string", enum: ["2.0"] },
          id: { oneOf: [{ type: "integer" }, { type: "string" }, { type: "null" }] },
          result: {},
          error: {
            type: "object",
            properties: {
              code: { type: "integer" },
              message: { type: "string" },
              data: {},
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
};

mkdirSync("public/.well-known", { recursive: true });
writeFileSync("public/.well-known/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log("Generated public/.well-known/openapi.json");
