use strict';

const PROXY_URL = "https://studentnija-proxy-v2.donchester111.workers.dev";
const REFRESH_MS = 60 * 1000;

const state = {
  news: [],
  updatedAt: null,
  timer: null,
  loading: false,
  theme: "light"
};

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindUI();
  loadNews(true);
  state.timer = setInterval(() => loadNews(false), REFRESH_MS);
});

function $(id) {
  return document.getElementById(id);
}

function bindUI() {
  $("menuBtn")?.addEventListener("click", () => {
    const nav = $("mobileNav");
    if (!nav) return;
    const open = nav.classList.toggle("open");
    $("menuBtn").setAttribute("aria-expanded", String(open));
  });

  $("mobileNav")?.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => {
      $("mobileNav")?.classList.remove("open");
      $("menuBtn")?.setAttribute("aria-expanded", "false");
    });
  });

  $("themeBtn")?.addEventListener("click", toggleTheme);
  $("searchBtn")?.addEventListener("click", toggleSearch);
  $("refreshBtn")?.addEventListener("click", () => loadNews(true));

  $("searchInput")?.addEventListener("input", e => {
    renderSearch(String(e.target.value || "").trim().toLowerCase());
  });

  $("askAiBtn")?.addEventListener("click", askNewsDesk);
  $("clearAiBtn")?.addEventListener("click", () => {
    $("aiQuestion").value = "";
    $("aiAnswer").innerHTML = '<span class="answer-placeholder">Your answer will appear here.</span>';
  });

  document.addEventListener("keydown", e => {
    const tag = document.activeElement?.tagName || "";
    if (e.key === "/" && !/INPUT|TEXTAREA/i.test(tag)) {
      e.preventDefault();
      openSearch();
    }
    if (e.key === "Escape") {
      $("searchPanel")?.classList.remove("open");
    }
  });
}

function initTheme() {
  const saved = localStorage.getItem("voice-reporter-theme");
  state.theme = saved === "dark" ? "dark" : "light";
  applyTheme();
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("voice-reporter-theme", state.theme);
  applyTheme();
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
  const icon = $("themeIcon");
  const btn = $("themeBtn");
  if (state.theme === "dark") {
    if (icon) icon.textContent = "☀";
    btn?.setAttribute("aria-label", "Switch to day mode");
    btn?.setAttribute("title", "Switch to day mode");
  } else {
    if (icon) icon.textContent = "☾";
    btn?.setAttribute("aria-label", "Switch to night mode");
    btn?.setAttribute("title", "Switch to night mode");
  }
}

function toggleSearch() {
  const panel = $("searchPanel");
  if (!panel) return;
  const open = panel.classList.toggle("open");
  if (open) openSearch();
}

function openSearch() {
  $("searchPanel")?.classList.add("open");
  $("searchInput")?.focus();
}

async function loadNews(showToast) {
  if (state.loading) return;
  state.loading = true;
  $("refreshBtn")?.setAttribute("disabled", "disabled");

  try {
    const res = await fetch(`/api/news?limit=160&ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`News service returned ${res.status}`);
    const data = await res.json();

    state.news = Array.isArray(data.items) ? data.items : [];
    state.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();

    renderAll();
    renderSourceStatus(data.sources || {});
    updateTimes();

    if (showToast) toast("Live news loaded");
  } catch (err) {
    console.error(err);
    $("footerStatus").textContent = "Live service unavailable";
    toast("Unable to reach the live news service");
  } finally {
    state.loading = false;
    $("refreshBtn")?.removeAttribute("disabled");
  }
}

function renderAll() {
  const items = state.news;
  renderHero(items[0]);
  renderSide(items.slice(1, 5));
  renderNewsGrid("latestNews", items.slice(0, 9));
  renderTrending(items.slice(0, 8));

  renderCategory("nigeriaGrid", "Nigeria", 8);
  renderCategory("politicsGrid", "Politics", 8);
  renderCategory("businessGrid", "Business", 8);
  renderCategory("technologyGrid", "Technology", 8);
  renderCategory("sportsGrid", "Sports", 8);
  renderCategory("worldGrid", "World", 8);

  renderTicker(items.slice(0, 14));
  $("footerStatus").textContent = `${items.length} live headlines loaded`;
}

function renderHero(item) {
  const root = $("heroStory");
  if (!root) return;
  if (!item) {
    root.innerHTML = `
      <div class="hero-media placeholder-art"><span>THE VOICE REPORTER</span></div>
      <div class="hero-body"><div class="story-meta">LIVE NEWS</div><h1>No current headline</h1><p>The newsroom is waiting for a live update.</p></div>`;
    return;
  }

  root.innerHTML = `
    ${mediaHtml(item, "hero-media")}
    <div class="hero-body">
      <div class="story-meta">${escapeHtml(item.category)} · ${escapeHtml(item.source)}</div>
      <h1>${escapeHtml(item.title)}</h1>
      <p>${escapeHtml(item.description || "Read the full report from the original publisher.")}</p>
      <div class="hero-actions">
        <a class="primary-link" href="${articleUrl(item.link)}">Read full story</a>
        <span class="story-time">${formatTime(item.publishedAt)}</span>
      </div>
    </div>`;
}

function renderSide(items) {
  const root = $("sideStories");
  if (!root) return;

  if (!items.length) {
    root.innerHTML = `<div class="empty-card">More top stories will appear as the newsroom refreshes.</div>`;
    return;
  }

  root.innerHTML = items.map(item => `
    <article class="top-story">
      ${mediaHtml(item, "top-story-image")}
      <div class="top-story-body">
        <div class="story-meta">${escapeHtml(item.category)} · ${escapeHtml(item.source)}</div>
        <a href="${articleUrl(item.link)}"><h3>${escapeHtml(item.title)}</h3></a>
        <time>${formatTime(item.publishedAt)}</time>
      </div>
    </article>`).join("");
}

function renderNewsGrid(id, items) {
  const root = $(id);
  if (!root) return;
  root.innerHTML = items.length
    ? items.map(cardHtml).join("")
    : `<div class="empty-card">No current stories in this section.</div>`;
}

function renderCategory(id, category, limit) {
  const items = state.news.filter(x => String(x.category || "").toLowerCase() === category.toLowerCase());
  renderNewsGrid(id, items.slice(0, limit));
}

function renderTrending(items) {
  const root = $("trendingList");
  if (!root) return;
  root.innerHTML = items.map((item, i) => `
    <a class="trend-row" href="${articleUrl(item.link)}">
      <span>${String(i + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(item.title)}</strong>
    </a>`).join("");
}

function renderTicker(items) {
  const root = $("tickerTrack");
  if (!root) return;
  if (!items.length) {
    root.innerHTML = "<span>Waiting for live headlines…</span>";
    return;
  }

  const chunk = items.map(item => `
    <span class="ticker-item">
      <strong>${escapeHtml(item.source)}</strong>
      ${escapeHtml(item.title)}
    </span>`).join('<b>•</b>');

  root.innerHTML = chunk + '<span class="ticker-gap"></span>' + chunk;
}

function renderSearch(q) {
  const root = $("searchResults");
  if (!root) return;

  if (!q) {
    root.innerHTML = "";
    return;
  }

  const matches = state.news.filter(item => {
    const haystack = `${item.title} ${item.description} ${item.source} ${item.category}`.toLowerCase();
    return haystack.includes(q);
  }).slice(0, 15);

  root.innerHTML = matches.length
    ? matches.map(item => `
      <a class="search-item" href="${articleUrl(item.link)}">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.category)} · ${escapeHtml(item.source)} · ${formatTime(item.publishedAt)}</small>
      </a>`).join("")
    : `<div class="empty-card">No matching stories.</div>`;
}

function renderSourceStatus(sources) {
  const values = Object.values(sources);
  const ok = values.filter(v => v && v.ok).length;
  $("sourceStatus").textContent = values.length
    ? `${ok}/${values.length} live sources responding`
    : "Source status unavailable";
}

function updateTimes() {
  if (state.updatedAt && !Number.isNaN(state.updatedAt.getTime())) {
    $("updatedAt").textContent = `Updated ${state.updatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }
}

function cardHtml(item) {
  return `
    <article class="news-card">
      ${mediaHtml(item, "news-image")}
      <div class="news-card-body">
        <div class="story-meta">${escapeHtml(item.category)} · ${escapeHtml(item.source)}</div>
        <a href="${articleUrl(item.link)}"><h3>${escapeHtml(item.title)}</h3></a>
        <p>${escapeHtml(item.description || "Read the full report from the original publisher.")}</p>
        <div class="card-footer">
          <time>${formatTime(item.publishedAt)}</time>
          <span>Read →</span>
        </div>
      </div>
    </article>`;
}

function mediaHtml(item, className) {
  const url = safeUrl(item?.image || "");
  if (url !== "#") {
    return `<div class="${className}" style="background-image:url('${url}')"></div>`;
  }
  return `<div class="${className} placeholder-art"><span>${escapeHtml(item?.category || "NEWS")}</span></div>`;
}

function formatTime(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "Latest";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function articleUrl(value) {
  return `/article?url=${encodeURIComponent(String(value || ""))}`;
}

function safeUrl(value) {
  try {
    const u = new URL(value, window.location.origin);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href.replace(/'/g, "%27") : "#";
  } catch {
    return "#";
  }
}

async function askNewsDesk() {
  const question = String($("aiQuestion")?.value || "").trim();
  if (!question) {
    $("aiAnswer").innerHTML = '<span class="error">Enter a question first.</span>';
    return;
  }

  $("askAiBtn")?.setAttribute("disabled", "disabled");
  $("aiAnswer").innerHTML = '<span class="loading">The News Desk is thinking…</span>';

  const headlines = state.news.slice(0, 16).map(x => ({
    title: x.title,
    source: x.source,
    category: x.category,
    publishedAt: x.publishedAt,
    description: x.description
  }));

  const system = [
    "You are THE VOICE REPORTER AI News Desk.",
    "Give concise, factual newsroom-style answers.",
    "Use the supplied live headlines as context.",
    "Do not invent facts that are not supported by the supplied context.",
    "When the question requires current web research, say that current web research is needed rather than pretending the supplied headlines are exhaustive."
  ].join(" ");

  try {
    const res = await fetch(`${PROXY_URL}/chat`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        system,
        messages: [
          {
            role: "user",
            content: `${question}\n\nLIVE HEADLINES:\n${JSON.stringify(headlines)}`
          }
        ],
        temperature: 0.2,
        max_tokens: 900
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "AI request failed");

    $("aiAnswer").innerHTML = `
      <div class="answer-text">${escapeHtml(data.text || "No answer returned.")}</div>
      <small>${escapeHtml(data.modelLabel || data.model || "AI News Desk")}</small>`;
  } catch (err) {
    console.error(err);
    $("aiAnswer").innerHTML = `<span class="error">The AI News Desk is unavailable right now.</span>`;
  } finally {
    $("askAiBtn")?.removeAttribute("disabled");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}
