# THE VOICE REPORTER — LIVE NEWS EDITION

This package turns THE VOICE REPORTER into a live news platform.

## What is included

- `public/index.html` — THE VOICE REPORTER interface
- `public/style.css` — styling
- `public/script.js` — live frontend, search, theme, refresh
- `server.js` — built-in live-news collection service
- `package.json` — Node.js dependencies

## Built-in sources

The source registry is hard-coded in `server.js`. There is no RSS-entry form and no API-key screen.

Nigeria sources include PUNCH, Premium Times, Guardian Nigeria, Tribune Online, The Nation, Daily Post, Legit.ng and Sahara Reporters.

International sources include BBC World, Al Jazeera, DW, France 24, The Guardian World, New York Times World, NPR, Sky News, NHK and CBC. Technology/business sources are also included.

## Live update behavior

The server polls the built-in feeds every 60 seconds. The browser asks the local `/api/news` endpoint every 60 seconds and can also refresh immediately with the "Refresh now" button.

The actual update speed depends on how quickly each publisher updates its own feed.

## Deploy to Render

This package includes `render.yaml` for Render. Render can deploy the repository as a Node.js Web Service using `npm install` and `npm start`. The server binds to `0.0.0.0` and uses Render's `PORT` environment variable. Render documents these requirements for public web services. citehttps://render.com/docs/web-services

1. Put this folder in a GitHub/GitLab repository.
2. In Render, choose **New → Blueprint** and connect the repository.
3. Render will read `render.yaml` and create the web service.
4. After deployment, open the generated `onrender.com` URL.

You can also create a Web Service manually with:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open:

`http://localhost:3000`

## Important

The site links users to the original publisher for the full story. It does not claim syndicated headlines as original reporting.

Some publishers may occasionally block automated requests or temporarily fail; the server records those failures while continuing to load all other sources.
