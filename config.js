// public/config.js
// Load this FIRST in every HTML page, before any other script.

window.TVR_API_BASE = 'https://the-voice-reporter.onrender.com';

// Always sends cookies. Always targets the API origin.
window.tvrFetch = function (path, opts = {}) {
  const url = /^https?:/i.test(path) ? path : (window.TVR_API_BASE + path);
  return fetch(url, { credentials: 'include', ...opts });
};

// Resolve an asset URL against the correct origin.
//   Absolute URLs pass through.
//   /uploads/* belongs to the API.
//   Everything else (e.g. /ngc.png) belongs to the frontend.
window.tvrResolveAsset = function (v) {
  if (!v) return '';
  if (/^https?:/i.test(v)) return v;
  if (String(v).startsWith('/uploads/')) return window.TVR_API_BASE + v;
  try {
    const u = new URL(v, location.origin);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch { return ''; }
};