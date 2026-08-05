# Civic Finder

A small app for looking up Chicago civic boundaries and representatives from
either street addresses or latitude/longitude pairs.

## Data Sources

- Boundary polygons and generated representative metadata: static GeoJSON files
  in `public/geojson`
- Representative metadata generator: `npm run generate:data`
- Generated coverage and stale-name reports: `data/generated`
- Address geocoding: U.S. Census Geocoder, current benchmark and vintage

The generator writes normalized `properties.representatives` entries with
per-field status/source metadata for name, email, phone, address, and photo.
Official public sources are split in `data/generated/source-manifest.json`
between robust feeds and brittle scrapes. Robust inputs include static boundary
GeoJSON, the Chicago Data Portal alderperson feed, Clerk/House directories,
ILGA active-member reports, and CPS elected school board GeoJSON. Brittle inputs
are official HTML pages used only where structured feeds do not publish the
field, including CCPSA council pages, CPS board bios, Cook County profiles, and
Cook County Legistar People. If local direct fetches to ILGA time out, the
generator records the reader fallback transport in the manifest; the recorded
source URL remains the official ILGA page.

The app keeps direct contact fields strict: email, phone, and address are only
included when published as an appropriate representative contact route. Official
contact/profile pages are exposed separately as `contactUrl`.

## Local Development

```bash
npm install
npm run dev
```

The Vite frontend runs locally.

To run the Cloudflare Pages version locally:

```bash
cp .dev.vars.example .dev.vars
npm run dev:cloudflare
```

## Deploy To Cloudflare Pages

Refresh Wrangler auth if needed:

```bash
npx wrangler login --browser=false
```

Create the Pages project once:

```bash
npx wrangler pages project create civic-finder --production-branch main
```

Optionally set issued API keys as a Cloudflare Pages secret. Without this
secret the app still runs publicly, but every request is treated as anonymous.
Multiple keys can be comma-separated:

```bash
printf 'partner-key-1,partner-key-2' | npx wrangler pages secret put APP_KEYS --project-name civic-finder
```

Create the analytics KV namespace once and add the generated ID to
`wrangler.toml`:

```bash
npx wrangler kv namespace create ANALYTICS_KV
```

Deploy:

```bash
npm run deploy:cloudflare
```

Cloudflare Pages uses `functions/api/lookup.ts` for `/api/lookup` and serves
the static boundary files from `public/geojson`. This repository is intended to
be self-hosted; any maintainer-hosted Pages deployment should be treated as a
best-effort demo or partner endpoint, not a supported public API contract.

## Shareable Lookup Links

Single lookups can be loaded from URL parameters. `address` is treated as one
freeform address string, so unit commas and apartment text are preserved:

```text
https://YOUR_PAGES_HOST/?address=2315%20W%20Giddings%20St%2C%20G
https://YOUR_PAGES_HOST/?coordinates=41.869%2C-87.784
```

Supported aliases are `street`, `q`, or `query` for address lookup; `coords`
for coordinate lookup; and `lat`/`lng`, `lat`/`lon`, or
`latitude`/`longitude` for split coordinate lookup.

## API

Bulk lookups use `POST /api/lookup` and return JSON records by default:

```bash
curl -X POST 'https://YOUR_PAGES_HOST/api/lookup' \
  -H 'content-type: application/json' \
  --data '{"records":["4226 N Ashland Ave","41.945702,-87.668495"],"defaultZip":"60613"}'
```

Issued API keys can be sent with `x-app-password` for the higher partner tier:

```bash
curl -X POST 'https://YOUR_PAGES_HOST/api/lookup' \
  -H 'content-type: application/json' \
  -H 'x-app-password: partner-key-1' \
  --data '{"records":["4226 N Ashland Ave"],"defaultZip":"60613"}'
```

`GET /api/lookup` remains available for one-off map clicks and old links.
`GET /api/usage` returns the app's displayed limit constants.
`GET /api/analytics` requires a valid API key and returns 24-hour, 7-day, and
30-day lookup totals plus recent request details, including submitted lookup
inputs. The app stores analytics in `ANALYTICS_KV` and retains individual
request rows for about 35 days.

The API returns a `usage` object with the record count, estimated external
subrequests, and measured wall time. Cloudflare exposes exact CPU time in
Workers Logs rather than to the function response, so wall time is useful
operationally but is not the billable CPU number.

The default Cloudflare Free-plan policy reserves half of the 100,000 daily
Function request budget for anonymous traffic. Anonymous requests are limited to
50 records per request, about 100 records per IP per hour, and 500 records per
IP per day. Authenticated requests are limited to 1,000 records per request,
about 1,000 records per key per hour, and 10,000 records per key per day. All
requests are also capped at an estimated 40 external subrequests so coordinate
batches do not run into Cloudflare's 50-subrequest Free-plan limit.

The built-in Pages limiter is intentionally lightweight and in-memory, so it is
a soft abuse barrier rather than durable billing-grade accounting. The
analytics KV log is intended for operational visibility into lookup inputs and
recent usage, not exact billing-grade quota enforcement.
