import template from "./_html-template.js";
import episodes from "./_episodes.js";
import config from "./_config.js";

const BOTS = /googlebot|google-inspectiontool|bingbot|yandex|baiduspider|twitterbot|facebookexternalhit|linkedinbot|slackbot-linkexpanding|discordbot|whatsapp|telegrambot|applebot|pinterestbot|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|anthropic-ai|claudebot|ccbot/i;

const MEDIA_PATTERN = /\.(mp3|srt|txt|png|jpg)$/i;

const CONTENT_TYPES = {
  mp3: "audio/mpeg",
  srt: "application/x-subrip",
  txt: "text/plain; charset=utf-8",
  jpg: "image/jpeg",
  png: "image/png",
  xml: "application/rss+xml",
};

// Build CSP dynamically based on configured analytics providers.
// Called per-request with a fresh nonce for inline script/style tags.
function buildCsp(nonce) {
  const n = `'nonce-${nonce}'`;
  const scriptSrc = ["'self'", n];
  const styleSrc = ["'self'", n, "https://fonts.googleapis.com"];
  const connectSrc = ["'self'"];
  const imgSrc = ["'self'", "data:"];

  if (config.ga_measurement_id) {
    scriptSrc.push("https://*.googletagmanager.com");
    connectSrc.push("https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com");
    imgSrc.push("https://*.google-analytics.com", "https://*.googletagmanager.com");
  }
  if (config.fb_pixel_id) {
    scriptSrc.push("https://connect.facebook.net");
    connectSrc.push("https://www.facebook.com");
    imgSrc.push("https://www.facebook.com");
  }
  if (config.x_pixel_id) {
    scriptSrc.push("https://static.ads-twitter.com");
    connectSrc.push("https://analytics.twitter.com");
    imgSrc.push("https://analytics.twitter.com", "https://t.co");
  }
  if (config.linkedin_partner_id) {
    scriptSrc.push("https://snap.licdn.com");
    connectSrc.push("https://px.ads.linkedin.com");
    imgSrc.push("https://px.ads.linkedin.com");
  }
  if (config.clarity_project_id) {
    scriptSrc.push("https://www.clarity.ms");
    connectSrc.push("https://www.clarity.ms");
    imgSrc.push("https://www.clarity.ms");
  }
  if (config.microsoft_uet_id) {
    scriptSrc.push("https://bat.bing.com");
    connectSrc.push("https://bat.bing.com");
    imgSrc.push("https://bat.bing.com");
  }
  if (config.tiktok_pixel_id) {
    scriptSrc.push("https://analytics.tiktok.com");
    connectSrc.push("https://analytics.tiktok.com");
    imgSrc.push("https://analytics.tiktok.com");
  }
  if (config.snap_pixel_id) {
    scriptSrc.push("https://sc-static.net");
    connectSrc.push("https://tr.snapchat.com");
    imgSrc.push("https://tr.snapchat.com");
  }

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `font-src https://fonts.gstatic.com`,
    `img-src ${imgSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `media-src 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");
}

function securityHeaders(nonce) {
  return {
    "Content-Security-Policy": buildCsp(nonce),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

// HTML pages are the entry point of every visit. Short hard-cache keeps
// fresh content propagating quickly; SWR serves cached copies instantly
// while revalidating in the background.
const HTML_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=604800";

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildJsonLd(episode, baseUrl) {
  const sameAs = [
    config.spotify_url,
    config.apple_podcasts_url,
    config.youtube_url,
    config.amazon_music_url,
    config.x_url,
    config.facebook_url,
    config.instagram_url,
    config.tiktok_url,
    config.linkedin_url,
  ].filter(Boolean);

  const cover = `${baseUrl}${config.cover || "/cover.png"}`;
  const topics = Array.isArray(config.topics) ? config.topics.filter(Boolean) : [];

  // Person block for the host. Used on both homepage (top-level) and as
  // `author` on episodes. Includes optional `host:` block from podcast.yaml.
  const personSameAs = [config.x_url, config.linkedin_url, config.facebook_url, config.instagram_url, config.tiktok_url].filter(Boolean);
  const wikidataId = config.host?.wikidata_id;
  if (wikidataId) personSameAs.unshift(`https://www.wikidata.org/wiki/${wikidataId}`);
  const person = {
    "@type": "Person",
    "@id": `${baseUrl}/#author`,
    name: config.author,
    ...(config.host?.job_title ? { jobTitle: config.host.job_title } : {}),
    ...(config.host?.bio ? { description: config.host.bio } : {}),
    ...(personSameAs.length ? { sameAs: personSameAs } : {}),
  };

  if (!episode) {
    // Homepage: emit a graph of PodcastSeries + WebSite (with SearchAction)
    // + Person, so agents can resolve the host as an entity and find an
    // episode-search action without scraping HTML.
    const series = {
      "@type": "PodcastSeries",
      "@id": `${baseUrl}/#podcast`,
      name: config.title,
      description: config.description,
      url: baseUrl,
      image: cover,
      inLanguage: config.language,
      author: { "@id": `${baseUrl}/#author` },
      webFeed: `${baseUrl}/rss.xml`,
      ...(config.copyright ? { copyrightNotice: config.copyright } : {}),
      ...(config.license ? { license: config.license } : {}),
      ...(topics.length ? { keywords: topics.join(", ") } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: ["h1", "header p"],
      },
    };

    const website = {
      "@type": "WebSite",
      "@id": `${baseUrl}/#website`,
      url: baseUrl,
      name: config.title,
      ...(config.description ? { description: config.description } : {}),
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${baseUrl}/api/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    };

    return {
      "@context": "https://schema.org",
      "@graph": [series, website, person],
    };
  }

  const epTopics = Array.isArray(episode.topics) ? episode.topics.filter(Boolean) : [];
  const epGuests = Array.isArray(episode.guests) ? episode.guests : [];

  const ld = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: episode.title,
    description: episode.desc || "",
    url: `${baseUrl}/${episode.id}`,
    datePublished: episode.date,
    episodeNumber: episode.id,
    inLanguage: config.language,
    author: person,
    partOfSeries: {
      "@type": "PodcastSeries",
      "@id": `${baseUrl}/#podcast`,
      name: config.title,
      url: baseUrl,
    },
    associatedMedia: {
      "@type": "MediaObject",
      contentUrl: `${baseUrl}/${episode.audioFile}`,
      encodingFormat: "audio/mpeg",
    },
    image: `${baseUrl}/s${episode.season}e${episode.id}.${config.cover_ext || "png"}`,
    sameAs: [
      episode.spotifyUrl || null,
      episode.appleUrl || null,
      episode.amazonUrl || null,
    ].filter(Boolean),
  };

  if (episode.seconds) {
    const m = Math.floor(episode.seconds / 60);
    const s = episode.seconds % 60;
    ld.duration = `PT${m}M${s}S`;
  }

  // Transcript as a MediaObject — voice/answer engines that cite podcasts
  // pick this up directly. Gated on hasSrt so agents don't 404.
  if (episode.hasSrt) {
    const txtUrl = `${baseUrl}/${episode.audioFile.replace(".mp3", ".txt")}`;
    ld.transcript = {
      "@type": "MediaObject",
      contentUrl: txtUrl,
      encodingFormat: "text/plain",
      inLanguage: config.language,
    };
  }

  // Topics → schema.org `about` (Thing). Helps "podcast about X" queries.
  if (epTopics.length) {
    ld.about = epTopics.map((t) => ({ "@type": "Thing", name: t }));
    ld.keywords = epTopics.join(", ");
  }

  // Guests → schema.org `actor` (Person). Helps "podcast with <guest>" queries.
  if (epGuests.length) {
    ld.actor = epGuests
      .map((g) =>
        typeof g === "string"
          ? { "@type": "Person", name: g }
          : g.name
            ? { "@type": "Person", name: g.name, ...(g.url ? { url: g.url } : {}) }
            : null
      )
      .filter(Boolean);
  }

  // Chapters → schema.org `hasPart` (Clip with startOffset).
  if (Array.isArray(episode.chapters) && episode.chapters.length) {
    ld.hasPart = episode.chapters
      .map((c) => {
        const title = c.title || c.name;
        if (!title) return null;
        const startStr = c.start || c.time || "";
        let startOffset;
        if (startStr) {
          const parts = startStr.split(":").map(Number);
          if (parts.length === 3) startOffset = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) startOffset = parts[0] * 60 + parts[1];
        }
        return {
          "@type": "Clip",
          name: title,
          ...(Number.isFinite(startOffset) ? { startOffset } : {}),
        };
      })
      .filter(Boolean);
  }

  return ld;
}

function getThemeFromCookie(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)theme=(dark|light)/);
  return match ? match[1] : config.default_theme || "dark";
}

// Process {{#if KEY}}...{{/if}} conditionals in label text against config
function processConditionals(text) {
  return (text || "")
    .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) =>
      config[key] ? content : ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const L = config.labels;

function buildEpisodeHtml(ep) {
  const parts = [`<article>`];
  parts.push(`<h2><a href="/${ep.id}">${esc(ep.title)}</a></h2>`);
  parts.push(`<p>${L.season} ${ep.season} · ${L.episode} ${ep.id}`);
  if (ep.duration) parts.push(` · ${esc(ep.duration)}`);
  if (ep.date) parts.push(` · <time datetime="${ep.date}">${ep.date}</time>`);
  parts.push(`</p>`);
  if (ep.desc) parts.push(`<p>${esc(ep.desc)}</p>`);
  parts.push(`</article>`);
  return parts.join("");
}

// Build SSR content: real HTML visible before JS executes.
// React replaces this on mount.
function buildSsrContent(episode) {
  if (!episode) {
    // Homepage — render all episodes grouped by latest first
    const sorted = [...episodes].sort((a, b) => b.id - a.id);
    const parts = [
      `<header><h1>${esc(config.title)}</h1><p>${esc(config.description)}</p></header>`,
      `<section>`,
    ];
    for (const ep of sorted) {
      parts.push(buildEpisodeHtml(ep));
    }
    parts.push(`</section>`);
    return parts.join("");
  }

  // Episode page — full detail with transcript
  const parts = [`<article>`];
  parts.push(`<h1>${esc(episode.title)}</h1>`);
  parts.push(`<p>${L.season} ${episode.season} · ${L.episode} ${episode.id}`);
  if (episode.duration) parts.push(` · ${esc(episode.duration)}`);
  if (episode.date) parts.push(` · <time datetime="${episode.date}">${episode.date}</time>`);
  parts.push(`</p>`);
  if (episode.desc) parts.push(`<p>${esc(episode.desc)}</p>`);
  if (episode.fullText) {
    parts.push(`<div>`);
    for (const para of episode.fullText.split("\n").filter(Boolean)) {
      parts.push(`<p>${esc(para)}</p>`);
    }
    parts.push(`</div>`);
  }
  parts.push(`<audio src="/${esc(episode.audioFile)}" preload="none"></audio>`);
  parts.push(`</article>`);
  return parts.join("");
}

function buildStaticSsr(title, text) {
  const parts = [`<article>`, `<h1>${esc(title)}</h1>`];
  for (const para of (text || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
    parts.push(`<p>${esc(para)}</p>`);
  }
  parts.push(`</article>`);
  return parts.join("");
}

function getBaseUrl(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

function renderStaticPage(kind, request) {
  const theme = getThemeFromCookie(request);
  const themeColor = theme === "light" ? (config.bg_light || "#fafaf9") : (config.bg_dark || "#0a0a0b");
  const baseUrl = getBaseUrl(request);
  const title = kind === "terms" ? L.terms : L.privacy;
  const rawText = kind === "terms" ? L.terms_text : L.privacy_text;
  const text = processConditionals(rawText);
  const pageTitle = `${title} | ${config.title}`;
  const canonical = `${baseUrl}/${kind}`;
  const desc = esc(title);

  const ogTags = `
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${desc}">
  <meta name="theme-color" content="${themeColor}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="${config.locale}">
  <meta name="robots" content="noindex,follow">`;

  const nonce = crypto.randomUUID();
  const html = template
    .replace("<!--OG_TAGS-->", ogTags)
    .replace("__EP_JSON__", "null")
    .replace("__SEARCH_JSON__", JSON.stringify({ staticPage: kind }))
    .replace("__SSR_CONTENT__", buildStaticSsr(title, text))
    .replace(/<html\b/, `<html data-theme="${theme}"`)
    .replace(/\{\{CSP_NONCE\}\}/g, nonce);

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": HTML_CACHE_CONTROL,
    ...securityHeaders(nonce),
  });
  return new Response(html, { headers });
}

function renderPage(episode, request) {
  const theme = getThemeFromCookie(request);
  const themeColor = theme === "light" ? (config.bg_light || "#fafaf9") : (config.bg_dark || "#0a0a0b");
  const baseUrl = getBaseUrl(request);

  const title = episode
    ? `${L.episode} ${episode.id}: ${esc(episode.title)}`
    : config.title;
  const pageTitle = episode ? `${title} | ${config.title}` : config.title;
  const desc = esc(
    episode?.desc || config.description
  );
  const ogImage = episode
    ? `${baseUrl}/s${episode.season}e${episode.id}.${config.cover_ext || "png"}`
    : `${baseUrl}${config.cover}`;
  // Escape </ sequences to prevent </script> breakout in JSON-LD
  const jsonLd = JSON.stringify(buildJsonLd(episode, baseUrl)).replace(/</g, "\\u003c");

  const canonical = `${baseUrl}/${episode?.id || ""}`;
  const audioUrl = episode ? `${baseUrl}/${episode.audioFile}` : "";

  const ogTags = `
  <title>${pageTitle}</title>
  <meta name="description" content="${desc}">
  <meta name="theme-color" content="${themeColor}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">${audioUrl ? `\n  <meta property="og:audio" content="${audioUrl}">\n  <meta property="og:audio:type" content="audio/mpeg">` : ""}
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="${episode ? "article" : "website"}">
  <meta property="og:locale" content="${config.locale}">${episode?.date ? `\n  <meta property="article:published_time" content="${episode.date}">` : ""}
  <meta name="twitter:card" content="summary_large_image">${config.x_username ? `\n  <meta name="twitter:site" content="@${config.x_username}">` : ""}
  <script type="application/ld+json">${jsonLd}</script>`;

  // Preload episode resources so the browser fetches them in parallel with
  // the JS bundle instead of waiting for React to request them.
  let preloadHints = "";
  if (episode) {
    const txtFile = episode.audioFile.replace(".mp3", ".txt");
    preloadHints += `\n  <link rel="preload" href="/${txtFile}" as="fetch" crossorigin>`;
    if (episode.hasSrt) {
      preloadHints += `\n  <link rel="preload" href="/${episode.srtFile}" as="fetch" crossorigin>`;
    }
  }

  const nonce = crypto.randomUUID();
  const html = template
    .replace("<!--OG_TAGS-->", ogTags)
    .replace("__EP_JSON__", JSON.stringify(episode || null))
    .replace("__SEARCH_JSON__", "null")
    .replace("__SSR_CONTENT__", buildSsrContent(episode))
    .replace(/<html\b/, `<html data-theme="${theme}"`)
    .replace("</head>", `${preloadHints}\n  </head>`)
    .replace(/\{\{CSP_NONCE\}\}/g, nonce);

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": HTML_CACHE_CONTROL,
    ...securityHeaders(nonce),
  });
  return new Response(html, { headers });
}

function redirect301(url) {
  return new Response(null, {
    status: 301,
    headers: { Location: url },
  });
}


async function serveR2(env, key, request) {
  if (!env?.R2_BUCKET) return null;
  const rangeHeader = request.headers.get("Range");
  let options = {};
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1]) : undefined;
      const end = m[2] ? parseInt(m[2]) : undefined;
      options.range = {};
      if (start !== undefined) options.range.offset = start;
      if (end !== undefined && start !== undefined) options.range.length = end - start + 1;
    }
  }
  const obj = await env.R2_BUCKET.get(key, options);
  if (!obj) return null;
  const ext = key.split(".").pop().toLowerCase();
  const headers = new Headers();
  headers.set("Content-Type", CONTENT_TYPES[ext] || obj.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=604800");
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  if (rangeHeader && obj.range) {
    headers.set("Content-Range", `bytes ${obj.range.offset}-${obj.range.offset + obj.range.length - 1}/${obj.size}`);
    headers.set("Content-Length", String(obj.range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// Static files that embed absolute URLs via a `{{SITE_URL}}` placeholder,
// rewritten per-request so the same artifact works on any hostname.
const SITE_URL_REWRITES = new Set([
  "/rss.xml",
  "/sitemap.xml",
  "/llms.txt",
  "/robots.txt",
  "/index.md",
  "/episodes/llms.txt",
  "/.well-known/agent.json",
  "/.well-known/agent-card.json",
  "/.well-known/schema-map.xml",
  "/.well-known/openapi.json",
]);

const REWRITE_CONTENT_TYPES = {
  "/rss.xml": "application/rss+xml; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
  "/llms.txt": "text/plain; charset=utf-8",
  "/robots.txt": "text/plain; charset=utf-8",
  "/index.md": "text/markdown; charset=utf-8",
  "/episodes/llms.txt": "text/plain; charset=utf-8",
  "/.well-known/agent.json": "application/json; charset=utf-8",
  "/.well-known/agent-card.json": "application/json; charset=utf-8",
  "/.well-known/schema-map.xml": "application/xml; charset=utf-8",
  "/.well-known/openapi.json": "application/json; charset=utf-8",
};

const REWRITE_CACHE_CONTROL = {
  "/rss.xml": "public, max-age=300, stale-while-revalidate=604800",
  "/sitemap.xml": "public, max-age=3600, stale-while-revalidate=604800",
  "/llms.txt": "public, max-age=3600, stale-while-revalidate=604800",
  "/index.md": "public, max-age=3600, stale-while-revalidate=604800",
  "/episodes/llms.txt": "public, max-age=3600, stale-while-revalidate=604800",
  "/.well-known/agent.json": "public, max-age=3600, stale-while-revalidate=604800",
  "/.well-known/agent-card.json": "public, max-age=3600, stale-while-revalidate=604800",
  "/.well-known/schema-map.xml": "public, max-age=3600, stale-while-revalidate=604800",
  "/.well-known/openapi.json": "public, max-age=3600, stale-while-revalidate=604800",
};

// Cache rules for static files served through middleware (mirrors _headers)
const STATIC_CACHE_RULES = {
  "/episodes.json": "public, max-age=60, stale-while-revalidate=604800",
  "/search-index.json": "public, max-age=60, stale-while-revalidate=604800",
  "/cover.png": "public, max-age=86400, stale-while-revalidate=604800",
};

const ASSETS_CACHE_CONTROL = "public, max-age=31536000, immutable";

async function rewriteSiteUrl(request, next) {
  const resp = await next();
  const text = await resp.text();
  const baseUrl = getBaseUrl(request);
  const rewritten = text.replace(/\{\{SITE_URL\}\}/g, baseUrl);
  const headers = new Headers(resp.headers);
  const path = new URL(request.url).pathname;
  if (REWRITE_CONTENT_TYPES[path]) headers.set("Content-Type", REWRITE_CONTENT_TYPES[path]);
  if (REWRITE_CACHE_CONTROL[path]) headers.set("Cache-Control", REWRITE_CACHE_CONTROL[path]);
  headers.set("Content-Length", String(new TextEncoder().encode(rewritten).length));
  return new Response(rewritten, { status: resp.status, headers });
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const ua = request.headers.get("user-agent") || "";
  const bot = BOTS.test(ua);

  // Absolute-URL placeholders in generated static files
  if (SITE_URL_REWRITES.has(path)) {
    return rewriteSiteUrl(request, next);
  }

  // Pages Functions (search API, MCP server) handle their own paths.
  // Pass through so file-based routes under functions/ can run.
  if (path === "/mcp" || path.startsWith("/api/")) {
    return next();
  }

  // Static assets: pass through to Pages with cache headers
  if (
    path.match(/\.\w{2,5}$/) ||
    path.startsWith("/assets/")
  ) {
    // Media files → serve from R2
    if (MEDIA_PATTERN.test(path)) {
      const key = path.slice(1); // strip leading /
      const r2Response = await serveR2(env, key, request);
      if (r2Response) return r2Response;
    }
    const resp = await next();
    const cacheControl = path.startsWith("/assets/")
      ? ASSETS_CACHE_CONTROL
      : STATIC_CACHE_RULES[path];
    if (cacheControl) {
      const headers = new Headers(resp.headers);
      headers.set("Cache-Control", cacheControl);
      return new Response(resp.body, { status: resp.status, headers });
    }
    return resp;
  }

  // Old Transistor slugs: /episodes/slug-34-... → 301 to /34
  if (path.startsWith("/episodes/") && config.legacy_slug_pattern) {
    const decoded = decodeURIComponent(path);
    const m = decoded.match(new RegExp(config.legacy_slug_pattern));
    return redirect301(m ? `/${m[1]}` : "/");
  }

  // Old /subscribe → 301 to /
  if (path === "/subscribe") {
    return redirect301("/");
  }

  // Episode: /NN
  const epMatch = path.match(/^\/(\d{1,3})$/);
  if (epMatch) {
    const ep = episodes.find((e) => e.id === parseInt(epMatch[1]));
    if (!ep) return redirect301("/");
    return renderPage(ep, request);
  }

  // Legal pages
  if (path === "/terms" && L.terms && L.terms_text) {
    return renderStaticPage("terms", request);
  }
  if (path === "/privacy" && L.privacy && L.privacy_text) {
    return renderStaticPage("privacy", request);
  }

  // Homepage
  if (path === "/" || path === "") {
    return renderPage(null, request);
  }

  // Catch-all: 301 to home
  return redirect301("/");
}
