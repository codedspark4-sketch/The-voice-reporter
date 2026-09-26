const express = require('express');
const Parser = require('rss-parser');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_URL = process.env.PROXY_URL || 'https://studentnija-proxy-v2.donchester111.workers.dev';

const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'The Voice Reporter News Desk/4.0' }
});

app.set('trust proxy', 1);

// ─── CORS ───
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = FRONTEND_ORIGINS.length ? FRONTEND_ORIGINS.includes(origin) : !!origin;
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ─── Feeds ───
const BUILTIN_FEEDS = [
  ['PUNCH', 'Nigeria', 'Nigeria', 'https://rss.punchng.com/v1/category/latest_news'],
  ['PUNCH Politics', 'Nigeria', 'Politics', 'https://rss.punchng.com/v1/category/politics'],
  ['PUNCH Business', 'Nigeria', 'Business', 'https://rss.punchng.com/v1/category/business'],
  ['PUNCH Sports', 'Nigeria', 'Sports', 'https://rss.punchng.com/v1/category/sports'],
  ['Premium Times', 'Nigeria', 'Nigeria', 'https://www.premiumtimesng.com/feed'],
  ['Guardian Nigeria', 'Nigeria', 'Nigeria', 'https://guardian.ng/feed/'],
  ['Tribune Online', 'Nigeria', 'Nigeria', 'https://tribuneonlineng.com/feed/'],
  ['The Nation Nigeria', 'Nigeria', 'Nigeria', 'https://thenationonlineng.net/feed/'],
  ['Daily Post Nigeria', 'Nigeria', 'Nigeria', 'https://dailypost.ng/feed'],
  ['Legit.ng', 'Nigeria', 'Nigeria', 'https://www.legit.ng/rss/all.rss'],
  ['Sahara Reporters', 'Nigeria', 'Nigeria', 'https://saharareporters.com/articles/rss-feed'],
  ['BBC World', 'World', 'World', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['Al Jazeera', 'World', 'World', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['DW World', 'World', 'World', 'https://rss.dw.com/rdf/rss-en-world'],
  ['France 24', 'World', 'World', 'https://www.france24.com/en/rss'],
  ['The Guardian World', 'World', 'World', 'https://www.theguardian.com/world/rss'],
  ['New York Times World', 'World', 'World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
  ['NPR World', 'World', 'World', 'https://feeds.npr.org/1004/rss.xml'],
  ['Sky News World', 'World', 'World', 'https://feeds.skynews.com/feeds/rss/world.xml'],
  ['NHK Global', 'World', 'World', 'https://www3.nhk.or.jp/rssxml/news/globalnewsroom.xml'],
  ['CBC World', 'World', 'World', 'https://www.cbc.ca/webfeed/rss/rss-world'],
  ['TechCrunch', 'World', 'Technology', 'https://techcrunch.com/feed/'],
  ['Wired', 'World', 'Technology', 'https://www.wired.com/feed/rss'],
  ['Ars Technica', 'World', 'Technology', 'https://feeds.arstechnica.com/arstechnica/index'],
  ['CNBC', 'World', 'Business', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114']
].map(([name, region, category, url]) => ({ name, region, category, url, enabled: true, builtin: true }));

const REMOTE_FALLBACKS = {
  Nigeria: '/ngc.png',
  Politics: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1600&q=82',
  Business: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=82',
  Technology: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=82',
  Sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1600&q=82',
  World: 'https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1600&q=82',
  Africa: 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1600&q=82',
  Entertainment: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=82',
  Science: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1600&q=82',
  News: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1600&q=82'
};

const ALLOWED_EMOJIS = ['🔥','❤️','😮','😢','👏'];

const DEFAULT_SETTINGS = {
  site: {
    title: 'THE VOICE REPORTER',
    tagline: 'REAL NEWS • NIGERIA • AFRICA • WORLD',
    tickerEnabled: true,
    tickerSpeed: 72,
    autoRefreshSeconds: 20
  },
  sections: {
    latest: true, nigeria: true, politics: true, business: true,
    technology: true, sports: true, world: true, mostReported: true,
    aiDesk: true, brief: true
  },
  ai: {
    enabled: true, chat: true, think: true, expert: true, vision: true, search: true,
    prompts: {
      brief: 'Create a concise newsroom brief from the supplied article. Give the facts, why it matters, what is known, and what remains uncertain.',
      analysis: 'Provide a deep, precise news analysis. Separate verified facts from interpretation and do not invent details.',
      ask: 'Answer the reader using only the supplied story context unless fresh research is explicitly requested. Be clear and factual.',
      desk: 'Act as the AI News Desk for THE VOICE REPORTER. Prioritize current, verifiable developments and clearly label uncertainty.'
    }
  },
  tts: { enabled: true, rate: 1, pitch: 1, volume: 1 },
  publishing: { writersNeedApproval: true, allowWriterEditPublished: false, commentsEnabled: true },
  theme: { default: 'system', accent: '#be1212' },
  fallbacks: { ...REMOTE_FALLBACKS }
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function now() { return new Date().toISOString(); }
function uid(p = 'id') { return `${p}_${crypto.randomUUID().replace(/-/g, '')}`; }
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${h}`;
}
function verifyPassword(pw, enc) {
  try {
    const [salt, hash] = String(enc).split(':');
    const got = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function safeText(v, max = 120000) { return String(v ?? '').slice(0, max).trim(); }
function slugify(v) { return safeText(v, 180).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function decodeHtml(input = '') {
  return String(input).replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}
function normalizeTitle(v = '') { return String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// ─── Store ───
function freshStore() {
  return {
    version: 4,
    settings: clone(DEFAULT_SETTINGS),
    sources: { custom: [], overrides: {} },
    stories: [],
    writers: [],
    admin: { username: 'admin', passwordHash: hashPassword(process.env.ADMIN_PASSWORD || '463946') },
    audit: [],
    updatedAt: now()
  };
}
function normalizeStore(s) {
  const base = freshStore();
  const incoming = s && typeof s === 'object' ? s : {};
  return {
    ...base, ...incoming,
    settings: {
      ...base.settings, ...(incoming.settings || {}),
      site: { ...base.settings.site, ...(incoming.settings?.site || {}) },
      sections: { ...base.settings.sections, ...(incoming.settings?.sections || {}) },
      ai: { ...base.settings.ai, ...(incoming.settings?.ai || {}), prompts: { ...base.settings.ai.prompts, ...(incoming.settings?.ai?.prompts || {}) } },
      tts: { ...base.settings.tts, ...(incoming.settings?.tts || {}) },
      publishing: { ...base.settings.publishing, ...(incoming.settings?.publishing || {}) },
      theme: { ...base.settings.theme, ...(incoming.settings?.theme || {}) },
      fallbacks: { ...base.settings.fallbacks, ...(incoming.settings?.fallbacks || {}) }
    },
    sources: { custom: incoming.sources?.custom || [], overrides: incoming.sources?.overrides || {} },
    stories: Array.isArray(incoming.stories) ? incoming.stories.slice(0, 400) : [],
    writers: Array.isArray(incoming.writers) ? incoming.writers : [],
    admin: { ...base.admin, ...(incoming.admin || {}) },
    audit: Array.isArray(incoming.audit) ? incoming.audit.slice(0, 80) : []
  };
}

let store = freshStore();
let saveTimer = null;
let saveInFlight = null;

async function loadStoreFromSupabase() {
  const { data, error } = await supabase.from('store').select('data').eq('id', 'main').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeStore(data.data);
}

async function saveStoreNow() {
  store.updatedAt = now();
  if (store.stories.length > 400) store.stories.length = 400;
  if (store.audit.length > 80) store.audit.length = 80;
  const payload = { id: 'main', data: store, updated_at: now() };
  const { error } = await supabase.from('store').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (saveInFlight) return;
    saveInFlight = saveStoreNow()
      .catch(e => console.error('[store save]', e.message))
      .finally(() => { saveInFlight = null; });
  }, 800);
}

// ─── Sessions ───
const sessions = new Map();
function issueSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...user, expires: Date.now() + 1000 * 60 * 60 * 12 });
  return token;
}
function pruneSessions() {
  const t = Date.now();
  let removed = 0;
  for (const [token, s] of sessions) {
    if (s.expires < t) { sessions.delete(token); removed++; }
  }
  if (removed) console.log(`[sessions] cleaned ${removed}`);
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function auth(req) {
  const token = readCookie(req, 'tvr_session');
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}
function requireRole(...roles) {
  return (req, res, next) => {
    const u = auth(req);
    if (!u || !roles.includes(u.role)) return res.status(401).json({ ok: false, error: 'Authentication required' });
    req.user = u;
    next();
  };
}
function setSession(res, token) {
  const cross = FRONTEND_ORIGINS.length > 0;
  const sameSite = cross ? 'None' : 'Lax';
  const secure = (cross || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `tvr_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=43200`);
}
function clearSession(res) {
  const cross = FRONTEND_ORIGINS.length > 0;
  const sameSite = cross ? 'None' : 'Lax';
  const secure = (cross || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `tvr_session=; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=0`);
}
function audit(action, req, meta = {}) {
  store.audit.unshift({
    id: uid('audit'), action, at: now(),
    actor: { id: req?.user?.id || 'system', username: req?.user?.username || 'system', role: req?.user?.role || 'system' },
    ip: req?.ip || '',
    meta
  });
  if (store.audit.length > 80) store.audit.length = 80;
  saveStore();
}

// ─── Feed helpers ───
function categoryFallback(category) {
  const key = Object.keys(store.settings.fallbacks || {}).find(k => k.toLowerCase() === String(category || 'News').toLowerCase()) || 'News';
  return store.settings.fallbacks?.[key] || REMOTE_FALLBACKS.News;
}
function getFeeds() {
  const map = new Map(BUILTIN_FEEDS.map(f => [f.name, { ...f }]));
  for (const c of store.sources.custom) map.set(c.name, { ...c, builtin: false });
  for (const [name, patch] of Object.entries(store.sources.overrides || {})) if (map.has(name)) map.set(name, { ...map.get(name), ...patch });
  return [...map.values()].filter(f => f.enabled !== false);
}
function itemVideo(item) {
  if (item.enclosure?.url && /^video\//i.test(item.enclosure.type || '')) return item.enclosure.url;
  const media = item['media:content'] || item['media:group']?.['media:content'];
  const arr = Array.isArray(media) ? media : [media];
  const v = arr.find(x => x?.url && /^video\//i.test(x.type || ''));
  if (v?.url) return v.url;
  const html = item['content:encoded'] || item.content || '';
  const m = String(html).match(/<(?:video|source)[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function itemImage(item) {
  if (item.enclosure?.url && !/^video\//i.test(item.enclosure.type || '')) return item.enclosure.url;
  if (item.image?.url) return item.image.url;
  const html = item['content:encoded'] || item.content || item.description || '';
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function cleanDescription(item) {
  const v = decodeHtml(item.contentSnippet || item.summary || item.content || item.description || '');
  return v.length <= 300 ? v : v.slice(0, 297).replace(/\s+\S*$/, '') + '…';
}
function inferCategory(feed, item) {
  const text = `${feed.category} ${item.categories || ''} ${item.title || ''}`.toLowerCase();
  if (!['Nigeria', 'World'].includes(feed.category)) return feed.category;
  if (/sport|football|soccer|tennis|basketball|olympic|cricket|rugby/.test(text)) return 'Sports';
  if (/business|econom|market|finance|bank|oil|trade|stock|inflation/.test(text)) return 'Business';
  if (/technology|tech|artificial intelligence|ai\b|cyber|software|gadget/.test(text)) return 'Technology';
  if (/politic|election|president|senate|governor|minister|government|parliament/.test(text)) return 'Politics';
  return feed.category;
}
async function fetchFeed(feed) {
  const out = { feed, ok: false, error: null, count: 0, items: [] };
  try {
    const parsed = await parser.parseURL(feed.url);
    out.items = (parsed.items || []).map(item => {
      const date = new Date(item.isoDate || item.pubDate || Date.now());
      const category = inferCategory(feed, item);
      const original = itemImage(item);
      const image = original || categoryFallback(category);
      return {
        id: String(item.guid || item.id || item.link || `${feed.name}:${item.title}`),
        title: decodeHtml(item.title || 'Untitled'),
        link: item.link || '#',
        description: cleanDescription(item),
        image,
        fallbackImage: categoryFallback(category),
        imageIsFallback: !original,
        video: itemVideo(item),
        source: feed.name,
        region: feed.region,
        category,
        publishedAt: Number.isNaN(date.getTime()) ? now() : date.toISOString(),
        editorial: false, isBreaking: false, isDeveloping: false, isUpdated: false, featured: false
      };
    }).filter(x => x.title && x.link !== '#');
    out.count = out.items.length;
    out.ok = true;
  } catch (e) { out.error = e.message || String(e); }
  return out;
}
function publicStories() {
  return store.stories.filter(s =>
    s.status === 'published' ||
    (s.status === 'scheduled' && s.scheduledAt && new Date(s.scheduledAt) <= new Date())
  ).map(s => ({
    id: s.id, title: s.title, subheadline: s.subheadline,
    description: s.subheadline || decodeHtml(s.body).slice(0, 300),
    body: s.body,
    image: s.image || categoryFallback(s.category),
    fallbackImage: categoryFallback(s.category),
    imageIsFallback: !s.image,
    video: s.video || '',
    source: 'THE VOICE REPORTER',
    sourceAttribution: s.sourceAttribution || '',
    author: s.author, region: s.region, category: s.category,
    publishedAt: s.publishedAt || s.updatedAt || s.createdAt,
    updatedAt: s.updatedAt,
    editorial: true, status: s.status,
    isBreaking: !!s.isBreaking, isDeveloping: !!s.isDeveloping,
    isUpdated: !!s.isUpdated, featured: !!s.featured,
    tags: s.tags || [], slug: s.slug
  }));
}

let cache = { updatedAt: 0, items: [], sources: {} };
let refreshing = false;

async function refreshNews() {
  if (refreshing) {
    console.log('[refresh] skipped — already running');
    return cache;
  }
  refreshing = true;
  try {
    const feeds = getFeeds();
    const batches = await Promise.all(feeds.map(fetchFeed));
    const sources = {};
    let rss = [];
    batches.forEach((b, i) => {
      const f = feeds[i];
      sources[f.name] = { ok: b.ok, count: b.count, error: b.error, url: f.url, category: f.category, region: f.region, builtin: !!f.builtin };
      rss = rss.concat(b.items);
    });
    const combined = rss.concat(publicStories());
    combined.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const seen = new Set();
    const items = combined.filter(item => {
      const k = normalizeTitle(item.title);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 200);
    cache = { updatedAt: Date.now(), items, sources };
    rss = null;
    return cache;
  } finally {
    refreshing = false;
  }
}

function sanitizeStoryInput(body) {
  const title = safeText(body.title, 220);
  return {
    id: body.id || uid('story'),
    title,
    subheadline: safeText(body.subheadline, 600),
    body: safeText(body.body, 80000),
    category: safeText(body.category || 'Nigeria', 60),
    region: safeText(body.region || 'Nigeria', 60),
    tags: Array.isArray(body.tags)
      ? body.tags.map(x => safeText(x, 40)).filter(Boolean).slice(0, 20)
      : safeText(body.tags || '', 500).split(',').map(x => x.trim()).filter(Boolean),
    image: safeText(body.image, 2000000),
    imageCaption: safeText(body.imageCaption, 400),
    video: safeText(body.video, 2000000),
    videoCaption: safeText(body.videoCaption, 400),
    author: safeText(body.author, 140),
    slug: slugify(body.slug || title),
    seoTitle: safeText(body.seoTitle, 180),
    seoDescription: safeText(body.seoDescription, 320),
    status: ['draft', 'submitted', 'published', 'rejected', 'scheduled'].includes(body.status) ? body.status : 'draft',
    scheduledAt: body.scheduledAt || null,
    isBreaking: !!body.isBreaking,
    isDeveloping: !!body.isDeveloping,
    isUpdated: !!body.isUpdated,
    featured: !!body.featured,
    sourceAttribution: safeText(body.sourceAttribution, 600)
  };
}
function canEditStory(user, story) {
  return user.role === 'admin' || user.role === 'editor' || story.authorId === user.id;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//i.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Only image and video files are allowed.'));
  }
});

async function proxyJson(endpoint, payload) {
  const r = await fetch(`${PROXY_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = { success: false, error: text || `Proxy ${r.status}` }; }
  if (!r.ok) throw new Error(data.error || `AI proxy returned ${r.status}`);
  return data;
}

function newsCardItem(item) {
  return {
    id: item.id, title: item.title,
    subheadline: item.subheadline || '',
    description: item.description || '',
    link: item.link || '',
    image: item.image || categoryFallback(item.category),
    fallbackImage: item.fallbackImage || categoryFallback(item.category),
    imageIsFallback: !!item.imageIsFallback,
    video: item.video || '',
    source: item.source || 'THE VOICE REPORTER',
    sourceAttribution: item.sourceAttribution || '',
    author: item.author || '', region: item.region || '',
    category: item.category || 'News',
    publishedAt: item.publishedAt || item.updatedAt || now(),
    updatedAt: item.updatedAt || '',
    editorial: !!item.editorial,
    status: item.status || 'published',
    isBreaking: !!item.isBreaking, isDeveloping: !!item.isDeveloping,
    isUpdated: !!item.isUpdated, featured: !!item.featured,
    slug: item.slug || ''
  };
}
function publicNewsPayload(limit = 180) {
  const safeLimit = Math.min(Math.max(Number(limit) || 180, 1), 300);
  return {
    ok: true,
    updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    items: cache.items.slice(0, safeLimit).map(newsCardItem),
    sources: cache.sources || {}
  };
}

// ═══════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════

app.get('/', (_req, res) => res.json({
  ok: true,
  service: 'THE VOICE REPORTER API',
  version: 4,
  storage: 'supabase',
  health: '/api/health'
}));

app.get('/api/config', (_req, res) => res.json({ ok: true, settings: store.settings }));
app.get('/api/news', (req, res) => res.json(publicNewsPayload(req.query.limit)));
app.get('/api/news-lite', (req, res) => res.json(publicNewsPayload(req.query.limit)));

app.post('/api/refresh', async (_req, res) => {
  try {
    const c = await refreshNews();
    res.json({ ok: true, updatedAt: new Date(c.updatedAt).toISOString(), stories: c.items.length, sources: c.sources });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/health', async (_req, res) => {
  let proxyReachable = false;
  try { const r = await fetch(`${PROXY_URL}/health`); proxyReachable = r.ok; } catch {}

  let supabaseOk = false, supabaseError = null;
  try {
    const { error } = await supabase.from('store').select('id').eq('id', 'main').maybeSingle();
    if (error) throw error;
    supabaseOk = true;
  } catch (e) { supabaseError = e.message; }

  let articleCacheSize = null;
  try {
    const { count } = await supabase.from('articles').select('*', { count: 'exact', head: true });
    articleCacheSize = count || 0;
  } catch {}

  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: 'THE VOICE REPORTER',
    version: 4,
    serverTime: now(),
    newsUpdatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    feeds: getFeeds().length,
    feedStories: cache.items.length,
    publishedStories: store.stories.filter(s => s.status === 'published').length,
    writers: store.writers.length,
    sessions: sessions.size,
    articleCache: articleCacheSize,
    proxy: { url: PROXY_URL, reachable: proxyReachable },
    supabase: { ok: supabaseOk, error: supabaseError, bucket: SUPABASE_BUCKET },
    cors: { allowedOrigins: FRONTEND_ORIGINS.length ? FRONTEND_ORIGINS : ['(any)'] },
    storage: 'supabase',
    parser: 'linkedom',
    emojis: ALLOWED_EMOJIS,
    memory: {
      rssMb: +(mem.rss / 1048576).toFixed(1),
      heapUsedMb: +(mem.heapUsed / 1048576).toFixed(1),
      heapTotalMb: +(mem.heapTotal / 1048576).toFixed(1),
      externalMb: +(mem.external / 1048576).toFixed(1)
    }
  });
});

// ═══════════════════════════════════════════
// ARTICLE CACHE — Supabase
// ═══════════════════════════════════════════

function normalizeArticleUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ref','mc_cid','mc_eid','_ga','_gl']
      .forEach(k => u.searchParams.delete(k));
    let s = u.toString();
    s = s.replace(/\/$/, '');
    return s;
  } catch { return String(url).trim(); }
}

function articleHash(url) {
  return crypto.createHash('sha256').update(normalizeArticleUrl(url)).digest('hex');
}

function articleToResponse(a) {
  return {
    title: a.title || '',
    byline: a.byline || '',
    excerpt: a.excerpt || '',
    content: a.content || '',
    siteName: a.site_name || '',
    publishedTime: a.published_time || '',
    url: a.url || ''
  };
}

async function getCachedArticle(url) {
  try {
    const hash = articleHash(url);
    const { data, error } = await supabase.from('articles')
      .select('*').eq('url_hash', hash).maybeSingle();
    if (error || !data) return null;
    const age = Date.now() - new Date(data.fetched_at).getTime();
    const stale = age > 7 * 24 * 60 * 60 * 1000;
    return { ...data, stale };
  } catch { return null; }
}

async function putCachedArticle(url, article) {
  try {
    const content = String(article.content || '');
    if (content.length > 250000) return;
    const hash = articleHash(url);
    await supabase.from('articles').upsert({
      url_hash: hash,
      url: normalizeArticleUrl(url),
      title: String(article.title || '').slice(0, 500),
      byline: String(article.byline || '').slice(0, 200),
      excerpt: String(article.excerpt || '').slice(0, 1000),
      content: content,
      site_name: String(article.siteName || '').slice(0, 200),
      published_time: String(article.publishedTime || '').slice(0, 100),
      fetched_at: new Date().toISOString()
    }, { onConflict: 'url_hash' });
  } catch (e) { console.warn('[article cache write]', e.message); }
}

// ═══════════════════════════════════════════
// EXTERNAL ARTICLE READER
// ═══════════════════════════════════════════

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))) return true;
  return false;
}

let parsing = false;
const parseQueue = [];
async function withParseLock(fn) {
  return new Promise((resolve, reject) => {
    parseQueue.push({ fn, resolve, reject });
    if (parseQueue.length > 20) {
      const dropped = parseQueue.shift();
      dropped.reject(new Error('Too many articles queued. Try again in a moment.'));
    }
    processQueue();
  });
}
async function processQueue() {
  if (parsing || !parseQueue.length) return;
  parsing = true;
  const { fn, resolve, reject } = parseQueue.shift();
  try { resolve(await fn()); }
  catch (e) { reject(e); }
  finally {
    parsing = false;
    setImmediate(processQueue);
  }
}

async function fetchExternalArticle(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid article URL');
  if (isPrivateHost(u.hostname)) throw new Error('This host is not allowed');
  const r = await fetch(u.href, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; The Voice Reporter Reader/4.0)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Publisher returned ${r.status}`);
  const html = await r.text();

  const { document } = parseHTML(html);
  try {
    document.baseURI = r.url;
    document.documentURI = r.url;
  } catch (_) {}

  const article = new Readability(document).parse();
  if (!article || !article.textContent || article.textContent.trim().length < 80) {
    throw new Error('Could not extract a readable article');
  }
  const out = {
    title: article.title || '',
    byline: article.byline || '',
    excerpt: article.excerpt || '',
    content: article.content || '',
    siteName: article.siteName || new URL(r.url).hostname,
    publishedTime: article.publishedTime || '',
    url: r.url
  };
  try { document.defaultView = null; } catch (_) {}
  return out;
}

app.get('/api/article', async (req, res) => {
  const url = safeText(req.query.url, 4000);
  if (!url) return res.status(400).json({ ok: false, error: 'Article URL is required.' });

  const cached = await getCachedArticle(url);

  if (cached && !cached.stale) {
    return res.json({ ok: true, article: articleToResponse(cached), cached: true });
  }

  try {
    const article = await withParseLock(() => fetchExternalArticle(url));
    putCachedArticle(url, article).catch(() => {});
    res.json({ ok: true, article, cached: false });
  } catch (e) {
    if (cached) {
      return res.json({ ok: true, article: articleToResponse(cached), cached: true, stale: true });
    }
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/story/:id', (req, res) => {
  const s = publicStories().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Story not found' });
  res.json({ ok: true, story: s });
});

// ═══════════════════════════════════════════
// ENGAGEMENT (likes + reactions + comments)
// ═══════════════════════════════════════════

let engagementCache = { at: 0, likes: {}, comments: {}, reactions: {} };

app.get('/api/engagement-summary', async (_req, res) => {
  try {
    if (Date.now() - engagementCache.at < 30000) {
      return res.json({
        ok: true,
        likes: engagementCache.likes || {},
        comments: engagementCache.comments || {},
        reactions: engagementCache.reactions || {}
      });
    }
    const [
      { data: likeRows },
      { data: commentRows },
      { data: reactionRows }
    ] = await Promise.all([
      supabase.from('likes').select('story_id'),
      supabase.from('comments').select('story_id').eq('status', 'approved'),
      supabase.from('reactions').select('story_id')
    ]);
    const likes = {};
    const comments = {};
    const reactions = {};
    for (const r of likeRows || []) likes[r.story_id] = (likes[r.story_id] || 0) + 1;
    for (const r of commentRows || []) comments[r.story_id] = (comments[r.story_id] || 0) + 1;
    for (const r of reactionRows || []) reactions[r.story_id] = (reactions[r.story_id] || 0) + 1;
    engagementCache = { at: Date.now(), likes, comments, reactions };
    res.json({ ok: true, likes, comments, reactions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/engagement/:storyId', async (req, res) => {
  try {
    const storyId = safeText(decodeURIComponent(req.params.storyId), 500);
    const visitorId = safeText(req.query.visitor || '', 80);
    const sort = req.query.sort === 'new' ? 'new' : 'top';
    if (!storyId) return res.status(400).json({ ok: false, error: 'Story ID required' });

    const [likeCountRes, likedRes, commentRowsRes, reactionsRes] = await Promise.all([
      supabase.from('likes').select('*', { count: 'exact', head: true }).eq('story_id', storyId),
      visitorId
        ? supabase.from('likes').select('id').eq('story_id', storyId).eq('visitor_id', visitorId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('comments')
        .select('id, name, body, visitor_id, parent_id, reply_to_name, created_at')
        .eq('story_id', storyId).eq('status', 'approved')
        .order('created_at', { ascending: true })
        .limit(300),
      supabase.from('reactions').select('emoji, visitor_id').eq('story_id', storyId)
    ]);

    // ─── Reactions aggregation ───
    const reactionCounts = {};
    let myReaction = null;
    for (const r of reactionsRes.data || []) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
      if (visitorId && r.visitor_id === visitorId) myReaction = r.emoji;
    }

    // ─── Comments aggregation ───
    const rows = commentRowsRes.data || [];
    const commentIds = rows.map(c => c.id);

    let allLikes = [];
    if (commentIds.length) {
      const { data } = await supabase.from('comment_likes')
        .select('comment_id, visitor_id')
        .in('comment_id', commentIds);
      allLikes = data || [];
    }

    const likeCounts = {};
    const likedSet = new Set();
    for (const l of allLikes) {
      likeCounts[l.comment_id] = (likeCounts[l.comment_id] || 0) + 1;
      if (visitorId && l.visitor_id === visitorId) likedSet.add(l.comment_id);
    }

    const byId = {};
    const topLevel = [];
    for (const c of rows) {
      byId[c.id] = {
        id: c.id,
        name: c.name || 'Anonymous',
        body: c.body,
        at: c.created_at,
        replyToName: c.reply_to_name || null,
        likes: likeCounts[c.id] || 0,
        liked: likedSet.has(c.id),
        isMine: visitorId ? c.visitor_id === visitorId : false,
        parentId: c.parent_id || null,
        replies: []
      };
    }
    for (const c of rows) {
      if (c.parent_id && byId[c.parent_id]) {
        byId[c.parent_id].replies.push(byId[c.id]);
      } else {
        topLevel.push(byId[c.id]);
      }
    }

    if (sort === 'top') {
      topLevel.sort((a, b) => {
        const lb = b.likes - a.likes;
        if (lb !== 0) return lb;
        const rb = b.replies.length - a.replies.length;
        if (rb !== 0) return rb;
        return new Date(b.at) - new Date(a.at);
      });
    } else {
      topLevel.sort((a, b) => new Date(b.at) - new Date(a.at));
    }

    for (const t of topLevel) {
      t.replies.sort((a, b) => new Date(a.at) - new Date(b.at));
    }

    res.json({
      ok: true,
      likes: likeCountRes.count || 0,
      liked: !!likedRes.data,
      comments: topLevel,
      total: rows.length,
      reactions: reactionCounts,
      myReaction,
      reactionTotal: (reactionsRes.data || []).length,
      emojis: ALLOWED_EMOJIS
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Story like ───
app.post('/api/like', async (req, res) => {
  try {
    const storyId = safeText(req.body?.storyId, 500);
    const visitorId = safeText(req.body?.visitorId, 80);
    if (!storyId || !visitorId) return res.status(400).json({ ok: false, error: 'Missing story or visitor' });

    const { data: existing } = await supabase.from('likes')
      .select('id').eq('story_id', storyId).eq('visitor_id', visitorId).maybeSingle();

    if (existing) {
      await supabase.from('likes').delete().eq('id', existing.id);
    } else {
      const { error } = await supabase.from('likes').insert({ story_id: storyId, visitor_id: visitorId });
      if (error) throw new Error(error.message);
    }

    engagementCache.at = 0;
    const { count } = await supabase.from('likes')
      .select('*', { count: 'exact', head: true }).eq('story_id', storyId);

    res.json({ ok: true, liked: !existing, likes: count || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Reaction (multi-emoji) ───
app.post('/api/react', async (req, res) => {
  try {
    const storyId = safeText(req.body?.storyId, 500);
    const visitorId = safeText(req.body?.visitorId, 80);
    const emoji = safeText(req.body?.emoji, 8);

    if (!storyId || !visitorId) return res.status(400).json({ ok: false, error: 'Missing story or visitor' });
    if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ ok: false, error: 'Invalid emoji' });

    const { data: existing } = await supabase.from('reactions')
      .select('id, emoji').eq('story_id', storyId).eq('visitor_id', visitorId).maybeSingle();

    let action = 'created';
    if (existing && existing.emoji === emoji) {
      await supabase.from('reactions').delete().eq('id', existing.id);
      action = 'removed';
    } else if (existing) {
      const { error } = await supabase.from('reactions').update({ emoji }).eq('id', existing.id);
      if (error) throw new Error(error.message);
      action = 'changed';
    } else {
      const { error } = await supabase.from('reactions')
        .insert({ story_id: storyId, visitor_id: visitorId, emoji });
      if (error) throw new Error(error.message);
    }

    engagementCache.at = 0;

    const { data: rows } = await supabase.from('reactions')
      .select('emoji, visitor_id').eq('story_id', storyId);

    const counts = {};
    let mine = null;
    let total = 0;
    for (const r of rows || []) {
      counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      total += 1;
      if (r.visitor_id === visitorId) mine = r.emoji;
    }

    res.json({ ok: true, action, reactions: counts, mine, total, emojis: ALLOWED_EMOJIS });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Comment like ───
app.post('/api/comment-like', async (req, res) => {
  try {
    const commentId = safeText(req.body?.commentId, 100);
    const visitorId = safeText(req.body?.visitorId, 80);
    if (!commentId || !visitorId)
      return res.status(400).json({ ok: false, error: 'Missing comment or visitor' });

    const { data: existing } = await supabase.from('comment_likes')
      .select('id').eq('comment_id', commentId).eq('visitor_id', visitorId).maybeSingle();

    if (existing) {
      await supabase.from('comment_likes').delete().eq('id', existing.id);
    } else {
      const { error } = await supabase.from('comment_likes')
        .insert({ comment_id: commentId, visitor_id: visitorId });
      if (error) throw new Error(error.message);
    }

    const { count } = await supabase.from('comment_likes')
      .select('*', { count: 'exact', head: true }).eq('comment_id', commentId);

    res.json({ ok: true, liked: !existing, likes: count || 0 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Comment + reply ───
app.post('/api/comment', async (req, res) => {
  try {
    const storyId = safeText(req.body?.storyId, 500);
    const name = safeText(req.body?.name || 'Anonymous', 60) || 'Anonymous';
    const body = safeText(req.body?.body, 2000);
    const visitorId = safeText(req.body?.visitorId, 80);
    const parentId = safeText(req.body?.parentId, 100) || null;
    const replyToName = safeText(req.body?.replyToName, 60) || null;

    if (!storyId || !body) return res.status(400).json({ ok: false, error: 'Story and comment are required' });
    if (body.length < 2) return res.status(400).json({ ok: false, error: 'Comment is too short' });
    if (body.length > 2000) return res.status(400).json({ ok: false, error: 'Comment is too long (2000 characters max)' });

    if (visitorId) {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await supabase.from('comments')
        .select('*', { count: 'exact', head: true })
        .eq('visitor_id', visitorId).gte('created_at', oneHourAgo);
      if ((count || 0) >= 10)
        return res.status(429).json({ ok: false, error: 'You are commenting too fast. Try again in a bit.' });
    }

    const insert = { story_id: storyId, name, body, visitor_id: visitorId, status: 'approved' };
    if (parentId) insert.parent_id = parentId;
    if (replyToName) insert.reply_to_name = replyToName;

    const { data, error } = await supabase.from('comments').insert(insert).select().single();
    if (error) throw new Error(error.message);

    engagementCache.at = 0;

    res.json({
      ok: true,
      comment: {
        id: data.id,
        name: data.name,
        body: data.body,
        at: data.created_at,
        parentId: data.parent_id || null,
        replyToName: data.reply_to_name || null,
        likes: 0, liked: false, isMine: true, replies: []
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Delete own comment ───
app.delete('/api/comment/:id', async (req, res) => {
  try {
    const visitorId = safeText(req.query.visitor, 80);
    const { data: c } = await supabase.from('comments')
      .select('visitor_id').eq('id', req.params.id).maybeSingle();
    if (!c) return res.status(404).json({ ok: false, error: 'Comment not found' });
    if (!visitorId || c.visitor_id !== visitorId)
      return res.status(403).json({ ok: false, error: 'You can only delete your own comments' });

    await supabase.from('comments').delete().eq('id', req.params.id);
    engagementCache.at = 0;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════

app.post('/api/auth/admin', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== store.admin.username || !verifyPassword(password, store.admin.passwordHash))
    return res.status(401).json({ ok: false, error: 'Invalid administrator credentials' });
  const token = issueSession({ id: 'admin', username: 'admin', role: 'admin', name: 'Administrator' });
  setSession(res, token);
  audit('admin.login', req);
  res.json({ ok: true, user: { id: 'admin', username: 'admin', role: 'admin', name: 'Administrator' } });
});

app.post('/api/auth/writer', (req, res) => {
  const { username, password } = req.body || {};
  const w = store.writers.find(x => (x.username === username || x.email === username) && x.status === 'active');
  if (!w || !verifyPassword(password, w.passwordHash))
    return res.status(401).json({ ok: false, error: 'Invalid writer credentials' });
  w.lastLoginAt = now();
  saveStore();
  const role = w.role === 'editor' ? 'editor' : 'writer';
  const token = issueSession({ id: w.id, username: w.username, role, name: w.name });
  setSession(res, token);
  audit('writer.login', req);
  res.json({ ok: true, user: { id: w.id, username: w.username, name: w.name, role } });
});

app.get('/api/auth/me', (req, res) => {
  const u = auth(req);
  res.json({
    ok: true,
    authenticated: !!u,
    user: u ? { id: u.id, username: u.username, name: u.name || '', role: u.role } : null
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, 'tvr_session');
  if (token) sessions.delete(token);
  clearSession(res);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// AI PROXY
// ═══════════════════════════════════════════

app.post('/api/ai/:mode', async (req, res) => {
  const mode = req.params.mode === 'ask' ? 'chat' : req.params.mode;
  const allowed = {
    chat: store.settings.ai.chat, think: store.settings.ai.think,
    expert: store.settings.ai.expert, vision: store.settings.ai.vision
  };
  if (!store.settings.ai.enabled || allowed[mode] === false)
    return res.status(403).json({ ok: false, error: 'This AI feature is disabled.' });
  try { res.json(await proxyJson(`/${['chat', 'think', 'expert', 'vision'].includes(mode) ? mode : 'chat'}`, req.body || {})); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/api/ai/search', async (req, res) => {
  if (!store.settings.ai.enabled || store.settings.ai.search === false)
    return res.status(403).json({ ok: false, error: 'AI search is disabled.' });
  try { res.json(await proxyJson('/search', req.body || {})); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/api/ai/fetch-url', async (req, res) => {
  try { res.json(await proxyJson('/fetch-url', req.body || {})); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════
// UPLOADS
// ═══════════════════════════════════════════

app.post('/api/upload', requireRole('admin', 'editor', 'writer'), (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ ok: false, error: 'File too large. Max 5 MB.' });
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file selected.' });
    try {
      const ext = path.extname(req.file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
      const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
      const { error: upErr } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filename);
      audit('media.upload', req, { file: filename, type: req.file.mimetype, size: req.file.size });
      req.file.buffer = null;
      res.json({ ok: true, url: publicUrl, type: req.file.mimetype, size: req.file.size, name: req.file.originalname });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

// ═══════════════════════════════════════════
// WRITER ROUTES
// ═══════════════════════════════════════════

app.get('/api/writer/stories', requireRole('admin', 'editor', 'writer'), (req, res) => {
  let list = store.stories;
  if (req.user.role === 'writer') list = list.filter(s => s.authorId === req.user.id);
  res.json({ ok: true, stories: list.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
});

app.post('/api/writer/stories', requireRole('admin', 'editor', 'writer'), async (req, res) => {
  const story = sanitizeStoryInput(req.body || {});
  if (!story.title || !story.body)
    return res.status(400).json({ ok: false, error: 'Headline and article body are required.' });
  story.id = uid('story');
  story.authorId = req.user.id;
  story.author = story.author || req.user.name || req.user.username;
  story.createdAt = now();
  story.updatedAt = now();
  story.publishedAt = story.status === 'published' ? now() : null;
  if (req.user.role === 'writer' && store.settings.publishing.writersNeedApproval && ['published', 'scheduled'].includes(story.status))
    story.status = 'submitted';
  store.stories.unshift(story);
  if (store.stories.length > 400) store.stories.length = 400;
  audit('story.create', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true, story });
});

app.patch('/api/writer/stories/:id', requireRole('admin', 'editor', 'writer'), async (req, res) => {
  const story = store.stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ ok: false, error: 'Story not found' });
  if (!canEditStory(req.user, story))
    return res.status(403).json({ ok: false, error: 'You cannot edit this story.' });
  const old = story.status;
  Object.assign(story, sanitizeStoryInput({ ...story, ...req.body }), {
    id: story.id, authorId: story.authorId, createdAt: story.createdAt,
    updatedAt: now(), publishedAt: story.publishedAt
  });
  if (story.status === 'published' && old !== 'published') story.publishedAt = now();
  if (req.user.role === 'writer' && store.settings.publishing.writersNeedApproval && old === 'published' && !store.settings.publishing.allowWriterEditPublished)
    story.status = 'submitted';
  audit('story.update', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true, story });
});

app.delete('/api/writer/stories/:id', requireRole('admin', 'editor', 'writer'), async (req, res) => {
  const idx = store.stories.findIndex(s => s.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Story not found' });
  const story = store.stories[idx];
  if (!canEditStory(req.user, story))
    return res.status(403).json({ ok: false, error: 'You cannot delete this story.' });
  store.stories.splice(idx, 1);
  audit('story.delete', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// ADMIN — STORIES
// ═══════════════════════════════════════════

app.get('/api/admin/stories', requireRole('admin', 'editor'), (_req, res) =>
  res.json({ ok: true, stories: store.stories.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) }));

app.get('/api/admin/dashboard', requireRole('admin', 'editor'), (_req, res) => {
  res.json({
    ok: true,
    stats: {
      rss: cache.items.filter(s => !s.editorial).length,
      published: store.stories.filter(s => s.status === 'published').length,
      drafts: store.stories.filter(s => s.status === 'draft').length,
      submitted: store.stories.filter(s => s.status === 'submitted').length,
      writers: store.writers.filter(w => w.status === 'active').length,
      sources: getFeeds().length
    },
    audit: store.audit.slice(0, 25),
    settings: store.settings
  });
});

app.post('/api/admin/moderate/:id', requireRole('admin', 'editor'), async (req, res) => {
  const story = store.stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ ok: false, error: 'Story not found.' });
  const status = req.body?.status;
  if (!['draft', 'submitted', 'published', 'rejected', 'scheduled'].includes(status))
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  story.status = status;
  story.updatedAt = now();
  if (status === 'published' && !story.publishedAt) story.publishedAt = now();
  audit('story.moderate', req, { storyId: story.id, status });
  try { await refreshNews(); } catch {}
  res.json({ ok: true, story });
});

app.patch('/api/admin/stories/:id', requireRole('admin', 'editor'), async (req, res) => {
  const story = store.stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ ok: false, error: 'Story not found.' });
  Object.assign(story, sanitizeStoryInput({ ...story, ...req.body }), {
    id: story.id, authorId: story.authorId, createdAt: story.createdAt, updatedAt: now(),
    publishedAt: req.body.status === 'published' && !story.publishedAt ? now() : story.publishedAt
  });
  audit('admin.story.update', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true, story });
});

// ═══════════════════════════════════════════
// ADMIN — SETTINGS
// ═══════════════════════════════════════════

app.get('/api/admin/settings', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, settings: store.settings }));

app.patch('/api/admin/settings', requireRole('admin'), (req, res) => {
  const i = req.body || {};
  store.settings = {
    ...store.settings, ...i,
    site: { ...store.settings.site, ...(i.site || {}) },
    sections: { ...store.settings.sections, ...(i.sections || {}) },
    ai: { ...store.settings.ai, ...(i.ai || {}), prompts: { ...store.settings.ai.prompts, ...(i.ai?.prompts || {}) } },
    tts: { ...store.settings.tts, ...(i.tts || {}) },
    publishing: { ...store.settings.publishing, ...(i.publishing || {}) },
    theme: { ...store.settings.theme, ...(i.theme || {}) },
    fallbacks: { ...store.settings.fallbacks, ...(i.fallbacks || {}) }
  };
  audit('settings.update', req);
  res.json({ ok: true, settings: store.settings, updatedAt: store.updatedAt });
});

app.post('/api/admin/admin-password', requireRole('admin'), (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 6) return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });
  if (!verifyPassword(current, store.admin.passwordHash))
    return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
  store.admin.passwordHash = hashPassword(next);
  audit('admin.password_change', req);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// ADMIN — WRITERS
// ═══════════════════════════════════════════

app.get('/api/admin/writers', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, writers: store.writers.map(({ passwordHash, ...w }) => w) }));

app.post('/api/admin/writers', requireRole('admin'), (req, res) => {
  const { username, email, password, name, role = 'writer' } = req.body || {};
  if (!username || !password || !name)
    return res.status(400).json({ ok: false, error: 'Name, username and password are required.' });
  if (store.writers.some(w => w.username === username || (email && w.email === email)))
    return res.status(409).json({ ok: false, error: 'Writer already exists.' });
  const writer = {
    id: uid('writer'),
    username: safeText(username, 80),
    email: safeText(email, 160),
    passwordHash: hashPassword(password),
    name: safeText(name, 120),
    role: ['writer', 'editor'].includes(role) ? role : 'writer',
    status: 'active',
    createdAt: now(),
    lastLoginAt: null
  };
  store.writers.push(writer);
  audit('writer.create', req, { writerId: writer.id });
  const { passwordHash, ...pub } = writer;
  res.json({ ok: true, writer: pub });
});

app.patch('/api/admin/writers/:id', requireRole('admin'), (req, res) => {
  const w = store.writers.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ ok: false, error: 'Writer not found.' });
  for (const k of ['username', 'email', 'name', 'status'])
    if (req.body[k] !== undefined) w[k] = safeText(req.body[k], 160);
  if (req.body.role !== undefined && ['writer', 'editor'].includes(req.body.role)) w.role = req.body.role;
  if (req.body.password) w.passwordHash = hashPassword(req.body.password);
  audit('writer.update', req, { writerId: w.id });
  const { passwordHash, ...pub } = w;
  res.json({ ok: true, writer: pub });
});

app.delete('/api/admin/writers/:id', requireRole('admin'), (req, res) => {
  store.writers = store.writers.filter(w => w.id !== req.params.id);
  audit('writer.delete', req, { writerId: req.params.id });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// ADMIN — SOURCES
// ═══════════════════════════════════════════

app.get('/api/admin/sources', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, sources: getFeeds(), custom: store.sources.custom, overrides: store.sources.overrides }));

app.post('/api/admin/sources', requireRole('admin'), (req, res) => {
  const { name, url, category = 'Nigeria', region = 'Nigeria' } = req.body || {};
  if (!name || !url) return res.status(400).json({ ok: false, error: 'Name and URL are required.' });
  const cleanName = safeText(name, 120);
  if (store.sources.custom.some(x => x.name === cleanName) || BUILTIN_FEEDS.some(x => x.name === cleanName))
    return res.status(409).json({ ok: false, error: 'A source with that name already exists.' });
  store.sources.custom.push({
    name: cleanName, url: safeText(url, 500),
    category: safeText(category, 60), region: safeText(region, 60),
    enabled: true, builtin: false
  });
  audit('source.create', req, { name: cleanName });
  res.json({ ok: true });
});

app.patch('/api/admin/sources', requireRole('admin'), async (req, res) => {
  const { name, ...patch } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'Source name required.' });
  const exists = BUILTIN_FEEDS.some(x => x.name === name) || store.sources.custom.some(x => x.name === name);
  if (!exists) return res.status(404).json({ ok: false, error: 'Source not found.' });
  store.sources.overrides[name] = { ...(store.sources.overrides[name] || {}), ...patch };
  audit('source.update', req, { name });
  try { await refreshNews(); } catch {}
  res.json({ ok: true });
});

app.delete('/api/admin/sources/:name', requireRole('admin'), async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  store.sources.custom = store.sources.custom.filter(x => x.name !== name);
  delete store.sources.overrides[name];
  audit('source.delete', req, { name });
  try { await refreshNews(); } catch {}
  res.json({ ok: true });
});

// ═══════════════════════════════════════════
// ADMIN — COMMENTS MODERATION
// ═══════════════════════════════════════════

app.get('/api/admin/comments', requireRole('admin', 'editor'), async (_req, res) => {
  try {
    const { data, error } = await supabase.from('comments')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    res.json({ ok: true, comments: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/admin/comments/:id', requireRole('admin', 'editor'), async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['approved', 'hidden'].includes(status))
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    const { error } = await supabase.from('comments').update({ status }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    engagementCache.at = 0;
    audit('comment.' + status, req, { commentId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/admin/comments/:id', requireRole('admin', 'editor'), async (req, res) => {
  try {
    const { error } = await supabase.from('comments').delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    engagementCache.at = 0;
    audit('comment.delete', req, { commentId: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — ARTICLE CACHE
// ═══════════════════════════════════════════

app.post('/api/admin/clear-article-cache', requireRole('admin'), async (req, res) => {
  try {
    const olderThanDays = Number(req.body?.olderThanDays || 0);
    let query = supabase.from('articles').delete();
    if (olderThanDays > 0) {
      const date = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('fetched_at', date);
    } else {
      query = query.neq('url_hash', '');
    }
    const { error } = await query;
    if (error) throw new Error(error.message);
    audit('article_cache.clear', req, { olderThanDays });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN — REFRESH + AUDIT
// ═══════════════════════════════════════════

app.post('/api/admin/refresh', requireRole('admin', 'editor'), async (req, res) => {
  try {
    const c = await refreshNews();
    audit('news.refresh', req);
    res.json({ ok: true, updatedAt: new Date(c.updatedAt).toISOString(), count: c.items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/audit', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, audit: store.audit }));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path }));

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════

async function boot() {
  try {
    const loaded = await loadStoreFromSupabase();
    if (loaded) {
      store = loaded;
      console.log('[boot] loaded store from Supabase');
    } else {
      console.log('[boot] no store row found — creating fresh one');
      await saveStoreNow();
    }
  } catch (e) {
    console.error('[boot] failed to load store:', e.message);
    store = freshStore();
  }

  cache = { updatedAt: Date.now(), items: publicStories(), sources: {} };

  app.listen(PORT, '0.0.0.0', () =>
    console.log(`THE VOICE REPORTER API listening on 0.0.0.0:${PORT} [linkedom + article cache + reactions]`)
  );

  refreshNews().catch(e => console.error('[boot news]', e.message));
  setInterval(() => refreshNews().catch(e => console.error('[refresh]', e.message)), 90 * 1000);
  setInterval(pruneSessions, 10 * 60 * 1000);
  pruneSessions();

  // Daily article cache cleanup
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('articles').delete().lt('fetched_at', cutoff);
      if (error) console.warn('[article cleanup]', error.message);
      else console.log('[article cleanup] done');
    } catch (e) { console.warn('[article cleanup]', e.message); }
  }, 24 * 60 * 60 * 1000);

  // Memory telemetry
  setInterval(() => {
    const m = process.memoryUsage();
    const rss = (m.rss / 1048576).toFixed(1);
    const heap = (m.heapUsed / 1048576).toFixed(1);
    console.log(`[mem] rss=${rss}MB heap=${heap}MB sessions=${sessions.size} articles=${cache.items.length}`);
  }, 5 * 60 * 1000);
}

boot().catch(e => { console.error(e); process.exit(1); });