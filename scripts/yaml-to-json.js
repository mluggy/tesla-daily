import { readFileSync, writeFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import config from "./load-config.js";
const parseYaml = yaml.load;

const EPISODES_DIR = "episodes";
const YAML_PATH = `${EPISODES_DIR}/episodes.yaml`;
const RSS_PATH = `${EPISODES_DIR}/rss.xml`;
const OUT_PATH = "public/episodes.json";

// Platform URL patterns
function appleUrl(id) {
  return id ? `https://podcasts.apple.com/${config.apple_podcasts_country || "us"}/podcast/id${config.apple_podcasts_id}?i=${id}` : "";
}
function spotifyUrl(id) {
  return id ? `https://open.spotify.com/episode/${id}` : "";
}
function amazonUrl(id) {
  if (id && config.amazon_music_id) return `https://music.amazon.com/podcasts/${config.amazon_music_id}/episodes/${id}`;
  if (id) return `https://music.amazon.com/podcasts/${id}`;
  return "";
}
function youtubeUrl(videoId) {
  if (videoId && config.youtube_id) return `https://www.youtube.com/watch?v=${videoId}&list=${config.youtube_id}`;
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  return "";
}

// Strip SRT timestamps and block numbers, return plain text
function srtToText(srtContent) {
  return srtContent
    .replace(/^\d+\s*$/gm, "")
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\s*$/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse MM:SS or HH:MM:SS to seconds
function durToSecs(dur) {
  if (!dur) return 0;
  const parts = dur.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// Parse RFC2822 date to YYYY-MM-DD
function parseDate(rfc) {
  if (!rfc) return "";
  const d = new Date(rfc);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Extract episode data from rss.xml using regex (no XML parser needed)
function parseRssMetadata(rssXml) {
  const meta = {};
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(rssXml)) !== null) {
    const item = match[1];
    // Try auto-generated GUID format first, then fall back to itunes:season+episode tags
    const guidRegex = /<guid[^>]*>(?:.*?-)?s(\d+)e(\d+)<\/guid>/;
    const guidMatch = item.match(guidRegex);
    let season, epNum;
    if (guidMatch) {
      season = parseInt(guidMatch[1]);
      epNum = parseInt(guidMatch[2]);
    } else {
      // Custom GUID — extract season/episode from itunes tags
      const sTag = item.match(/<itunes:season>(\d+)<\/itunes:season>/);
      const eTag = item.match(/<itunes:episode>(\d+)<\/itunes:episode>/);
      if (!sTag || !eTag) continue;
      season = parseInt(sTag[1]);
      epNum = parseInt(eTag[1]);
    }

    const durMatch = item.match(/<itunes:duration>([^<]+)<\/itunes:duration>/);
    const dateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);
    const seasonMatch = item.match(/<itunes:season>(\d+)<\/itunes:season>/);
    const srtMatch = item.match(/<podcast:transcript/);

    meta[epNum] = {
      season: seasonMatch ? parseInt(seasonMatch[1]) : season,
      duration: durMatch ? durMatch[1] : "",
      date: dateMatch ? parseDate(dateMatch[1]) : "",
      hasSrt: !!srtMatch,
    };
  }
  return meta;
}

// Main
const yamlData = parseYaml(readFileSync(YAML_PATH, "utf8"));
const yamlEpisodes = yamlData.episodes || {};

let rssMeta = {};
if (existsSync(RSS_PATH)) {
  rssMeta = parseRssMetadata(readFileSync(RSS_PATH, "utf8"));
}

const episodes = [];
for (const [idStr, ep] of Object.entries(yamlEpisodes)) {
  const id = parseInt(idStr);
  const rss = rssMeta[id] || {};
  const season = ep.season || rss.season || 1;
  const audioFile = `s${season}e${id}.mp3`;
  const srtFile = `s${season}e${id}.srt`;

  // Read transcript files once, reuse for both description fallback and search index
  const txtPath = `${EPISODES_DIR}/${srtFile.replace(".srt", ".txt")}`;
  const srtPath = `${EPISODES_DIR}/${srtFile}`;
  const txtContent = existsSync(txtPath) ? readFileSync(txtPath, "utf8").trim() : "";
  const hasSrtFile = existsSync(srtPath);
  const srtContent = !txtContent && hasSrtFile ? readFileSync(srtPath, "utf8") : "";

  const fullText = txtContent || (srtContent ? srtToText(srtContent) : "");
  const desc = ep.description || "";

  // GUID: use explicit guid from yaml, fall back to auto-generated format
  const guid = ep.guid || `s${season}e${id}`;

  episodes.push({
    id,
    season,
    title: ep.title || "",
    desc,
    duration: ep.duration || rss.duration || "",
    seconds: durToSecs(ep.duration || rss.duration),
    date: ep.date ? parseDate(String(ep.date)) : rss.date || "",
    audioFile,
    srtFile,
    guid,
    appleUrl: appleUrl(ep.apple_id),
    spotifyUrl: spotifyUrl(ep.spotify_id),
    amazonUrl: amazonUrl(ep.amazon_id),
    youtubeUrl: youtubeUrl(ep.youtube_id),
    hasSrt: rss.hasSrt ?? hasSrtFile,
    guests: Array.isArray(ep.guests) ? ep.guests : [],
    topics: Array.isArray(ep.topics) ? ep.topics : [],
    chapters: Array.isArray(ep.chapters) ? ep.chapters : [],
    _fullText: fullText,
  });
}

episodes.sort((a, b) => a.id - b.id);

// Write episodes.json (without full text — kept lean for initial page load).
// Strip empty strings, zeros, nulls, and false booleans to keep the file small;
// consumers already guard every optional field with truthiness checks.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === 0 || v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}
const publicEpisodes = episodes.map(({ _fullText, ...rest }) => compact(rest));
writeFileSync(OUT_PATH, JSON.stringify(publicEpisodes, null, 2) + "\n");
console.log(`Generated ${OUT_PATH} with ${episodes.length} episodes`);

// Write search index — maps episode ID to searchable text (title + desc + transcript)
const searchIndex = {};
for (const ep of episodes) {
  const parts = [ep.title, ep.desc, ep._fullText].filter(Boolean);
  searchIndex[ep.id] = parts.join(" ");
}
writeFileSync("public/search-index.json", JSON.stringify(searchIndex) + "\n");
const indexSize = (Buffer.byteLength(JSON.stringify(searchIndex)) / 1024).toFixed(0);
console.log(`Generated public/search-index.json (${indexSize} KB)`);
