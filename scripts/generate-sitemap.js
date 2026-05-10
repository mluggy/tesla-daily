import { readFileSync, writeFileSync } from "fs";
import config from "./load-config.js";

const episodes = JSON.parse(readFileSync("public/episodes.json", "utf8"));

// Absolute URLs are filled in by the middleware at serve time, so the same
// sitemap.xml / robots.txt works on any hostname.
const SITE = "{{SITE_URL}}";

const urls = [
  { loc: `${SITE}/`, lastmod: episodes[episodes.length - 1]?.date || "", priority: "1.0" },
  ...episodes.map((ep) => ({
    loc: `${SITE}/${ep.id}`,
    lastmod: ep.date || "",
    priority: "0.8",
  })),
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

writeFileSync("public/sitemap.xml", xml);
console.log(`Generated sitemap.xml with ${urls.length} URLs`);

// Generate robots.txt with Content-Signal hints + Schemamap pointer.
// Live agent crawl (ChatGPT-User, OAI-SearchBot, PerplexityBot, ClaudeBot
// search) is always allowed so the show stays discoverable in answer
// engines. Training crawl (GPTBot, CCBot, Anthropic-AI for training,
// Bytespider, ClaudeBot training) is gated on `ai_training` in podcast.yaml.
const allowTraining = config.ai_training === true;
const trainSignal = allowTraining ? "yes" : "no";
const trainingBlocks = allowTraining
  ? ""
  : [
      "",
      "# Opt-out: training crawlers (set ai_training: true in podcast.yaml to allow).",
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: CCBot",
      "Disallow: /",
      "",
      "User-agent: anthropic-ai",
      "Disallow: /",
      "",
      "User-agent: Bytespider",
      "Disallow: /",
      "",
      "User-agent: Google-Extended",
      "Disallow: /",
      "",
      "User-agent: Applebot-Extended",
      "Disallow: /",
    ].join("\n");

const robots = [
  "User-agent: *",
  `Content-Signal: search=yes, ai-input=yes, ai-train=${trainSignal}`,
  "Allow: /",
  trainingBlocks,
  "",
  `Sitemap: ${SITE}/sitemap.xml`,
  `Schemamap: ${SITE}/.well-known/schema-map.xml`,
  "",
].join("\n");

writeFileSync("public/robots.txt", robots);
console.log(`Generated robots.txt (ai-train=${trainSignal})`);
