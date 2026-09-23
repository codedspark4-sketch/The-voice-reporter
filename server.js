const express = require('express');
const Parser = require('rss-parser');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { JSDOM } = require('jsdom');
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

app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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

const DEFAULT_SETTINGS = {
  site: { title: 'THE VOICE REPORTER', tagline: 'REAL NEWS • NIGERIA • AFRICA • WORLD', tickerEnabled: true, tickerSpeed: 72, autoRefreshSeconds: 20 },
  sections: { latest: true, nigeria: true, politics: true, business: true, technology: true, sports: true, world: true, mostReported: true, aiDesk: true, brief: true },
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
  publishing: { writersNeedApproval: true, allowWriterEditPublished: false },
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
    stories: Array.isArray(incoming.stories) ? incoming.stories : [],
    writers: Array.isArray(incoming.writers) ? incoming.writers : [],
    admin: { ...base.admin, ...(incoming.admin || {}) },
    audit: Array.isArray(incoming.audit) ? incoming.audit : []
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
  }, 600);
}

const sessions = new Map();
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function issueSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...user, expires: Date.now() + 1000 * 60 * 60 * 12 });
  return token;
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
  store.audit.unshift({ id: uid('audit'), action, at: now(), actor: { id: req?.user?.id || 'system', username: req?.user?.username || 'system', role: req?.user?.role || 'system' }, ip: req?.ip || '', meta });
  store.audit = store.audit.slice(0, 300);
  saveStore();
}

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
  return store.stories.filter(s => s.status === 'published' || (s.status === 'scheduled' && s.scheduledAt && new Date(s.scheduledAt) <= new Date())).map(s => ({
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
async function refreshNews() {
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
  }).slice(0, 500);
  cache = { updatedAt: Date.now(), items, sources };
  return cache;
}

function sanitizeStoryInput(body) {
  const title = safeText(body.title, 220);
  return {
    id: body.id || uid('story'),
    title,
    subheadline: safeText(body.subheadline, 600),
    body: safeText(body.body, 150000),
    category: safeText(body.category || 'Nigeria', 60),
    region: safeText(body.region || 'Nigeria', 60),
    tags: Array.isArray(body.tags) ? body.tags.map(x => safeText(x, 40)).filter(Boolean).slice(0, 20) : safeText(body.tags || '', 500).split(',').map(x => x.trim()).filter(Boolean),
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
    isBreaking: !!body.isBreaking, isDeveloping: !!body.isDeveloping,
    isUpdated: !!body.isUpdated, featured: !!body.featured,
    sourceAttribution: safeText(body.sourceAttribution, 600)
  };
}
function canEditStory(user, story) { return user.role === 'admin' || user.role === 'editor' || story.authorId === user.id; }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//i.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Only image and video files are allowed.'));
  }
});

async function proxyJson(endpoint, payload) {
  const r = await fetch(`${PROXY_URL}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { success: false, error: text || `Proxy ${r.status}` }; }
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

app.get('/', (_req, res) => res.json({ ok: true, service: 'THE VOICE REPORTER API', version: 4, storage: 'supabase', health: '/api/health' }));
app.get('/api/config', (_req, res) => res.json({ ok: true, settings: store.settings }));
app.get('/api/news', (req, res) => res.json(publicNewsPayload(req.query.limit)));
app.get('/api/news-lite', (req, res) => res.json(publicNewsPayload(req.query.limit)));
app.post('/api/refresh', async (_req, res) => {
  try { const c = await refreshNews(); res.json({ ok: true, updatedAt: new Date(c.updatedAt).toISOString(), stories: c.items.length, sources: c.sources }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
  res.json({
    ok: true, service: 'THE VOICE REPORTER', version: 4, serverTime: now(),
    newsUpdatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    feeds: getFeeds().length,
    feedStories: cache.items.length,
    publishedStories: store.stories.filter(s => s.status === 'published').length,
    writers: store.writers.length,
    proxy: { url: PROXY_URL, reachable: proxyReachable },
    supabase: { ok: supabaseOk, error: supabaseError, bucket: SUPABASE_BUCKET },
    cors: { allowedOrigins: FRONTEND_ORIGINS.length ? FRONTEND_ORIGINS : ['(any)'] },
    storage: 'supabase'
  });
});

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
  const dom = new JSDOM(html, { url: r.url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.textContent || article.textContent.trim().length < 80) throw new Error('Could not extract a readable article');
  return {
    title: article.title || '', byline: article.byline || '', excerpt: article.excerpt || '',
    content: article.content || '',
    siteName: article.siteName || new URL(r.url).hostname,
    publishedTime: article.publishedTime || '',
    url: r.url
  };
}
app.get('/api/article', async (req, res) => {
  const url = safeText(req.query.url, 4000);
  if (!url) return res.status(400).json({ ok: false, error: 'Article URL is required.' });
  try { res.json({ ok: true, article: await fetchExternalArticle(url) }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/story/:id', (req, res) => {
  const s = publicStories().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: 'Story not found' });
  res.json({ ok: true, story: s });
});

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
  w.lastLoginAt = now(); saveStore();
  const role = w.role === 'editor' ? 'editor' : 'writer';
  const token = issueSession({ id: w.id, username: w.username, role, name: w.name });
  setSession(res, token);
  audit('writer.login', req);
  res.json({ ok: true, user: { id: w.id, username: w.username, name: w.name, role } });
});
app.get('/api/auth/me', (req, res) => {
  const u = auth(req);
  res.json({ ok: true, authenticated: !!u, user: u ? { id: u.id, username: u.username, name: u.name || '', role: u.role } : null });
});
app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, 'tvr_session');
  if (token) sessions.delete(token);
  clearSession(res);
  res.json({ ok: true });
});

app.post('/api/ai/:mode', async (req, res) => {
  const mode = req.params.mode === 'ask' ? 'chat' : req.params.mode;
  const allowed = { chat: store.settings.ai.chat, think: store.settings.ai.think, expert: store.settings.ai.expert, vision: store.settings.ai.vision };
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

app.post('/api/upload', requireRole('admin', 'editor', 'writer'), (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
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
      res.json({ ok: true, url: publicUrl, type: req.file.mimetype, size: req.file.size, name: req.file.originalname });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

app.get('/api/writer/stories', requireRole('admin', 'editor', 'writer'), (req, res) => {
  let list = store.stories;
  if (req.user.role === 'writer') list = list.filter(s => s.authorId === req.user.id);
  res.json({ ok: true, stories: list.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
});
app.post('/api/writer/stories', requireRole('admin', 'editor', 'writer'), async (req, res) => {
  const story = sanitizeStoryInput(req.body || {});
  if (!story.title || !story.body) return res.status(400).json({ ok: false, error: 'Headline and article body are required.' });
  story.id = uid('story');
  story.authorId = req.user.id;
  story.author = story.author || req.user.name || req.user.username;
  story.createdAt = now(); story.updatedAt = now();
  story.publishedAt = story.status === 'published' ? now() : null;
  if (req.user.role === 'writer' && store.settings.publishing.writersNeedApproval && ['published', 'scheduled'].includes(story.status))
    story.status = 'submitted';
  store.stories.unshift(story);
  audit('story.create', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true, story });
});
app.patch('/api/writer/stories/:id', requireRole('admin', 'editor', 'writer'), async (req, res) => {
  const story = store.stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ ok: false, error: 'Story not found' });
  if (!canEditStory(req.user, story)) return res.status(403).json({ ok: false, error: 'You cannot edit this story.' });
  const old = story.status;
  Object.assign(story, sanitizeStoryInput({ ...story, ...req.body }), { id: story.id, authorId: story.authorId, createdAt: story.createdAt, updatedAt: now(), publishedAt: story.publishedAt });
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
  if (!canEditStory(req.user, story)) return res.status(403).json({ ok: false, error: 'You cannot delete this story.' });
  store.stories.splice(idx, 1);
  audit('story.delete', req, { storyId: story.id });
  try { await refreshNews(); } catch {}
  res.json({ ok: true });
});

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
app.get('/api/admin/settings', requireRole('admin'), (_req, res) => res.json({ ok: true, settings: store.settings }));
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
  if (!verifyPassword(current, store.admin.passwordHash)) return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
  store.admin.passwordHash = hashPassword(next);
  audit('admin.password_change', req);
  res.json({ ok: true });
});
app.get('/api/admin/writers', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, writers: store.writers.map(({ passwordHash, ...w }) => w) }));
app.post('/api/admin/writers', requireRole('admin'), (req, res) => {
  const { username, email, password, name, role = 'writer' } = req.body || {};
  if (!username || !password || !name) return res.status(400).json({ ok: false, error: 'Name, username and password are required.' });
  if (store.writers.some(w => w.username === username || (email && w.email === email)))
    return res.status(409).json({ ok: false, error: 'Writer already exists.' });
  const writer = {
    id: uid('writer'), username: safeText(username, 80), email: safeText(email, 160),
    passwordHash: hashPassword(password), name: safeText(name, 120),
    role: ['writer', 'editor'].includes(role) ? role : 'writer',
    status: 'active', createdAt: now(), lastLoginAt: null
  };
  store.writers.push(writer);
  audit('writer.create', req, { writerId: writer.id });
  const { passwordHash, ...pub } = writer;
  res.json({ ok: true, writer: pub });
});
app.patch('/api/admin/writers/:id', requireRole('admin'), (req, res) => {
  const w = store.writers.find(x => x.id === req.params.id);
  if (!w) return res.status(404).json({ ok: false, error: 'Writer not found.' });
  for (const k of ['username', 'email', 'name', 'status']) if (req.body[k] !== undefined) w[k] = safeText(req.body[k], 160);
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
app.get('/api/admin/sources', requireRole('admin'), (_req, res) =>
  res.json({ ok: true, sources: getFeeds(), custom: store.sources.custom, overrides: store.sources.overrides }));
app.post('/api/admin/sources', requireRole('admin'), (req, res) => {
  const { name, url, category = 'Nigeria', region = 'Nigeria' } = req.body || {};
  if (!name || !url) return res.status(400).json({ ok: false, error: 'Name and URL are required.' });
  const cleanName = safeText(name, 120);
  if (store.sources.custom.some(x => x.name === cleanName) || BUILTIN_FEEDS.some(x => x.name === cleanName))
    return res.status(409).json({ ok: false, error: 'A source with that name already exists.' });
  store.sources.custom.push({ name: cleanName, url: safeText(url, 500), category: safeText(category, 60), region: safeText(region, 60), enabled: true, builtin: false });
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
app.post('/api/admin/refresh', requireRole('admin', 'editor'), async (req, res) => {
  try { const c = await refreshNews(); audit('news.refresh', req); res.json({ ok: true, updatedAt: new Date(c.updatedAt).toISOString(), count: c.items.length }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/admin/audit', requireRole('admin'), (_req, res) => res.json({ ok: true, audit: store.audit }));
app.post('/api/admin/moderate/:id', requireRole('admin', 'editor'), async (req, res) => {
  const story = store.stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ ok: false, error: 'Story not found.' });
  const status = req.body?.status;
  if (!['draft', 'submitted', 'published', 'rejected', 'scheduled'].includes(status))
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  story.status = status; story.updatedAt = now();
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

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path }));

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

  app.listen(PORT, '0.0.0.0', () => console.log(`THE VOICE REPORTER API listening on 0.0.0.0:${PORT}`));

  refreshNews().catch(e => console.error('[boot news]', e.message));
  setInterval(() => refreshNews().catch(e => console.error('[refresh]', e.message)), 60 * 1000);
}
boot().catch(e => { console.error(e); process.exit(1); });