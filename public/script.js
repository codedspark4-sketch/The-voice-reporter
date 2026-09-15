"use strict";

const state = {
  news: [],
  lastUpdated: null,
  refreshTimer: null,
  loading: false
};

const REFRESH_MS = 60 * 1000;

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindUI();
  loadNews(true);
  state.refreshTimer = setInterval(() => loadNews(false), REFRESH_MS);
});

function bindUI() {
  const menuBtn = document.getElementById("menuBtn");
  const mobileNav = document.getElementById("mobileNav");
  menuBtn?.addEventListener("click", () => mobileNav.classList.toggle("open"));
  mobileNav?.querySelectorAll("a").forEach(a => a.addEventListener("click", () => mobileNav.classList.remove("open")));

  document.getElementById("themeBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("voice-reporter-theme", document.body.classList.contains("dark") ? "dark" : "light");
  });

  document.getElementById("searchBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("searchPanel");
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) document.getElementById("searchInput")?.focus();
  });

  document.getElementById("searchInput")?.addEventListener("input", e => {
    renderSearch(e.target.value.trim().toLowerCase());
  });

  document.getElementById("refreshBtn")?.addEventListener("click", () => loadNews(true));

  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      document.getElementById("searchPanel").classList.add("open");
      document.getElementById("searchInput")?.focus();
    }
    if (e.key === "Escape") document.getElementById("searchPanel").classList.remove("open");
  });
}

function initTheme() {
  if (localStorage.getItem("voice-reporter-theme") === "dark") {
    document.body.classList.add("dark");
  }
}

async function loadNews(showToast) {
  if (state.loading) return;
  state.loading = true;
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const res = await fetch("/api/news?limit=160&ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("News service returned " + res.status);
    const data = await res.json();

    state.news = Array.isArray(data.items) ? data.items : [];
    state.lastUpdated = data.updatedAt ? new Date(data.updatedAt) : new Date();

    renderAll();
    renderSourceStatus(data.sources || {});
    updateTimestamp();

    if (showToast) showToastFn("Live news loaded");
  } catch (err) {
    console.error(err);
    showToastFn("Unable to reach the live news service");
    document.getElementById("footerStatus").textContent = "Live service unavailable";
  } finally {
    state.loading = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function renderAll() {
  const items = state.news;
  renderHero(items[0]);
  renderSide(items.slice(1, 4));
  renderNewsGrid("latestNews", items.slice(0, 10));
  renderTrending(items.slice(0, 8));

  renderCategory("nigeriaGrid", filterCategory(items, "Nigeria"));
  renderCategory("politicsGrid", filterCategory(items, "Politics"));
  renderCategory("businessGrid", filterCategory(items, "Business"));
  renderCategory("technologyGrid", filterCategory(items, "Technology"));
  renderCategory("sportsGrid", filterCategory(items, "Sports"));
  renderCategory("worldGrid", filterCategory(items, "World"));

  renderTicker(items.slice(0, 10));
  document.getElementById("footerStatus").textContent = `${items.length} live headlines loaded`;
}

function renderHero(item) {
  const root = document.getElementById("heroStory");
  if (!item) return;
  root.classList.remove("skeleton-card");
  root.innerHTML = `
    ${imageBlock(item.image, "hero-image")}
    <div class="hero-content">
      <span class="eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.source)}</span>
      <h1>${escapeHtml(item.title)}</h1>
      <p>${escapeHtml(item.description || "Read the full report from the original publisher.")}</p>
      <a class="read-link" href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">Read full story →</a>
    </div>`;
}

function renderSide(items) {
  const root = document.getElementById("sideStories");
  root.innerHTML = items.map(item => `
    <article class="story-card mini">
      ${imageBlock(item.image, "thumb")}
      <div>
        <span>${escapeHtml(item.category)} · ${escapeHtml(item.source)}</span>
        <h3><a href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      </div>
    </article>`).join("");
}

function renderNewsGrid(id, items) {
  const root = document.getElementById(id);
  root.innerHTML = items.length ? items.map(cardHtml).join("") : `<div class="news-card"><div class="news-card-body"><p>No current stories in this section.</p></div></div>`;
}

function renderCategory(id, items) {
  renderNewsGrid(id, items.slice(0, 8));
}

function renderTrending(items) {
  const root = document.getElementById("trendingList");
  root.innerHTML = items.map((item, i) => `
    <article class="trend-item">
      <div class="trend-num">0${i + 1}</div>
      <h4><a href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h4>
      <small>${escapeHtml(item.source)} · ${formatTime(item.publishedAt)}</small>
    </article>`).join("");
}

function renderTicker(items) {
  const root = document.getElementById("tickerTrack");
  root.innerHTML = items.length
    ? items.map(item => `<span>${escapeHtml(item.title)} · ${escapeHtml(item.source)}</span>`).join(" &nbsp; • &nbsp; ")
    : "<span>No live headlines yet.</span>";
}

function renderSearch(q) {
  const root = document.getElementById("searchResults");
  if (!q) {
    root.innerHTML = "";
    return;
  }
  const matches = state.news.filter(n => `${n.title} ${n.description} ${n.source} ${n.category}`.toLowerCase().includes(q)).slice(0, 12);
  root.innerHTML = matches.map(item => `
    <a class="search-item" href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.category)} · ${escapeHtml(item.source)} · ${formatTime(item.publishedAt)}</small>
    </a>`).join("") || `<div class="search-item">No matching live stories.</div>`;
}

function renderSourceStatus(sources) {
  const values = Object.values(sources);
  const ok = values.filter(v => v.ok).length;
  const total = values.length;
  document.getElementById("sourceStatus").textContent = `${ok}/${total} built-in sources responding · automatic refresh every 60 seconds`;
}

function updateTimestamp() {
  const el = document.getElementById("updatedAt");
  if (el && state.lastUpdated) {
    el.textContent = "Updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

function filterCategory(items, category) {
  const x = category.toLowerCase();
  return items.filter(item => (item.category || "").toLowerCase() === x);
}

function cardHtml(item) {
  return `
    <article class="news-card">
      ${imageBlock(item.image, "news-image")}
      <div class="news-card-body">
        <div class="meta">${escapeHtml(item.category)} · ${escapeHtml(item.source)}</div>
        <h3><a href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
        <p>${escapeHtml(item.description || "")}</p>
        <div class="byline">${formatTime(item.publishedAt)}</div>
        <a class="read-link" href="${articleUrl(item.link)}" target="_blank" rel="noopener noreferrer">Read full story →</a>
      </div>
    </article>`;
}

function imageBlock(url, className) {
  const clean = safeUrl(url || "");
  return `<div class="${className} ${clean ? "" : "placeholder-image"}" ${clean ? `style="background-image:url('${clean}')"` : ""}></div>`;
}

function formatTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "Latest";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function articleUrl(value) {
  return "/article?url=" + encodeURIComponent(String(value || ""));
}

function safeUrl(value) {
  try {
    const u = new URL(value, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href.replace(/'/g, "%27");
  } catch (_) {}
  return "#";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

let toastTimer = null;
function showToastFn(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
