// GET /api/search?q=<query>&limit=<1..50>
// Lightweight server-side search over title + description + transcript.
// Use this from agents that don't want to download search-index.json.

import { searchEpisodes } from "../_search.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10)));

  if (!q) {
    return Response.json(
      { error: "missing required query parameter: q" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  const t0 = Date.now();
  const baseUrl = `${url.protocol}//${url.host}`;
  const results = searchEpisodes(q, { limit, baseUrl });
  const took_ms = Date.now() - t0;

  return Response.json(
    { query: q, count: results.length, took_ms, results },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
