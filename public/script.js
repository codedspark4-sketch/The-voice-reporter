(function () {
  "use strict";

  const REFRESH_MS = 60 * 1000;
  const state = {
    news: [],
    settings: null,
    updatedAt: null,
    loading: false,
    configLoaded: false,
    userTheme: localStorage.getItem("tvr-theme") || "system"
  };

  const $ = id => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", async () => {
    bindUI();
    await loadConfig();
    applyTheme();
    loadNews(true);
    setInterval(() => loadNews(false), REFRESH_MS);
  });

  function bindUI() {
    $("menuBtn")?.addEventListener("click", () => {
      const nav = $("mobileNav");
      const open = nav.classList.toggle("open");
      $("menuBtn").setAttribute("aria-expanded", String(open));
    });

    $("mobileNav")?.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        $("mobileNav").classList.remove("open");
        $("menuBtn").setAttribute("aria-expanded", "false");
      });
    });

    $("themeBtn")?.addEventListener("click", cycleTheme);

    $("searchBtn")?.addEventListener("click", () => {
      const p = $("searchPanel");
      p.classList.toggle("open");
      if (p.classList.contains("open")) $("searchInput")?.focus();
    });

    $("searchInput")?.addEventListener("input", e => {
      renderSearch(String(e.target.value || "").trim().toLowerCase());
    });

    $("refreshBtn")?.addEventListener("click", () => loadNews(true));
    $("deskAsk")?.addEventListener("click", () => askDesk(false));
    $("briefBtn")?.addEventListener("click", () => askDesk(true));
    $("deskClear")?.addEventListener("click", () => {
      $("deskQuestion").value = "";
      $("deskAnswer").innerHTML = '<span class="muted">Your answer will appear here.</span>';
    });

    document.addEventListener("keydown", e => {
      const tag = document.activeElement?.tagName || "";
      if (e.key === "/" && !/INPUT|TEXTAREA/i.test(tag)) {
        e.preventDefault();
        $("searchPanel").classList.add("open");
        $("searchInput")?.focus();
      }
      if (e.key === "Escape") $("searchPanel")?.classList.remove("open");
    });
  }

  async function loadConfig() {
    try {
      const r = await fetch("/api/config?ts=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("Config unavailable");
      const d = await r.json();
      state.settings = d.settings || {};
      state.configLoaded = true;
      applySiteSettings();
    } catch (e) {
      console.warn("[home config]", e);
      state.settings = {
        site: { title: "THE VOICE REPORTER", tagline: "REAL NEWS • NIGERIA • WORLD", tickerEnabled: true, tickerSpeed: 24 },
        sections: { latest:true,nigeria:true,politics:true,business:true,technology:true,sports:true,world:true,mostReported:true,aiDesk:true,brief:true },
        ai: { enabled:true, chat:true },
        tts: { enabled:true, rate:1, pitch:1, volume:1 },
        theme: { default:"system" }
      };
    }
  }

  function applySiteSettings() {
    const s = state.settings || {};
    $("brandTitle").textContent = s.site?.title || "THE VOICE REPORTER";
    $("brandTagline").textContent = s.site?.tagline || "REAL NEWS • NIGERIA • WORLD";
    document.title = s.site?.title || "THE VOICE REPORTER";

    const sections = s.sections || {};
    setVisible("#latest", sections.latest !== false);
    setVisible("#nigeria", sections.nigeria !== false);
    setVisible("#politics", sections.politics !== false);
    setVisible("#business", sections.business !== false);
    setVisible("#technology", sections.technology !== false);
    setVisible("#sports", sections.sports !== false);
    setVisible("#world", sections.world !== false);
    setVisible("#mostReported", sections.mostReported !== false);
    setVisible("#newsdesk", sections.aiDesk !== false && s.ai?.enabled !== false);

    const briefButton = $("briefBtn");
    if (briefButton) briefButton.hidden = sections.brief === false || s.ai?.enabled === false;

    const tickerEnabled = s.site?.tickerEnabled !== false;
    $("breakingBar").hidden = !tickerEnabled;

    const speed = Math.max(8, Number(s.site?.tickerSpeed || 24));
    $("tickerTrack").style.animationDuration = speed + "s";
  }

  function setVisible(selector, visible) {
    const el = document.querySelector(selector);
    if (el) el.hidden = !visible;
  }

  function effectiveTheme() {
    if (state.userTheme === "system") {
      const adminDefault = state.settings?.theme?.default;
      if (adminDefault === "dark" || adminDefault === "light") return adminDefault;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return state.userTheme;
  }

  function applyTheme() {
    const theme = effectiveTheme();
    document.body.dataset.theme = theme;

    const icon = $("themeIcon");
    const btn = $("themeBtn");
    if (theme === "dark") {
      icon.textContent = "☀";
      btn.title = "Switch to light mode";
      btn.setAttribute("aria-label", "Switch to light mode");
    } else {
      icon.textContent = "☾";
      btn.title = "Switch to dark mode";
      btn.setAttribute("aria-label", "Switch to dark mode");
    }
  }

  function cycleTheme() {
    const current = effectiveTheme();
    state.userTheme = current === "light" ? "dark" : "light";
    localStorage.setItem("tvr-theme", state.userTheme);
    applyTheme();
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.userTheme === "system") applyTheme();
  });

  async function loadNews(showToast) {
    if (state.loading) return;
    state.loading = true;
    $("refreshBtn")?.setAttribute("disabled", "disabled");

    try {
      const r = await fetch("/api/news?limit=500&t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("News service returned " + r.status);
      const d = await r.json();
      state.news = Array.isArray(d.items) ? d.items : [];
      state.updatedAt = d.updatedAt ? new Date(d.updatedAt) : new Date();

      renderAll(d.sources || {});
      if (showToast) toast("Live newsroom loaded");
    } catch (e) {
      console.error(e);
      $("footerStatus").textContent = "Live service unavailable";
      toast("Unable to reach the live news service");
    } finally {
      state.loading = false;
      $("refreshBtn")?.removeAttribute("disabled");
    }
  }

  function renderAll(sources) {
    const news = state.news;
    renderHero(news[0]);
    renderSide(news.slice(1, 5));
    renderGrid("latestNews", news.slice(0, 12));
    renderTrending(news.slice(0, 10));

    for (const category of ["Nigeria","Politics","Business","Technology","Sports","World"]) {
      const id = category.toLowerCase() + "Grid";
      const stories = news.filter(x => String(x.category || "").toLowerCase() === category.toLowerCase()).slice(0, 8);
      renderGrid(id, stories);
    }

    renderGrid("mostReportedGrid", mostReported(news).slice(0, 8));
    renderTicker(news.slice(0, 16));

    const vals = Object.values(sources || {});
    $("sourceStatus").textContent = vals.length
      ? `${vals.filter(x => x.ok).length}/${vals.length} configured sources responding`
      : "Source status unavailable";

    $("footerStatus").textContent = `${news.length} current stories loaded`;
    updateTimestamp();
  }

  function renderHero(x) {
    const root = $("heroStory");
    if (!x) {
      root.innerHTML = `<div class="loading-block">No current stories are available.</div>`;
      return;
    }

    root.innerHTML = `
      ${imageBlock(x.image, x.category, "hero-image")}
      <div class="hero-content">
        <div class="story-meta">${badges(x)}</div>
        <h1>${esc(x.title)}</h1>
        <p>${esc(x.description || "Open the full report in the THE VOICE REPORTER reader.")}</p>
        <div class="hero-actions">
          <a class="primary-link" href="${articleUrl(x)}">Read full story →</a>
          <button class="soft-btn" data-listen="${esc(x.id)}">▶ Listen</button>
          <button class="soft-btn" data-brief="${esc(x.id)}">AI Brief</button>
        </div>
      </div>`;
  }

  function renderSide(items) {
    $("sideStories").innerHTML = items.length ? items.map(x => `
      <article class="side-story">
        ${imageBlock(x.image, x.category, "side-story-image")}
        <div class="side-story-body">
          <div class="story-meta">${badges(x)}</div>
          <a href="${articleUrl(x)}"><h3>${esc(x.title)}</h3></a>
          <time>${formatTime(x.publishedAt)}</time>
        </div>
      </article>`).join("") : `<div class="loading-block">More top stories will appear as the newsroom refreshes.</div>`;
  }

  function renderGrid(id, items) {
    const root = $(id);
    if (!root) return;
    root.innerHTML = items.length ? items.map(card).join("") : `<div class="empty-card">No stories in this section right now.</div>`;
  }

  function card(x) {
    return `
      <article class="news-card">
        ${imageBlock(x.image, x.category, "news-image")}
        <div class="news-card-body">
          <div class="story-meta">${badges(x)} · ${esc(x.source || "THE VOICE REPORTER")}</div>
          <a href="${articleUrl(x)}"><h3>${esc(x.title)}</h3></a>
          <p>${esc(x.description || "")}</p>
          <div class="card-footer">
            <time>${formatTime(x.publishedAt)}</time>
            <span>${x.editorial ? "ORIGINAL" : "READ →"}</span>
          </div>
          <div class="card-actions">
            <a class="read-link" href="${articleUrl(x)}">Read</a>
            <button class="mini-btn" data-listen="${esc(x.id)}">Listen</button>
            <button class="mini-btn" data-brief="${esc(x.id)}">AI Brief</button>
          </div>
        </div>
      </article>`;
  }

  document.addEventListener("click", async e => {
    const listenBtn = e.target.closest("[data-listen]");
    const briefBtn = e.target.closest("[data-brief]");

    if (listenBtn) {
      const story = state.news.find(x => x.id === listenBtn.dataset.listen);
      if (story) speakStory(story);
    }

    if (briefBtn) {
      const story = state.news.find(x => x.id === briefBtn.dataset.brief);
      if (story) quickBrief(story, briefBtn);
    }
  });

  function speakStory(story) {
    if (state.settings?.tts?.enabled === false) {
      toast("Story narration is disabled by the administrator.");
      return;
    }
    if (!("speechSynthesis" in window)) {
      toast("Text-to-speech is not supported by this browser.");
      return;
    }

    speechSynthesis.cancel();
    const text = [
      story.title,
      story.description || "",
      story.editorial ? story.body : ""
    ].filter(Boolean).join(". ");

    const u = new SpeechSynthesisUtterance(stripHtml(text));
    u.rate = Number(state.settings?.tts?.rate || 1);
    u.pitch = Number(state.settings?.tts?.pitch || 1);
    u.volume = Number(state.settings?.tts?.volume ?? 1);

    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => /en-NG/i.test(v.lang))
      || voices.find(v => /^en(-|_)/i.test(v.lang))
      || voices[0];

    if (preferred) u.voice = preferred;
    speechSynthesis.speak(u);
    toast("Playing story");
  }

  async function quickBrief(story, button) {
    button.disabled = true;
    try {
      const d = await postAI("/api/ai/chat", {
        system: state.settings?.ai?.prompts?.brief ||
          "Create a concise newsroom brief from the supplied story. Give the facts, why it matters, what is known, and what remains uncertain.",
        messages: [{
          role: "user",
          content: `Create a concise quick brief for this story.\n\nHeadline: ${story.title}\nSource: ${story.source || "THE VOICE REPORTER"}\nPublished: ${story.publishedAt}\nDescription: ${story.description || ""}`
        }],
        temperature: 0.2,
        max_tokens: 700
      });

      toast(d.text || d.error || "AI unavailable");
    } catch {
      toast("AI brief unavailable right now");
    } finally {
      button.disabled = false;
    }
  }

  async function askDesk(isBrief) {
    const answer = $("deskAnswer");
    const configured = state.settings || {};
    if (configured.ai?.enabled === false || configured.ai?.chat === false) {
      answer.innerHTML = '<span class="error">The AI News Desk is disabled by the administrator.</span>';
      return;
    }

    const question = $("deskQuestion").value.trim();
    const text = isBrief
      ? "Create a 60-second newsroom brief from the strongest current stories in the supplied context. Prioritize Nigeria first, then world, business and technology."
      : question;

    if (!text) {
      toast("Enter a question first");
      return;
    }

    answer.innerHTML = '<span class="loading">AI newsroom is working…</span>';

    const context = state.news.slice(0, 30).map(x =>
      `• ${x.title} — ${x.source || "THE VOICE REPORTER"} — ${x.description || ""}`
    ).join("\n");

    try {
      const d = await postAI("/api/ai/chat", {
        system: state.settings?.ai?.prompts?.desk ||
          "You are THE VOICE REPORTER AI News Desk. Use only supplied story context unless the user asks for current research. Separate facts from uncertainty and keep the answer useful.",
        messages: [{
          role: "user",
          content: `${text}\n\nCURRENT NEWS CONTEXT:\n${context}`
        }],
        temperature: 0.2,
        max_tokens: 1100
      });

      answer.innerHTML = d.success
        ? `<div class="answer-text">${esc(d.text || "No answer returned.")}</div><small>${esc(d.modelLabel || d.provider || "AI News Desk")}</small>`
        : `<div class="error">${esc(d.error || "AI unavailable")}</div>`;
    } catch {
      answer.innerHTML = '<div class="error">AI unavailable right now.</div>';
    }
  }

  async function postAI(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });

    const d = await r.json();
    if (!r.ok || d.success === false) {
      throw new Error(d.error || "AI request failed");
    }
    return d;
  }

  function renderTrending(items) {
    $("trendingList").innerHTML = items.map((x, i) => `
      <a class="trend-row" href="${articleUrl(x)}">
        <span>${String(i + 1).padStart(2, "0")}</span>
        <strong>${esc(x.title)}</strong>
      </a>`).join("");
  }

  function renderTicker(items) {
    const t = $("tickerTrack");
    if (!items.length) {
      t.textContent = "No live headlines yet.";
      return;
    }

    const row = items.map(x =>
      `<span class="ticker-item"><strong>${esc(x.source || "NEWS")}</strong> ${esc(x.title)}</span>`
    ).join("<b>•</b>");

    t.innerHTML = row + '<span class="ticker-gap"></span>' + row;
  }

  function renderSearch(q) {
    const root = $("searchResults");
    if (!q) {
      root.innerHTML = "";
      return;
    }

    const matches = state.news.filter(x =>
      `${x.title} ${x.description} ${x.source} ${x.category} ${(x.tags || []).join(" ")}`
        .toLowerCase()
        .includes(q)
    ).slice(0, 18);

    root.innerHTML = matches.length
      ? matches.map(x => `<a class="search-item" href="${articleUrl(x)}"><strong>${esc(x.title)}</strong><small>${esc(x.category || "")} · ${esc(x.source || "")} · ${formatTime(x.publishedAt)}</small></a>`).join("")
      : `<div class="empty-card">No matching stories.</div>`;
  }

  function mostReported(items) {
    const buckets = new Map();

    for (const x of items) {
      const words = normalize(x.title).split(" ").filter(w => w.length > 4);
      const key = words.slice(0, 7).join(" ").slice(0, 90);
      if (!key) continue;

      const b = buckets.get(key) || {...x, reportCount: 0};
      b.reportCount++;
      buckets.set(key, b);
    }

    return [...buckets.values()]
      .filter(x => x.reportCount > 1)
      .sort((a, b) => b.reportCount - a.reportCount);
  }

  function imageBlock(url, category, cls) {
    const clean = safeUrl(url);
    if (clean) return `<div class="${cls}" style="background-image:url('${clean}')"></div>`;
    return `<div class="${cls} placeholder-art"><span>${esc(String(category || "NEWS").toUpperCase())}</span></div>`;
  }

  function articleUrl(x) {
    if (x?.editorial) return "/article?id=" + encodeURIComponent(x.id);
    return "/article?url=" + encodeURIComponent(String(x?.link || ""));
  }

  function badges(x) {
    const out = [];
    if (x.isBreaking) out.push("BREAKING");
    else if (x.isDeveloping) out.push("DEVELOPING");
    else if (x.isUpdated) out.push("UPDATED");
    out.push(x.category || "NEWS");
    return out.map(esc).join(" · ");
  }

  function formatTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Latest";
    return d.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  }

  function updateTimestamp() {
    if (state.updatedAt) {
      $("updatedAt").textContent = "Updated " + state.updatedAt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    }
  }

  function normalize(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function safeUrl(v) {
    try {
      const u = new URL(v, location.origin);
      return /^(https?:)$/.test(u.protocol) ? u.href.replace(/'/g, "%27") : "";
    } catch {
      return "";
    }
  }

  function stripHtml(v) {
    const div = document.createElement("div");
    div.innerHTML = String(v || "");
    return div.textContent || div.innerText || "";
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[ch]));
  }

  let toastTimer;
  function toast(message) {
    const t = $("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
})();
