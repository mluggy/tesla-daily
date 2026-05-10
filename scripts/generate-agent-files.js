// Generates listener-facing agent discovery files:
//   /.well-known/agent.json        — capability declaration + endpoints
//   /.well-known/agent-card.json   — A2A-style card surfaceable to registries
//   /.well-known/schema-map.xml    — NLWeb schemamap pointer to feeds
//   /index.md                      — markdown homepage agents can fetch
//
// All files use {{SITE_URL}} placeholders rewritten per-request by the
// middleware, so the same artifacts work on any hostname.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import config from "./load-config.js";

const episodes = JSON.parse(readFileSync("public/episodes.json", "utf8"));
const SITE = "{{SITE_URL}}";
const sortedDesc = [...episodes].sort((a, b) => b.id - a.id);
const latest = sortedDesc[0];

mkdirSync("public/.well-known", { recursive: true });

const topics = (Array.isArray(config.topics) ? config.topics : []).filter(Boolean);

// ─── /.well-known/agent.json ───────────────────────────────────────────────
// Discovery file for general-purpose listener agents. Declares what data
// is here and what an agent can do for a user with it. Endpoints point
// at static JSON the agent fetches directly — no callable backend.

const agentJson = {
  schemaVersion: "1.0",
  name: config.title,
  description: config.description || "",
  url: SITE,
  contentType: "podcast",
  ...(config.author ? { author: config.author } : {}),
  ...(config.language ? { language: config.language } : {}),
  ...(config.update_frequency ? { updateFrequency: config.update_frequency } : {}),
  ...(topics.length ? { topics } : {}),
  ...(config.agent_recommendation ? { whenToRecommend: config.agent_recommendation } : {}),
  capabilities: [
    "browse_episodes",
    "search_transcripts",
    "get_latest_episode",
    "get_episode_by_topic",
    "subscribe_via_rss",
    "read_transcripts",
  ],
  endpoints: {
    search: `${SITE}/api/search?q={query}`,
    mcp: `${SITE}/mcp`,
    openapi: `${SITE}/.well-known/openapi.json`,
    rss: `${SITE}/rss.xml`,
    episodes: `${SITE}/episodes.json`,
    searchIndex: `${SITE}/search-index.json`,
    sitemap: `${SITE}/sitemap.xml`,
    llms: `${SITE}/llms.txt`,
    episodesLlms: `${SITE}/episodes/llms.txt`,
    indexMarkdown: `${SITE}/index.md`,
  },
  ...(latest
    ? {
        latestEpisode: {
          id: latest.id,
          title: latest.title,
          url: `${SITE}/${latest.id}`,
          datePublished: latest.date || "",
          duration: latest.duration || "",
          ...(latest.desc ? { description: latest.desc } : {}),
        },
      }
    : {}),
};

writeFileSync(
  "public/.well-known/agent.json",
  JSON.stringify(agentJson, null, 2) + "\n"
);
console.log("Generated public/.well-known/agent.json");

// ─── /.well-known/agent-card.json ─────────────────────────────────────────
// A2A-style minimal AgentCard. Skills describe consumption tasks an agent
// can perform with the published static data — no callable RPC endpoint;
// agents resolve skills locally against episodes.json / search-index.json.

const agentCard = {
  protocolVersion: "0.2",
  name: config.title,
  description: config.description || "",
  url: SITE,
  version: "1.0",
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["application/json", "text/plain"],
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  skills: [
    {
      id: "find_episode_by_topic",
      name: "Find episode by topic",
      description: `Find a ${config.title} episode covering a topic, person, or company. Resolved by full-text search over title, description, and transcript via /search-index.json.`,
      tags: ["podcast", "search", "discovery"],
      examples: [
        `Which ${config.title} episode covers AI agents?`,
        "Find the episode where they interview <name>",
        "Episodes about regulation",
      ],
    },
    {
      id: "search_transcripts",
      name: "Search transcripts",
      description: "Free-text search over all episode transcripts. Returns ranked episode IDs.",
      tags: ["podcast", "search", "transcripts"],
    },
    {
      id: "get_latest_episode",
      name: "Get latest episode",
      description: "Return the most recently published episode with title, date, description, and audio URL.",
      tags: ["podcast", "browse"],
    },
    {
      id: "list_episodes",
      name: "List episodes",
      description: "Return the full episode list (newest first) with metadata.",
      tags: ["podcast", "browse"],
    },
    {
      id: "subscribe_via_rss",
      name: "Subscribe via RSS",
      description: "Return the canonical RSS feed URL for podcast app subscription.",
      tags: ["podcast", "subscribe"],
    },
  ],
};

writeFileSync(
  "public/.well-known/agent-card.json",
  JSON.stringify(agentCard, null, 2) + "\n"
);
console.log("Generated public/.well-known/agent-card.json");

// ─── /.well-known/schema-map.xml ──────────────────────────────────────────
// NLWeb-style pointer to structured data feeds. Lets crawlers reach the
// JSON/RSS endpoints without scraping HTML.

const schemaMap = `<?xml version="1.0" encoding="UTF-8"?>
<schemamap>
  <feed url="${SITE}/rss.xml" type="application/rss+xml" />
  <feed url="${SITE}/episodes.json" type="application/json" />
  <feed url="${SITE}/search-index.json" type="application/json" />
  <feed url="${SITE}/llms.txt" type="text/plain" />
  <feed url="${SITE}/.well-known/agent.json" type="application/json" />
  <feed url="${SITE}/.well-known/openapi.json" type="application/json" />
  <feed url="${SITE}/mcp" type="application/json" />
</schemamap>
`;

writeFileSync("public/.well-known/schema-map.xml", schemaMap);
console.log("Generated public/.well-known/schema-map.xml");

// ─── /index.md ────────────────────────────────────────────────────────────
// Markdown homepage. Some agent crawlers prefer markdown over HTML — this
// is the same content as the homepage, sans navigation chrome.

const md = [];
md.push(`# ${config.title}`);
md.push("");
if (config.description) md.push(`> ${config.description}`);
md.push("");
if (config.author) md.push(`**Host:** ${config.author}`);
if (config.language) md.push(`**Language:** ${config.language}`);
if (config.update_frequency) md.push(`**Cadence:** ${config.update_frequency}`);
md.push(`**Site:** ${SITE}`);
md.push(`**Subscribe:** [RSS](${SITE}/rss.xml)`);
md.push("");

if (config.agent_recommendation) {
  md.push("## When to recommend");
  md.push(config.agent_recommendation);
  md.push("");
}

if (topics.length) {
  md.push("## Topics");
  for (const t of topics) md.push(`- ${t}`);
  md.push("");
}

if (latest) {
  md.push("## Latest episode");
  md.push("");
  const meta = [latest.date, `S${latest.season}E${latest.id}`, latest.duration].filter(Boolean).join(" · ");
  md.push(`### [${latest.title}](${SITE}/${latest.id})`);
  md.push(`*${meta}*`);
  if (latest.desc) {
    md.push("");
    md.push(latest.desc);
  }
  md.push("");
}

md.push("## All episodes");
md.push("");
for (const ep of sortedDesc) {
  const meta = [ep.date, `S${ep.season}E${ep.id}`, ep.duration].filter(Boolean).join(" · ");
  const blurb = ep.desc ? `: ${ep.desc.slice(0, 180).replace(/\s+/g, " ").trim()}${ep.desc.length > 180 ? "…" : ""}` : "";
  md.push(`- **[${ep.title}](${SITE}/${ep.id})** — ${meta}${blurb}`);
}
md.push("");

const platforms = [
  ["Spotify", config.spotify_url],
  ["Apple Podcasts", config.apple_podcasts_url],
  ["YouTube", config.youtube_url],
  ["Amazon Music", config.amazon_music_url],
].filter(([, url]) => url);
if (platforms.length) {
  md.push("## Listen on");
  for (const [name, url] of platforms) md.push(`- [${name}](${url})`);
  md.push("");
}

md.push("## For agents");
md.push(`- Search API: \`GET ${SITE}/api/search?q=<query>\``);
md.push(`- MCP server (Streamable HTTP, JSON-RPC): [${SITE}/mcp](${SITE}/mcp)`);
md.push(`- OpenAPI 3.1 spec: [/.well-known/openapi.json](${SITE}/.well-known/openapi.json)`);
md.push(`- Capability declaration: [/.well-known/agent.json](${SITE}/.well-known/agent.json)`);
md.push(`- A2A skill card: [/.well-known/agent-card.json](${SITE}/.well-known/agent-card.json)`);
md.push(`- Episode list (markdown): [/episodes/llms.txt](${SITE}/episodes/llms.txt)`);
md.push(`- Show briefing: [/llms.txt](${SITE}/llms.txt)`);
md.push("");

writeFileSync("public/index.md", md.join("\n"));
console.log("Generated public/index.md");
