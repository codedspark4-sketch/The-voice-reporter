# THE VOICE REPORTER — Full Newsroom Build

This package adds the complete public newsroom, protected Admin Center, protected Writer Workspace, original story publishing, writer approval workflow, RSS source management, AI controls using the existing StudentNija proxy, article reader, Next/Previous News Flow, AI article tools, browser narration, system checks, and activity logging.

## Existing AI proxy
The application uses exactly:

`https://studentnija-proxy-v2.donchester111.workers.dev`

No change is required in the proxy.

## Routes

Public: `/`

Article reader: `/article`

Admin login: `/admin`

Admin dashboard: `/admin/dashboard`

Writer login: `/writer`

Writer workspace: `/writer/dashboard`

## Administrator

The supplied administrator password is stored as a one-way scrypt hash in the server-side data store. The first run creates `data/store.json`; the default administrator username is `admin`. The Admin Center includes password change controls.

## Persistence

Editorial data, writer accounts, source overrides, settings, and audit records are stored in `data/store.json`. The directory is created automatically. For a permanent production setup on Render, attach persistent storage or move this store to a managed database when the project is ready for that infrastructure change.

## TTS

Article narration uses the browser SpeechSynthesis interface, selecting an available English voice and using the Admin defaults for rate and volume. This requires no additional provider key and keeps the TTS system independent of the offline Sonia/Piper project.
