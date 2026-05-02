# MangaVault

A production-style manga crawler and web reader built with Next.js, Playwright, MongoDB, and Cloudinary.

This project lets you:
- crawl manga metadata + chapters from target source URLs
- run long crawls as background jobs with live progress
- survive Cloudflare checks via FlareSolverr-assisted session recovery
- read crawled content through a clean library, manga detail, and chapter reader UI

## Why This Project Is Useful

Most crawler demos stop at "download HTML and print text." This app goes further:
- robust crawl lifecycle with `start`, `status`, `stop`, and `resume`
- chapter/page persistence in MongoDB with stable slugs and queryable metadata
- image hosting pipeline to Cloudinary (with source URL fallback on failures)
- real admin dashboard for operators, not just one-off scripts

## Tech Stack

- Next.js 14 (App Router, TypeScript)
- Playwright (Chromium automation)
- MongoDB + Mongoose
- Cloudinary (image storage and delivery)
- Tailwind CSS

## Architecture Overview

```text
Admin UI (/admin)
  -> POST /api/crawl
      -> create crawl job in MongoDB
      -> run crawler in background
      -> persist per-URL progress + logs
  -> GET /api/crawl/status?jobId=...
      -> stream current progress
  -> POST /api/crawl/stop
      -> abort running job

Crawler pipeline per manga URL:
  1) open source page with Playwright
  2) pass Cloudflare checks (FlareSolverr + cookie injection + retries)
  3) scrape manga metadata + chapter links
  4) scrape each chapter's page images
  5) upload images to Cloudinary
  6) save Manga + Chapter docs in MongoDB

Reader UI:
  /               -> library
  /manga/[slug]   -> metadata + chapter list
  /manga/[slug]/chapter/[num] -> reader (scroll/page mode)
```

## Quick Start

### 1) Prerequisites

- Node.js 18+ (Node.js 20 recommended)
- MongoDB (local or hosted)
- Cloudinary account (recommended for durable image hosting)
- FlareSolverr (recommended when source is Cloudflare protected)

### 2) Install

```bash
npm install
npx playwright install chromium
```

### 3) Configure environment

Create `.env.local`:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/manga

# Recommended (image hosting)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Cloudflare solver
FLARESOLVERR_URL=http://localhost:8191/v1

# Crawler runtime
CRAWLER_HEADLESS=false
CRAWLER_USE_PERSISTENT_PROFILE=true
CRAWLER_IMAGE_CONCURRENCY=4
CRAWLER_IMAGE_DELAY_MS=0
CRAWLER_CHAPTER_DELAY_MIN_MS=500
CRAWLER_CHAPTER_DELAY_MAX_MS=1200
CRAWLER_COOLDOWN_EVERY_CHAPTERS=10
CRAWLER_COOLDOWN_MIN_MS=15000
CRAWLER_COOLDOWN_MAX_MS=45000
CRAWLER_HUMAN_BEHAVIOR=false

# Cloudflare recovery
CRAWLER_CF_RECOVERY=true
CRAWLER_CF_RECOVERY_RETRIES=2
CRAWLER_CF_RECOVERY_COOLDOWN_MS=8000

# Optional proxy
PROXY_SERVER=
PROXY_USER=
PROXY_PASS=
```

### 4) Run

```bash
npm run dev
```

Open:
- `http://localhost:3000/admin` to manage crawl jobs
- `http://localhost:3000/` to browse crawled manga

## FlareSolverr Setup (Optional, but Highly Recommended)

If your source frequently triggers Cloudflare checks, run FlareSolverr:

```bash
docker run -d --name flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
docker ps
docker start flaresolverr
docker logs -f flaresolverr
```

Then keep:

```env
FLARESOLVERR_URL=http://localhost:8191/v1
```
Test
```Test it
$body = @{
  cmd = "request.get"
  url = "https://yourwebsite"
  maxTimeout = 60000
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:8191/v1" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

## API Reference

### Crawl Jobs

- `POST /api/crawl`
  - start new job: `{ "urls": ["https://..."] }`
  - resume job: `{ "jobId": "job_..." }`
  - returns: `{ jobId, status, urls }`

- `GET /api/crawl/status?jobId=job_...`
  - returns job status, per-URL progress map, and recent logs

- `GET /api/crawl/active`
  - returns latest running job id: `{ jobId }` or `{ jobId: null }`

- `POST /api/crawl/stop`
  - payload: `{ "jobId": "job_..." }`
  - marks job cancelled and aborts active controller

### Reader Data

- `GET /api/manga?page=1&limit=24&search=&tag=`
  - paginated manga list

- `GET /api/manga/[slug]`
  - manga detail + available done chapters

- `GET /api/manga/[slug]/chapter/[num]`
  - chapter pages + prev/next chapter navigation

### Admin Settings

- `GET /api/admin/settings`
  - returns saved URL textarea content

- `POST /api/admin/settings`
  - payload: `{ "urlsText": "..." }`
  - persists shared admin URL list

## Data Model (MongoDB Collections)

- `mangas18`
  - core manga metadata, crawl status, source and cover fields

- `chapters18`
  - chapter metadata and page URLs (`originalUrl` + `cloudinaryUrl`)

- `crawljobs18`
  - crawl job states (`running`, `done`, `error`, `cancelled`), progress, logs

- `adminsettings18`
  - shared admin input state (`urlsText`)

## Project Structure

```text
src/
  app/
    admin/page.tsx                       # crawl dashboard
    page.tsx                             # library UI
    manga/[slug]/page.tsx                # manga details
    manga/[slug]/chapter/[num]/page.tsx  # chapter reader
    api/
      crawl/*                            # job lifecycle endpoints
      manga/*                            # reader data endpoints
      admin/settings/route.ts            # admin URL persistence
  lib/
    crawler.ts                           # core crawling + Cloudflare recovery
    jobStore.ts                          # crawl job persistence
    crawlControl.ts                      # in-memory abort controllers
    mongodb.ts                           # DB connection cache
    cloudinary.ts                        # image upload utilities
  models/
    index.ts                             # mongoose schemas/models
```

## Cloudflare Debug Artifacts

When Cloudflare blocks a navigation, the crawler writes snapshots:
- `cloudflare-blocked.html`
- `cloudflare-blocked.png`

It also persists session helpers:
- `.cf_cookies_....json`
- `.cf_user_agent_....txt`
- `.browser-profile-.../`

These files are useful for diagnosing challenge failures and improving retry strategy.

## Operational Notes

- Resume behavior is idempotent-friendly: already completed chapters can be skipped.
- Job abort controllers are in-memory; on server restart, active runtime controllers are reset.
- If Cloudinary upload fails for an image, crawler falls back to source image URL.
- Source-specific selectors may need updates when target site markup changes.

## Responsible Usage

Use this project only where you are authorized to crawl and store content. Respect:
- site terms of service
- copyright and content ownership
- rate limits and server load constraints

