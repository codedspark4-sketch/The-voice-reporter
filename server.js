const express = require("express");
const Parser = require("rss-parser");
const path = require("path");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

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

const ARTICLE_TIMEOUT_MS = 20000;
const ARTICLE_MAX_BYTES = 3 * 1024 * 1024;

function allowedArticleHost(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return FEEDS.some(feed => {
      try { return new URL(feed.url).hostname.toLowerCase() === hostname; }
      catch (_) { return false; }
    });
  } catch (_) {
    return false;
  }
}

function escHtml(input = "") {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeArticleHtml(html, baseUrl) {
  const dom = new JSDOM(`<article id="article-root">${html || ""}</article>`, { url: baseUrl });
  const root = dom.window.document.querySelector("#article-root");
  const blocked = root.querySelectorAll("script,style,noscript,template,iframe,object,embed,form,input,button,textarea,select,canvas");
  blocked.forEach(el => el.remove());

  root.querySelectorAll("*").forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on") || name === "srcdoc" || name === "style") {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });

    if (el.tagName === "A") {
      try {
        const href = new URL(el.getAttribute("href") || "", baseUrl);
        if (!/^https?:$/.test(href.protocol)) el.removeAttribute("href");
        else {
          el.setAttribute("href", href.href);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer nofollow");
        }
      } catch (_) {
        el.removeAttribute("href");
      }
    }

    if (el.tagName === "IMG") {
      try {
        const src = new URL(el.getAttribute("src") || "", baseUrl);
        if (!/^https?:$/.test(src.protocol)) el.remove();
        else {
          el.setAttribute("src", src.href);
          el.setAttribute("loading", "lazy");
          el.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
        }
      } catch (_) {
        el.remove();
      }
    }
  });
  return root.innerHTML;
}

async function fetchArticle(url) {
  if (!allowedArticleHost(url)) {
    const err = new Error("This article source is not enabled in THE VOICE REPORTER.");
    err.code = "SOURCE_NOT_ALLOWED";
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "The Voice Reporter Reader/1.0 (+internal-reader)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) throw new Error(`Publisher returned HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("Publisher did not return an HTML article page.");
    }

    const finalUrl = response.url || url;
    if (!allowedArticleHost(finalUrl)) throw new Error("Publisher redirected to an unsupported source.");

    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    let html = "";

    if (reader) {
      let total = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > ARTICLE_MAX_BYTES) throw new Error("Article page is too large to read safely.");
        chunks.push(Buffer.from(value));
      }
      html = Buffer.concat(chunks).toString("utf8");
    } else {
      html = await response.text();
      if (Buffer.byteLength(html, "utf8") > ARTICLE_MAX_BYTES) throw new Error("Article page is too large to read safely.");
    }

    const dom = new JSDOM(html, { url: finalUrl });
    const parsed = new Readability(dom.window.document).parse();
    if (!parsed || !parsed.content) throw new Error("The article could not be extracted from this publisher page.");

    const cleanContent = safeArticleHtml(parsed.content, finalUrl);
    return {
      title: parsed.title || dom.window.document.title || "News article",
      excerpt: parsed.excerpt || "",
      byline: parsed.byline || "",
      publishedTime: parsed.publishedTime || "",
      siteName: parsed.siteName || new URL(finalUrl).hostname.replace(/^www\./, ""),
      image: parsed.lead_image_url || "",
      content: cleanContent,
      sourceUrl: finalUrl
    };
  } finally {
    clearTimeout(timer);
  }
}

app.get("/article", async (req, res) => {
  const sourceUrl = String(req.query.url || "").trim();
  if (!sourceUrl) return res.status(400).send("Missing article URL.");

  try {
    const article = await fetchArticle(sourceUrl);
    const published = article.publishedTime ? new Date(article.publishedTime) : null;
    const publishedText = published && !Number.isNaN(published.getTime())
      ? published.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })
      : "";

    const heroImage = article.image
      ? `<img class="article-hero" src="${escHtml(article.image)}" alt="" referrerpolicy="no-referrer-when-downgrade">`
      : "";

    res.set("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(article.title)} — THE VOICE REPORTER</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#121a2a;--text:#eef3ff;--muted:#9aa7bd;--accent:#ffcc45;--line:#253149}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0b1020,#0a0f1a);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75}
.wrap{width:min(900px,calc(100% - 32px));margin:0 auto;padding:22px 0 70px}.top{display:flex;align-items:center;gap:12px;margin-bottom:28px}.back{color:var(--accent);text-decoration:none;font-weight:800}.brand{font-weight:900;letter-spacing:.12em;font-size:.86rem;color:#fff}.source{color:var(--muted);font-size:.9rem;margin-top:18px}.title{font-size:clamp(2rem,5vw,4rem);line-height:1.08;letter-spacing:-.035em;margin:8px 0 16px}.dek{font-size:1.16rem;color:#c7d2e6;margin:0 0 22px}.meta{font-size:.9rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px}.article-hero{width:100%;max-height:520px;object-fit:cover;border-radius:18px;margin:8px 0 28px;border:1px solid var(--line)}.article{background:rgba(18,26,42,.78);border:1px solid var(--line);border-radius:20px;padding:clamp(20px,4vw,42px);box-shadow:0 18px 50px rgba(0,0,0,.2)}.article p{font-size:1.08rem;margin:0 0 1.25em}.article h2,.article h3{line-height:1.25;margin-top:1.8em}.article img{max-width:100%;height:auto;border-radius:12px}.article a{color:#ffd76b}.credit{margin-top:28px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}.credit a{color:var(--accent)}
</style></head><body><main class="wrap"><div class="top"><a class="back" href="/">← Back to THE VOICE REPORTER</a><span class="brand">THE VOICE REPORTER</span></div>
<div class="source">${escHtml(article.siteName)}</div><h1 class="title">${escHtml(article.title)}</h1>
${article.excerpt ? `<p class="dek">${escHtml(article.excerpt)}</p>` : ""}
<div class="meta">${article.byline ? `<span>By ${escHtml(article.byline)}</span>` : ""}${publishedText ? `<span>• ${escHtml(publishedText)}</span>` : ""}</div>
${heroImage}<article class="article">${article.content}</article>
<div class="credit">Article content displayed in THE VOICE REPORTER reader view. Original publisher: <a href="${escHtml(article.sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">Read the original article</a>.</div>
</main></body></html>`);
  } catch (err) {
    const message = err.code === "SOURCE_NOT_ALLOWED"
      ? err.message
      : "THE VOICE REPORTER could not extract this article. The publisher may block reader extraction or use a page format we cannot parse.";
    res.status(err.code === "SOURCE_NOT_ALLOWED" ? 403 : 502).type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Article unavailable — THE VOICE REPORTER</title><style>body{background:#0b1020;color:#eef3ff;font-family:system-ui;padding:32px;line-height:1.6}main{max-width:760px;margin:auto}a{color:#ffcc45}</style></head><body><main><p><a href="/">← Back to THE VOICE REPORTER</a></p><h1>Article unavailable</h1><p>${escHtml(message)}</p><p><a href="${escHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">Open the original publisher</a></p></main></body></html>`);
  }
});

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


function isAllowedArticleUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

async function fetchArticle(url) {
  if (!isAllowedArticleUrl(url)) throw new Error("Invalid article URL");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; The Voice Reporter Reader/1.0)"
    },
    redirect: "follow"
  });

  if (!response.ok) throw new Error(`Publisher returned ${response.status}`);
  const html = await response.text();

  const dom = new JSDOM(html, { url: response.url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.textContent.trim().length < 80) {
    throw new Error("Could not extract a readable article");
  }

  return {
    title: article.title || "",
    byline: article.byline || "",
    excerpt: article.excerpt || "",
    content: article.content || "",
    siteName: article.siteName || new URL(response.url).hostname,
    publishedTime: article.publishedTime || "",
    url: response.url
  };
}

app.get("/api/article", async (req, res) => {
  const url = String(req.query.url || "").trim();

  try {
    const article = await fetchArticle(url);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, article });
  } catch (err) {
    console.error("[article]", err.message || err);
    res.status(502).json({
      ok: false,
      error: "This article could not be read automatically. You can open the original publisher instead."
    });
  }
});

app.get("/article", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "article.html"));
});

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
