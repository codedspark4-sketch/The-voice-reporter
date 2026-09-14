const express = require("express");
const Parser = require("rss-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "The Voice Reporter News Desk/1.0 (+live-news-aggregator)"
  }
});

/*
 * THE VOICE REPORTER
 * Built-in live source registry.
 *
 * There is no user feed-entry page and no API key is required.
 * These feeds are fetched server-side to avoid browser CORS restrictions.
 */
const FEEDS = [
  // ---------------- NIGERIA ----------------
  { name:"PUNCH", region:"Nigeria", category:"Nigeria", url:"https://rss.punchng.com/v1/category/latest_news" },
  { name:"PUNCH Politics", region:"Nigeria", category:"Politics", url:"https://rss.punchng.com/v1/category/politics" },
  { name:"PUNCH Business", region:"Nigeria", category:"Business", url:"https://rss.punchng.com/v1/category/business" },
  { name:"PUNCH Sports", region:"Nigeria", category:"Sports", url:"https://rss.punchng.com/v1/category/sports" },
  { name:"Premium Times", region:"Nigeria", category:"Nigeria", url:"https://www.premiumtimesng.com/feed" },
  { name:"Guardian Nigeria", region:"Nigeria", category:"Nigeria", url:"https://guardian.ng/feed/" },
  { name:"Tribune Online", region:"Nigeria", category:"Nigeria", url:"https://tribuneonlineng.com/feed/" },
  { name:"The Nation Nigeria", region:"Nigeria", category:"Nigeria", url:"https://thenationonlineng.net/feed/" },
  { name:"Daily Post Nigeria", region:"Nigeria", category:"Nigeria", url:"https://dailypost.ng/feed" },
  { name:"Legit.ng", region:"Nigeria", category:"Nigeria", url:"https://www.legit.ng/rss/all.rss" },
  { name:"Sahara Reporters", region:"Nigeria", category:"Nigeria", url:"https://saharareporters.com/articles/rss-feed" },

  // ---------------- WORLD ----------------
  { name:"BBC World", region:"World", category:"World", url:"https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name:"Al Jazeera", region:"World", category:"World", url:"https://www.aljazeera.com/xml/rss/all.xml" },
  { name:"DW World", region:"World", category:"World", url:"https://rss.dw.com/rdf/rss-en-world" },
  { name:"France 24", region:"World", category:"World", url:"https://www.france24.com/en/rss" },
  { name:"The Guardian World", region:"World", category:"World", url:"https://www.theguardian.com/world/rss" },
  { name:"New York Times World", region:"World", category:"World", url:"https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
  { name:"NPR World", region:"World", category:"World", url:"https://feeds.npr.org/1004/rss.xml" },
  { name:"Sky News World", region:"World", category:"World", url:"https://feeds.skynews.com/feeds/rss/world.xml" },
  { name:"NHK Global", region:"World", category:"World", url:"https://www3.nhk.or.jp/rssxml/news/globalnewsroom.xml" },
  { name:"CBC World", region:"World", category:"World", url:"https://www.cbc.ca/webfeed/rss/rss-world" },

  // ---------------- TECHNOLOGY / BUSINESS / SPORTS ----------------
  { name:"TechCrunch", region:"World", category:"Technology", url:"https://techcrunch.com/feed/" },
  { name:"Wired", region:"World", category:"Technology", url:"https://www.wired.com/feed/rss" },
  { name:"Ars Technica", region:"World", category:"Technology", url:"https://feeds.arstechnica.com/arstechnica/index" },
  { name:"CNBC", region:"World", category:"Business", url:"https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" }
];

let cache = {
  updatedAt: 0,
  items: [],
  sources: {}
};

const REFRESH_MS = 60 * 1000;

function decodeHtml(input = "") {
  return String(input)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function itemImage(item) {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;
  if (item.image && item.image.url) return item.image.url;

  const html = item["content:encoded"] || item.content || item.description || "";
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function normalizeTitle(t = "") {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanDescription(item) {
  const value = decodeHtml(item.contentSnippet || item.summary || item.content || item.description || "");
  if (value.length <= 260) return value;
  return value.slice(0, 257).replace(/\s+\S*$/, "") + "…";
}

function inferCategory(feed, item) {
  const text = `${feed.category} ${item.categories || ""} ${item.title || ""}`.toLowerCase();
  if (feed.category !== "Nigeria" && feed.category !== "World") return feed.category;

  if (/sport|football|soccer|tennis|basketball|olympic|cricket|rugby/.test(text)) return "Sports";
  if (/business|econom|market|finance|bank|oil|trade|stock|inflation/.test(text)) return "Business";
  if (/technology|tech|artificial intelligence|ai\b|cyber|software|gadget/.test(text)) return "Technology";
  if (/politic|election|president|senate|governor|minister|government|parliament/.test(text)) return "Politics";
  return feed.category;
}

async function fetchFeed(feed) {
  const result = { ...feed, ok:false, count:0, error:null };
  try {
    const parsed = await parser.parseURL(feed.url);
    const items = (parsed.items || []).map(item => {
      const rawDate = item.isoDate || item.pubDate || item.date || new Date().toISOString();
      const date = new Date(rawDate);
      return {
        title: decodeHtml(item.title || "Untitled"),
        link: item.link || parsed.link || "#",
        description: cleanDescription(item),
        image: itemImage(item),
        source: feed.name,
        region: feed.region,
        category: inferCategory(feed, item),
        publishedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
        id: item.guid || item.id || item.link || `${feed.name}:${item.title}`
      };
    }).filter(x => x.title && x.link !== "#");

    result.ok = true;
    result.count = items.length;
    return { result, items };
  } catch (err) {
    result.error = String(err.message || err);
    return { result, items:[] };
  }
}

async function refreshNews() {
  const settled = await Promise.all(FEEDS.map(fetchFeed));
  const sources = {};
  let all = [];

  for (const batch of settled) {
    sources[batch.result.name] = {
      ok: batch.result.ok,
      count: batch.result.count,
      error: batch.result.error
    };
    all = all.concat(batch.items);
  }

  const seen = new Set();
  all = all
    .sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .filter(item => {
      const key = normalizeTitle(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 300);

  cache = {
    updatedAt: Date.now(),
    items: all,
    sources
  };

  console.log(`[news] ${all.length} unique stories from ${Object.keys(sources).length} built-in sources`);
}

app.get("/api/news", (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "160", 10), 1), 300);
  res.set("Cache-Control", "no-store");
  res.json({
    updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    items: cache.items.slice(0, limit),
    sources: cache.sources
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "THE VOICE REPORTER live news service",
    updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    feeds: FEEDS.length,
    stories: cache.items.length
  });
});

app.use(express.static(path.join(__dirname, "public"), { extensions:["html"] }));

async function boot() {
  await refreshNews();
  setInterval(refreshNews, REFRESH_MS);
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`THE VOICE REPORTER running on 0.0.0.0:${PORT}`);
  });
}

boot().catch(err => {
  console.error(err);
  process.exit(1);
});
