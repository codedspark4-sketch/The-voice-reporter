window.TVR_API_BASE = 'https://the-voice-reporter.onrender.com';

window.tvrFetch = function (path, opts = {}) {
  const url = /^https?:/i.test(path) ? path : (window.TVR_API_BASE + path);
  return fetch(url, { credentials: 'include', ...opts });
};

window.tvrResolveAsset = function (v) {
  if (!v) return '';
  if (/^https?:/i.test(v)) return v;
  if (String(v).startsWith('/uploads/')) return window.TVR_API_BASE + v;
  try { const u = new URL(v, location.origin); return /^https?:$/.test(u.protocol) ? u.href : ''; }
  catch { return ''; }
};