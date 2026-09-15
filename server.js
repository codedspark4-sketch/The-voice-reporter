const express = require('express');
const Parser = require('rss-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_URL = 'https://studentnija-proxy-v2.donchester111.workers.dev';
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'The Voice Reporter News Desk/2.0' } });
app.use(express.json({ limit: '4mb' }));
app.set('trust proxy', 1);

const BUILTIN_FEEDS = [
  ['PUNCH','Nigeria','Nigeria','https://rss.punchng.com/v1/category/latest_news'],
  ['PUNCH Politics','Nigeria','Politics','https://rss.punchng.com/v1/category/politics'],
  ['PUNCH Business','Nigeria','Business','https://rss.punchng.com/v1/category/business'],
  ['PUNCH Sports','Nigeria','Sports','https://rss.punchng.com/v1/category/sports'],
  ['Premium Times','Nigeria','Nigeria','https://www.premiumtimesng.com/feed'],
  ['Guardian Nigeria','Nigeria','Nigeria','https://guardian.ng/feed/'],
  ['Tribune Online','Nigeria','Nigeria','https://tribuneonlineng.com/feed/'],
  ['The Nation Nigeria','Nigeria','Nigeria','https://thenationonlineng.net/feed/'],
  ['Daily Post Nigeria','Nigeria','Nigeria','https://dailypost.ng/feed'],
  ['Legit.ng','Nigeria','Nigeria','https://www.legit.ng/rss/all.rss'],
  ['Sahara Reporters','Nigeria','Nigeria','https://saharareporters.com/articles/rss-feed'],
  ['BBC World','World','World','https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['Al Jazeera','World','World','https://www.aljazeera.com/xml/rss/all.xml'],
  ['DW World','World','World','https://rss.dw.com/rdf/rss-en-world'],
  ['France 24','World','World','https://www.france24.com/en/rss'],
  ['The Guardian World','World','World','https://www.theguardian.com/world/rss'],
  ['New York Times World','World','World','https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
  ['NPR World','World','World','https://feeds.npr.org/1004/rss.xml'],
  ['Sky News World','World','World','https://feeds.skynews.com/feeds/rss/world.xml'],
  ['NHK Global','World','World','https://www3.nhk.or.jp/rssxml/news/globalnewsroom.xml'],
  ['CBC World','World','World','https://www.cbc.ca/webfeed/rss/rss-world'],
  ['TechCrunch','World','Technology','https://techcrunch.com/feed/'],
  ['Wired','World','Technology','https://www.wired.com/feed/rss'],
  ['Ars Technica','World','Technology','https://feeds.arstechnica.com/arstechnica/index'],
  ['CNBC','World','Business','https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114']
].map(([name, region, category, url]) => ({ name, region, category, url, enabled: true, builtin: true }));

const DEFAULT_SETTINGS = {
  site: { title: 'THE VOICE REPORTER', tagline: 'REAL NEWS • NIGERIA • WORLD', tickerEnabled: true, tickerSpeed: 24 },
  sections: { latest:true, nigeria:true, politics:true, business:true, technology:true, sports:true, world:true, mostReported:true, aiDesk:true, brief:true },
  ai: {
    enabled:true, chat:true, think:true, expert:true, vision:true, search:true,
    prompts: {
      brief:'Create a concise newsroom brief from the supplied article. Give the facts, why it matters, what is known, and what remains uncertain.',
      analysis:'Provide a deep, precise news analysis. Separate verified facts from interpretation and do not invent details.',
      ask:'Answer the reader using only the supplied story context unless fresh research is explicitly requested. Be clear and factual.',
      desk:'Act as the AI News Desk for THE VOICE REPORTER. Prioritize current, verifiable developments and clearly label uncertainty.'
    }
  },
  tts: { enabled:true, voice:'default', rate:1, pitch:1, volume:1 },
  publishing: { writersNeedApproval:true, allowWriterEditPublished:false },
  theme: { default:'system', accent:'#be1212' }
};

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function freshStore(){
  const adminHash = hashPassword(process.env.ADMIN_PASSWORD || '463946');
  return { version:2, settings:clone(DEFAULT_SETTINGS), sources:{ custom:[], overrides:{} }, stories:[], writers:[], admin:{ username:'admin', passwordHash:adminHash }, audit:[], updatedAt:new Date().toISOString() };
}
function loadStore(){
  try { if(!fs.existsSync(STORE_FILE)) { const s=freshStore(); saveStore(s); return s; } const s=JSON.parse(fs.readFileSync(STORE_FILE,'utf8')); return normalizeStore(s); }
  catch(e){ console.error('[store]',e); return freshStore(); }
}
function normalizeStore(s){
  const base=freshStore();
  return {
    ...base, ...s,
    settings:{...base.settings,...(s.settings||{}),site:{...base.settings.site,...(s.settings?.site||{})},sections:{...base.settings.sections,...(s.settings?.sections||{})},ai:{...base.settings.ai,...(s.settings?.ai||{}),prompts:{...base.settings.ai.prompts,...(s.settings?.ai?.prompts||{})}},tts:{...base.settings.tts,...(s.settings?.tts||{})},publishing:{...base.settings.publishing,...(s.settings?.publishing||{})},theme:{...base.settings.theme,...(s.settings?.theme||{})}},
    sources:{custom:s.sources?.custom||[],overrides:s.sources?.overrides||{}},stories:s.stories||[],writers:s.writers||[],audit:s.audit||[],admin:{...base.admin,...(s.admin||{})}
  };
}
let store=loadStore();
function saveStore(next=store){ next.updatedAt=new Date().toISOString(); fs.writeFileSync(STORE_FILE, JSON.stringify(next,null,2)); }
function now(){return new Date().toISOString();}
function uid(prefix='id'){ return prefix+'_'+crypto.randomUUID().replace(/-/g,''); }
function hashPassword(pw, salt=crypto.randomBytes(16).toString('hex')){ const hash=crypto.scryptSync(String(pw), salt, 64).toString('hex'); return `${salt}:${hash}`; }
function verifyPassword(pw, encoded){ try{const [salt,hash]=String(encoded).split(':'); const got=crypto.scryptSync(String(pw),salt,64).toString('hex'); return crypto.timingSafeEqual(Buffer.from(got,'hex'),Buffer.from(hash,'hex'));}catch(_){return false;} }
const sessions=new Map();
function issueSession(user){const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{...user,expires:Date.now()+1000*60*60*12}); return token;}
function readCookie(req,name){const raw=req.headers.cookie||''; for(const part of raw.split(';')){const [k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));} return '';}
function auth(req){const token=readCookie(req,'tvr_session');const s=sessions.get(token);if(!s||s.expires<Date.now()){if(token)sessions.delete(token);return null;}return s;}
function requireRole(...roles){return (req,res,next)=>{const u=auth(req);if(!u||!roles.includes(u.role))return res.status(401).json({ok:false,error:'Authentication required'});req.user=u;next();};}
function setSession(res,token){res.setHeader('Set-Cookie',`tvr_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}; Max-Age=43200`);}
function clearSession(res){res.setHeader('Set-Cookie','tvr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');}
function safeText(v,max=120000){return String(v??'').slice(0,max).trim();}
function slugify(v){return safeText(v,160).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function decodeHtml(input=''){return String(input).replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();}
function normalizeTitle(t=''){return String(t).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function categoryFallback(category){const c=String(category||'News').toUpperCase();const palettes={NIGERIA:['#003b2b','#008753'],POLITICS:['#3d0b0b','#be1212'],BUSINESS:['#172554','#2563eb'],TECHNOLOGY:['#111827','#7c3aed'],SPORTS:['#052e16','#16a34a'],WORLD:['#0f172a','#0284c7'],ENTERTAINMENT:['#3b0764','#db2777'],SCIENCE:['#083344','#06b6d4'],NEWS:['#111827','#334155']};const [a,b]=palettes[c]||palettes.NEWS;const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1350" cy="180" r="220" fill="white" opacity=".08"/><circle cx="250" cy="740" r="280" fill="white" opacity=".06"/><text x="90" y="160" fill="white" font-family="Arial" font-size="52" font-weight="800">THE VOICE REPORTER</text><text x="90" y="260" fill="white" font-family="Arial" font-size="96" font-weight="900">${c}</text><text x="90" y="325" fill="white" opacity=".75" font-family="Arial" font-size="30">LIVE NEWS</text><path d="M1260 470h120v210h-120z" fill="white" opacity=".13"/><path d="M1400 390h90v290h-90z" fill="white" opacity=".1"/><path d="M1120 560h95v120h-95z" fill="white" opacity=".16"/></svg>`;return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);}
function itemImage(item){if(item.enclosure?.url)return item.enclosure.url;if(item.image?.url)return item.image.url;const html=item['content:encoded']||item.content||item.description||'';const m=String(html).match(/<img[^>]+src=["']([^"']+)["']/i);return m?m[1]:'';}
function cleanDescription(item){const v=decodeHtml(item.contentSnippet||item.summary||item.content||item.description||'');return v.length<=300?v:v.slice(0,297).replace(/\s+\S*$/,'')+'…';}
function inferCategory(feed,item){const text=`${feed.category} ${item.categories||''} ${item.title||''}`.toLowerCase();if(!['Nigeria','World'].includes(feed.category))return feed.category;if(/sport|football|soccer|tennis|basketball|olympic|cricket|rugby/.test(text))return 'Sports';if(/business|econom|market|finance|bank|oil|trade|stock|inflation/.test(text))return 'Business';if(/technology|tech|artificial intelligence|\bai\b|cyber|software|gadget/.test(text))return 'Technology';if(/politic|election|president|senate|governor|minister|government|parliament/.test(text))return 'Politics';return feed.category;}
function getFeeds(){const by=new Map(BUILTIN_FEEDS.map(f=>[f.name,{...f}]));for(const c of store.sources.custom)by.set(c.name,{...c,builtin:false});for(const [name,o] of Object.entries(store.sources.overrides)){if(by.has(name))by.set(name,{...by.get(name),...o});}return [...by.values()].filter(f=>f.enabled!==false);}
async function fetchFeed(feed){try{const parsed=await parser.parseURL(feed.url);const items=(parsed.items||[]).map(item=>{const d=new Date(item.isoDate||item.pubDate||item.date||Date.now());return {id:'rss_'+crypto.createHash('sha1').update((item.guid||item.link||item.title||'')+'|'+feed.name).digest('hex').slice(0,18),kind:'rss',title:decodeHtml(item.title||'Untitled'),link:item.link||parsed.link||'#',description:cleanDescription(item),image:itemImage(item),source:feed.name,region:feed.region,category:inferCategory(feed,item),publishedAt:Number.isNaN(d.getTime())?now():d.toISOString(),status:'published',author:'',editorial:false};}).filter(x=>x.title&&x.link!=='#');return {ok:true,count:items.length,items};}catch(e){return {ok:false,count:0,items:[],error:e.message||String(e)};}}
async function refreshNews(){const feeds=getFeeds();const settled=await Promise.all(feeds.map(fetchFeed));const sourceStatus={};let rss=[];settled.forEach((r,i)=>{sourceStatus[feeds[i].name]={ok:r.ok,count:r.count,error:r.error||null,url:feeds[i].url,category:feeds[i].category,region:feeds[i].region,builtin:!!feeds[i].builtin};rss=rss.concat(r.items);});rss.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));const seen=new Set();rss=rss.filter(i=>{const k=normalizeTitle(i.title);if(!k||seen.has(k))return false;seen.add(k);return true;}).slice(0,450);cache={updatedAt:Date.now(),items:rss,sources:sourceStatus};return cache;}
let cache={updatedAt:0,items:[],sources:{}};
function publicStories(){const editorial=store.stories.filter(s=>s.status==='published').map(s=>({...s,kind:'editorial',editorial:true}));const all=cache.items.concat(editorial).sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));const seen=new Set();return all.filter(s=>{const k=normalizeTitle(s.title);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,500);}
function articleIndex(){return publicStories();}
function audit(action,req,extra={}){store.audit.unshift({id:uid('audit'),at:now(),action,actor:req.user?{id:req.user.id,username:req.user.username,role:req.user.role}:null,ip:req.ip,...extra});store.audit=store.audit.slice(0,500);saveStore();}

async function fetchArticle(url){try{const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error('Invalid article URL');const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; The Voice Reporter Reader/2.0)'},redirect:'follow'});if(!response.ok)throw new Error(`Publisher returned ${response.status}`);const html=await response.text();const dom=new JSDOM(html,{url:response.url});const article=new Readability(dom.window.document).parse();if(!article||!article.textContent||article.textContent.trim().length<80)throw new Error('Could not extract a readable article');return {title:article.title||'',byline:article.byline||'',excerpt:article.excerpt||'',content:article.content||'',siteName:article.siteName||new URL(response.url).hostname,publishedTime:article.publishedTime||'',url:response.url};}catch(e){throw e;}}

async function proxyJson(endpoint,payload){const r=await fetch(PROXY_URL+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={success:false,error:text||`Proxy ${r.status}`};}if(!r.ok)throw new Error(data.error||`AI proxy returned ${r.status}`);return data;}
async function proxyImage(prompt){const r=await fetch(PROXY_URL+'/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});if(!r.ok)throw new Error('Image generation unavailable');const type=r.headers.get('content-type')||'image/jpeg';const bytes=Buffer.from(await r.arrayBuffer());return `data:${type};base64,${bytes.toString('base64')}`;}
const aiRate=new Map();function aiAllowed(ip){const n=Date.now();const a=aiRate.get(ip)||[];const fresh=a.filter(t=>n-t<60000);if(fresh.length>=30){aiRate.set(ip,fresh);return false;}fresh.push(n);aiRate.set(ip,fresh);return true;}

// Public API
app.get('/api/config',(_req,res)=>res.json({ok:true,settings:store.settings,proxy:PROXY_URL}));
app.get('/api/news',(req,res)=>{const list=articleIndex();const limit=Math.min(Math.max(parseInt(req.query.limit||'180',10),1),500);res.set('Cache-Control','no-store');res.json({ok:true,updatedAt:cache.updatedAt?new Date(cache.updatedAt).toISOString():null,items:list.slice(0,limit),sources:cache.sources});});
app.post('/api/refresh',async(req,res)=>{try{const c=await refreshNews();res.json({ok:true,updatedAt:new Date(c.updatedAt).toISOString(),stories:publicStories().length,sources:c.sources});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get('/api/health',async(_req,res)=>{const p={reachable:false};try{const r=await fetch(PROXY_URL+'/health');p.reachable=r.ok;}catch(_){}res.json({ok:true,service:'THE VOICE REPORTER',version:2,serverTime:now(),newsUpdatedAt:cache.updatedAt?new Date(cache.updatedAt).toISOString():null,feeds:getFeeds().length,feedStories:cache.items.length,publishedStories:store.stories.filter(s=>s.status==='published').length,proxy:{url:PROXY_URL,reachable:p.reachable},storage:'json'});});
app.get('/api/story/:id',(req,res)=>{const s=store.stories.find(x=>x.id===req.params.id&&x.status==='published');if(!s)return res.status(404).json({ok:false,error:'Story not found'});res.json({ok:true,story:s});});
app.get('/api/article',async(req,res)=>{const url=String(req.query.url||'').trim();try{const article=await fetchArticle(url);res.json({ok:true,article});}catch(e){res.status(502).json({ok:false,error:e.message||'Unable to read article'});}});

// Auth
app.post('/api/auth/admin', (req,res)=>{const {username,password}=req.body||{};if(username!=='admin'||!verifyPassword(password,store.admin.passwordHash))return res.status(401).json({ok:false,error:'Invalid administrator credentials'});const token=issueSession({id:'admin',username:'admin',role:'admin'});setSession(res,token);audit('admin.login',req);res.json({ok:true,user:{id:'admin',username:'admin',role:'admin'}});});
app.post('/api/auth/writer',(req,res)=>{const {username,password}=req.body||{};const w=store.writers.find(x=>(x.username===username||x.email===username)&&x.status==='active');if(!w||!verifyPassword(password,w.passwordHash))return res.status(401).json({ok:false,error:'Invalid writer credentials'});w.lastLoginAt=now();saveStore();const token=issueSession({id:w.id,username:w.username,role:w.role==='editor'?'editor':'writer',name:w.name});setSession(res,token);audit('writer.login',req);res.json({ok:true,user:{id:w.id,username:w.username,name:w.name,role:w.role==='editor'?'editor':'writer'}});});
app.get('/api/auth/me',(req,res)=>{const u=auth(req);res.json({ok:true,authenticated:!!u,user:u?{id:u.id,username:u.username,name:u.name||'',role:u.role}:null});});
app.post('/api/auth/logout',(req,res)=>{const token=readCookie(req,'tvr_session');if(token)sessions.delete(token);clearSession(res);res.json({ok:true});});

// AI
app.post('/api/ai/:mode',async(req,res)=>{if(!store.settings.ai.enabled||!aiAllowed(req.ip))return res.status(429).json({ok:false,error:'AI temporarily unavailable'});const mode=req.params.mode==='ask'?'chat':req.params.mode;const endpoint=['chat','think','expert','vision'].includes(mode)?`/${mode}`:'/chat';try{const body=req.body||{};const data=await proxyJson(endpoint,body);res.json(data);}catch(e){res.status(502).json({ok:false,error:e.message});}});
app.post('/api/ai/search',async(req,res)=>{if(!store.settings.ai.search||!aiAllowed(req.ip))return res.status(429).json({ok:false,error:'AI search temporarily unavailable'});try{res.json(await proxyJson('/search',req.body||{}));}catch(e){res.status(502).json({ok:false,error:e.message});}});
app.post('/api/ai/fetch-url',async(req,res)=>{try{res.json(await proxyJson('/fetch-url',req.body||{}));}catch(e){res.status(502).json({ok:false,error:e.message});}});
app.post('/api/ai/image',requireRole('admin','editor','writer'),async(req,res)=>{try{const image=await proxyImage(safeText(req.body?.prompt,2048));res.json({ok:true,image});}catch(e){res.status(502).json({ok:false,error:e.message});}});

// Writer / editorial APIs
function sanitizeStoryInput(body){const title=safeText(body.title,220);return {id:body.id||uid('story'),title,subheadline:safeText(body.subheadline,500),body:safeText(body.body,120000),category:safeText(body.category||'Nigeria',60),region:safeText(body.region||'Nigeria',60),tags:Array.isArray(body.tags)?body.tags.map(x=>safeText(x,40)).filter(Boolean).slice(0,15):safeText(body.tags||'',300).split(',').map(x=>x.trim()).filter(Boolean),image:safeText(body.image,2000000),imageCaption:safeText(body.imageCaption,300),author:safeText(body.author,100),slug:slugify(body.slug||title),seoTitle:safeText(body.seoTitle,180),seoDescription:safeText(body.seoDescription,320),status:['draft','submitted','published','rejected','scheduled'].includes(body.status)?body.status:'draft',scheduledAt:body.scheduledAt||null,isBreaking:!!body.isBreaking,isDeveloping:!!body.isDeveloping,isUpdated:!!body.isUpdated,featured:!!body.featured,sourceAttribution:safeText(body.sourceAttribution,500)};}
function canEditStory(u,s){return u.role==='admin'||u.role==='editor'||s.authorId===u.id;}
app.get('/api/writer/stories',requireRole('admin','editor','writer'),(req,res)=>{let list=store.stories;if(req.user.role==='writer')list=list.filter(s=>s.authorId===req.user.id);res.json({ok:true,stories:list.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))});});
app.post('/api/writer/stories',requireRole('admin','editor','writer'),(req,res)=>{const s=sanitizeStoryInput(req.body||{});s.id=uid('story');s.authorId=req.user.id;s.author=s.author||req.user.name||req.user.username;s.createdAt=now();s.updatedAt=now();if(req.user.role==='writer'&&store.settings.publishing.writersNeedApproval)s.status=['published','scheduled'].includes(s.status)?'submitted':s.status;store.stories.unshift(s);audit('story.create',req,{storyId:s.id});res.json({ok:true,story:s});});
app.patch('/api/writer/stories/:id',requireRole('admin','editor','writer'),(req,res)=>{const s=store.stories.find(x=>x.id===req.params.id);if(!s)return res.status(404).json({ok:false,error:'Story not found'});if(!canEditStory(req.user,s))return res.status(403).json({ok:false,error:'Not allowed'});const incoming=sanitizeStoryInput({...s,...req.body});Object.assign(s,incoming,{id:s.id,authorId:s.authorId,createdAt:s.createdAt,updatedAt:now()});if(req.user.role==='writer'&&store.settings.publishing.writersNeedApproval&&s.status==='published'&&!store.settings.publishing.allowWriterEditPublished)s.status='submitted';audit('story.update',req,{storyId:s.id});res.json({ok:true,story:s});});
app.delete('/api/writer/stories/:id',requireRole('admin','editor','writer'),(req,res)=>{const idx=store.stories.findIndex(x=>x.id===req.params.id);if(idx<0)return res.status(404).json({ok:false,error:'Story not found'});const s=store.stories[idx];if(!canEditStory(req.user,s))return res.status(403).json({ok:false,error:'Not allowed'});store.stories.splice(idx,1);audit('story.delete',req,{storyId:s.id});res.json({ok:true});});

// Admin APIs
app.get('/api/admin/dashboard',requireRole('admin','editor'),(req,res)=>{const published=store.stories.filter(s=>s.status==='published').length;const drafts=store.stories.filter(s=>s.status==='draft').length;const submitted=store.stories.filter(s=>s.status==='submitted').length;const writers=store.writers.filter(w=>w.status==='active').length;res.json({ok:true,stats:{rss:cache.items.length,published,drafts,submitted,writers,sources:getFeeds().length},audit:store.audit.slice(0,15),settings:store.settings});});
app.get('/api/admin/settings',requireRole('admin'),(_req,res)=>res.json({ok:true,settings:store.settings}));
app.post('/api/admin/admin-password',requireRole('admin'),(req,res)=>{const current=String(req.body?.currentPassword||'');const next=String(req.body?.newPassword||'');if(next.length<6)return res.status(400).json({ok:false,error:'New password must be at least 6 characters'});if(!verifyPassword(current,store.admin.passwordHash))return res.status(401).json({ok:false,error:'Current password is incorrect'});store.admin.passwordHash=hashPassword(next);saveStore();audit('admin.password_change',req);res.json({ok:true});});
app.patch('/api/admin/settings',requireRole('admin'),(req,res)=>{store.settings={...store.settings,...req.body,site:{...store.settings.site,...(req.body.site||{})},sections:{...store.settings.sections,...(req.body.sections||{})},ai:{...store.settings.ai,...(req.body.ai||{}),prompts:{...store.settings.ai.prompts,...(req.body.ai?.prompts||{})}},tts:{...store.settings.tts,...(req.body.tts||{})},publishing:{...store.settings.publishing,...(req.body.publishing||{})},theme:{...store.settings.theme,...(req.body.theme||{})}};audit('settings.update',req);res.json({ok:true,settings:store.settings});});
app.get('/api/admin/writers',requireRole('admin'),(_req,res)=>res.json({ok:true,writers:store.writers.map(({passwordHash,...w})=>w)}));
app.post('/api/admin/writers',requireRole('admin'),(req,res)=>{const {username,email,password,name,role='writer'}=req.body||{};if(!username||!password||!name)return res.status(400).json({ok:false,error:'Name, username and password are required'});if(store.writers.some(w=>w.username===username||w.email===email))return res.status(409).json({ok:false,error:'Writer already exists'});const w={id:uid('writer'),username:safeText(username,80),email:safeText(email,160),name:safeText(name,120),role:['writer','editor'].includes(role)?role:'writer',status:'active',createdAt:now(),lastLoginAt:null,passwordHash:hashPassword(password)};store.writers.push(w);audit('writer.create',req,{writerId:w.id});res.json({ok:true,writer:{...w,passwordHash:undefined}});});
app.patch('/api/admin/writers/:id',requireRole('admin'),(req,res)=>{const w=store.writers.find(x=>x.id===req.params.id);if(!w)return res.status(404).json({ok:false,error:'Writer not found'});for(const k of ['username','email','name','status'])if(req.body[k]!==undefined)w[k]=safeText(req.body[k],160);if(req.body.role!==undefined)w.role=['writer','editor'].includes(req.body.role)?req.body.role:w.role;if(req.body.password)w.passwordHash=hashPassword(req.body.password);saveStore();audit('writer.update',req,{writerId:w.id});const {passwordHash,...publicW}=w;res.json({ok:true,writer:publicW});});
app.delete('/api/admin/writers/:id',requireRole('admin'),(req,res)=>{store.writers=store.writers.filter(x=>x.id!==req.params.id);audit('writer.delete',req,{writerId:req.params.id});res.json({ok:true});});
app.get('/api/admin/sources',requireRole('admin'),(_req,res)=>res.json({ok:true,sources:getFeeds(),custom:store.sources.custom,overrides:store.sources.overrides}));
app.post('/api/admin/sources',requireRole('admin'),(req,res)=>{const {name,url,category='Nigeria',region='Nigeria'}=req.body||{};if(!name||!url)return res.status(400).json({ok:false,error:'Name and URL are required'});store.sources.custom.push({name:safeText(name,120),url:safeText(url,500),category:safeText(category,60),region:safeText(region,60),enabled:true,builtin:false});saveStore();audit('source.create',req,{name});res.json({ok:true});});
app.patch('/api/admin/sources',requireRole('admin'),(req,res)=>{const {name,...patch}=req.body||{};if(!name)return res.status(400).json({ok:false,error:'Source name required'});const exists=BUILTIN_FEEDS.some(x=>x.name===name)||store.sources.custom.some(x=>x.name===name);if(!exists)return res.status(404).json({ok:false,error:'Source not found'});store.sources.overrides[name]={...(store.sources.overrides[name]||{}),...patch};saveStore();audit('source.update',req,{name});res.json({ok:true});});
app.delete('/api/admin/sources/:name',requireRole('admin'),(req,res)=>{const n=decodeURIComponent(req.params.name);store.sources.custom=store.sources.custom.filter(x=>x.name!==n);delete store.sources.overrides[n];saveStore();audit('source.delete',req,{name:n});res.json({ok:true});});
app.post('/api/admin/refresh',requireRole('admin','editor'),async(req,res)=>{try{const c=await refreshNews();audit('news.refresh',req);res.json({ok:true,updatedAt:new Date(c.updatedAt).toISOString(),count:c.items.length});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get('/api/admin/stories',requireRole('admin','editor'),(_req,res)=>res.json({ok:true,stories:store.stories}));
app.post('/api/admin/generate-image',requireRole('admin','editor'),async(req,res)=>{try{res.json({ok:true,image:await proxyImage(safeText(req.body?.prompt,2048))});}catch(e){res.status(502).json({ok:false,error:e.message});}});

app.get('/article',(req,res)=>res.sendFile(path.join(__dirname,'public','article.html')));
app.get('/Admin.html',(req,res)=>res.redirect('/admin'));
app.get('/Writer.html',(req,res)=>res.redirect('/writer'));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin-login.html')));
app.get('/admin/login',(req,res)=>res.sendFile(path.join(__dirname,'public','admin-login.html')));
app.get('/admin/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public','Admin.html')));
app.get('/writer',(req,res)=>res.sendFile(path.join(__dirname,'public','writer-login.html')));
app.get('/writer-login',(req,res)=>res.sendFile(path.join(__dirname,'public','writer-login.html')));
app.get('/writer/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'public','Writer.html')));
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));

async function boot(){try{await refreshNews();}catch(e){console.error('[boot news]',e);}setInterval(()=>refreshNews().catch(e=>console.error('[refresh]',e)),60*1000);app.listen(PORT,'0.0.0.0',()=>console.log(`THE VOICE REPORTER running on 0.0.0.0:${PORT}`));}
boot().catch(e=>{console.error(e);process.exit(1);});
