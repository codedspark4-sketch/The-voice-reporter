THE VOICE REPORTER — HOME NEWS DELIVERY FIX

Built from the exact Library archive THE_VOICE_REPORTER_COMPLETE_FIXED.zip.

Changes:
1. Added /api/news-lite with a small public card payload so the homepage does not receive full editorial article bodies.
2. /api/news now uses the same safe limited public payload.
3. Homepage first calls /api/news-lite, then falls back to /api/news, then asks /api/refresh and retries.
4. Homepage separates API-loading errors from rendering errors so a UI bug cannot masquerade as “News service unavailable”.
5. Server now starts listening immediately, initializes cache from published editorial stories, then refreshes RSS asynchronously. This prevents startup news-refresh delays from blocking public API availability.
6. Admin/Writer story changes continue to call refreshNews(), so published changes reach the public feed.
7. No AI image-generation feature was added or reintroduced.

Validation:
- node --check server.js: PASS
- node --check public/script.js: PASS
