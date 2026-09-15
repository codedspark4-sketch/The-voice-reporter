# THE VOICE REPORTER — Full Integrated Newsroom

This build keeps the existing StudentNija AI proxy URL unchanged and connects the public homepage, article reader, Admin Center and Writer Workspace to one persistent editorial/configuration API.

## Public
- `/`
- `/article?url=...` for RSS publisher articles
- `/article?id=...` for original THE VOICE REPORTER stories

## Administration
- `/admin`
- `/admin/dashboard`

Default administrator username: `admin`
Default administrator password: `463946` unless `ADMIN_PASSWORD` is set before first startup.

## Writers
- `/writer-login`
- `/writer/dashboard`

## Media
Admin and writers can upload normal image/video files through `/api/upload`. There is no AI image-generation feature in this build.

## Fallback images
Nigeria uses `/ngc.png`. Other categories use ordinary internet-hosted fallback image URLs and can be changed from Admin → Site.
