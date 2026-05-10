import { readFileSync, writeFileSync, mkdirSync } from "fs";
import config from "./load-config.js";

const episodes = JSON.parse(readFileSync("public/episodes.json", "utf8"));

// Absolute URLs are filled in by the middleware at serve time.
const SITE = "{{SITE_URL}}";

const L = config.labels || {};
const sortedDesc = [...episodes].sort((a, b) => b.id - a.id);
const latest = sortedDesc[0];

// ─── Root /llms.txt ─────────────────────────────────────────────────────────
// High-level briefing. An agent reading this should know what the show is,
// when to recommend it, where to subscribe, and how to find specific
// episodes. Per-episode descriptions live in /episodes/llms.txt.

const root = [];
root.push(`# ${config.title}`);
root.push("");
if (config.description) {
  root.push(`> ${config.description}`);
  root.push("");
}

root.push("## About");
if (config.author) root.push(`- Author: ${config.author}`);
if (config.language) root.push(`- Language: ${config.language}`);
if (config.copyright) root.push(`- Copyright: ${config.copyright}`);
if (config.license) root.push(`- License: ${config.license}`);
if (config.update_frequency) root.push(`- Cadence: ${config.update_frequency}`);
root.push(`- Site: ${SITE}`);
root.push("");

if (config.agent_recommendation) {
  root.push("## When to recommend");
  root.push(config.agent_recommendation);
  root.push("");
}

const topics = Array.isArray(config.topics) ? config.topics.filter(Boolean) : [];
const cats = Array.isArray(config.itunes_categories)
  ? config.itunes_categories.map((c) => (typeof c === "string" ? c : Object.values(c)[0]))
  : [];
if (topics.length || cats.length) {
  root.push("## Topics");
  for (const t of topics) root.push(`- ${t}`);
  for (const c of cats) if (!topics.includes(c)) root.push(`- ${c}`);
  root.push("");
}

root.push("## Capabilities");
root.push("Listeners and assistant agents can:");
root.push(`- Search episodes (ranked) via \`GET ${SITE}/api/search?q=<query>\`.`);
root.push(`- Browse all episodes via [episodes.json](${SITE}/episodes.json) (id, title, date, duration, description, audio URL, transcript URL).`);
root.push(`- Subscribe to new episodes via [RSS](${SITE}/rss.xml).`);
root.push(`- Use the [MCP server](${SITE}/mcp) (Streamable HTTP, JSON-RPC 2.0) for native MCP clients — tools: \`search_episodes\`, \`get_episode\`, \`get_latest_episode\`, \`list_episodes\`, \`subscribe_via_rss\`.`);
root.push(`- Read full transcripts at \`/<episode_id>\` (HTML, SSR-rendered, JS-free) or fetch the underlying \`/sNNeMM.txt\` plain text.`);
root.push(`- See the full episode list with descriptions in [/episodes/llms.txt](${SITE}/episodes/llms.txt).`);
root.push("");

root.push("## Data & APIs");
root.push(`- [Search API](${SITE}/api/search?q=) — ranked search over title + description + transcript`);
root.push(`- [MCP server](${SITE}/mcp) — JSON-RPC tool calls (POST) or manifest (GET)`);
root.push(`- [OpenAPI spec](${SITE}/.well-known/openapi.json) — typed contract for all endpoints`);
root.push(`- [Agent card](${SITE}/.well-known/agent.json) — capability declaration`);
root.push(`- [Episodes JSON](${SITE}/episodes.json) — full episode list with metadata`);
root.push(`- [Search index](${SITE}/search-index.json) — episode-id → searchable text (offline indexing)`);
root.push(`- [RSS Feed](${SITE}/rss.xml) — podcast feed`);
root.push(`- [Sitemap](${SITE}/sitemap.xml) — all pages`);
root.push("");

const platforms = [
  ["Spotify", config.spotify_url],
  ["Apple Podcasts", config.apple_podcasts_url],
  ["YouTube", config.youtube_url],
  ["Amazon Music", config.amazon_music_url],
].filter(([, url]) => url);
if (platforms.length) {
  root.push("## Listen");
  for (const [name, url] of platforms) root.push(`- [${name}](${url})`);
  root.push("");
}

if (latest) {
  root.push("## Latest episode");
  const meta = [latest.date, `S${latest.season}E${latest.id}`, latest.duration].filter(Boolean).join(" · ");
  root.push(`**[${latest.title}](${SITE}/${latest.id})** — ${meta}`);
  if (latest.desc) {
    root.push("");
    root.push(latest.desc);
  }
  root.push("");
}

const legal = [
  [L.terms, L.terms_text, "/terms"],
  [L.privacy, L.privacy_text, "/privacy"],
].filter(([title, text]) => title && text);
if (legal.length) {
  root.push("## Legal");
  for (const [title, , path] of legal) {
    root.push(`- [${title}](${SITE}${path})`);
  }
  root.push("");
}

// Episodes — recent N with one-line descriptions; full list in /episodes/llms.txt
root.push("## Recent episodes");
const RECENT = 20;
for (const ep of sortedDesc.slice(0, RECENT)) {
  const meta = [ep.date, `S${ep.season}E${ep.id}`, ep.duration].filter(Boolean).join(" · ");
  const blurb = ep.desc ? ` — ${ep.desc.slice(0, 180).replace(/\s+/g, " ").trim()}${ep.desc.length > 180 ? "…" : ""}` : "";
  root.push(`- [${ep.title}](${SITE}/${ep.id}) · ${meta}${blurb}`);
}
if (sortedDesc.length > RECENT) {
  root.push("");
  root.push(`See [/episodes/llms.txt](${SITE}/episodes/llms.txt) for the full list (${sortedDesc.length} episodes).`);
}
root.push("");

writeFileSync("public/llms.txt", root.join("\n"));
console.log(`Generated public/llms.txt (${sortedDesc.length} episodes)`);

// ─── /episodes/llms.txt ────────────────────────────────────────────────────
// Full episode list with full descriptions, guests, topics, chapters.
// Agents that want to drill into episode content fetch this directly.

const eps = [];
eps.push(`# ${config.title} — All Episodes`);
eps.push("");
eps.push(`> Full episode list. For show-level metadata see [/llms.txt](${SITE}/llms.txt).`);
eps.push("");
for (const ep of sortedDesc) {
  const meta = [ep.date, `S${ep.season}E${ep.id}`, ep.duration].filter(Boolean).join(" · ");
  eps.push(`## [${ep.title}](${SITE}/${ep.id})`);
  eps.push(`*${meta}*`);
  eps.push("");
  if (ep.desc) {
    eps.push(ep.desc);
    eps.push("");
  }
  if (Array.isArray(ep.guests) && ep.guests.length) {
    const names = ep.guests.map((g) => (typeof g === "string" ? g : g.name)).filter(Boolean);
    if (names.length) {
      eps.push(`**Guests:** ${names.join(", ")}`);
      eps.push("");
    }
  }
  if (Array.isArray(ep.topics) && ep.topics.length) {
    eps.push(`**Topics:** ${ep.topics.join(", ")}`);
    eps.push("");
  }
  if (Array.isArray(ep.chapters) && ep.chapters.length) {
    eps.push("**Chapters:**");
    for (const c of ep.chapters) {
      const start = c.start || c.time || "";
      const title = c.title || c.name || "";
      if (title) eps.push(`- ${start ? `${start} — ` : ""}${title}`);
    }
    eps.push("");
  }
  const links = [
    [`Audio`, `${SITE}/${ep.audioFile}`],
    ep.hasSrt ? [`Transcript (text)`, `${SITE}/${ep.audioFile.replace(".mp3", ".txt")}`] : null,
  ].filter(Boolean);
  if (links.length) {
    eps.push(links.map(([n, u]) => `[${n}](${u})`).join(" · "));
    eps.push("");
  }
}

mkdirSync("public/episodes", { recursive: true });
writeFileSync("public/episodes/llms.txt", eps.join("\n"));
console.log(`Generated public/episodes/llms.txt (${sortedDesc.length} episodes)`);
