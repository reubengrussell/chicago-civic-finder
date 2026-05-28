# Reuben's Region Recombobulator

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
npx wrangler pages project create chicago-civic-finder --production-branch main
```

Set the production password as a Cloudflare Pages secret:

```bash
printf 'change-me' | npx wrangler pages secret put APP_PASSWORD --project-name chicago-civic-finder
```

Deploy:

```bash
npm run deploy:cloudflare
```

Cloudflare Pages uses `functions/api/lookup.ts` for `/api/lookup` and serves
the static boundary files from `public/geojson`.

## Shareable Lookup Links

Single lookups can be loaded from URL parameters. `address` is treated as one
freeform address string, so unit commas and apartment text are preserved:

```text
https://chicago-civic-finder.pages.dev/?auth=change-me&address=2315%20W%20Giddings%20St%2C%20G
https://chicago-civic-finder.pages.dev/?auth=change-me&coordinates=41.869%2C-87.784
```

Supported aliases are `street`, `q`, or `query` for address lookup; `coords`
for coordinate lookup; and `lat`/`lng`, `lat`/`lon`, or
`latitude`/`longitude` for split coordinate lookup.

## API

Bulk lookups use `POST /api/lookup` and return JSON records by default:

```bash
curl -X POST 'https://chicago-civic-finder.pages.dev/api/lookup' \
  -H 'content-type: application/json' \
  -H 'x-app-password: change-me' \
  --data '{"records":["4226 N Ashland Ave","41.945702,-87.668495"],"defaultZip":"60613"}'
```

`GET /api/lookup` remains available for one-off map clicks and old links.
`GET /api/usage` returns the app's displayed limit constants.

The API returns a `usage` object with the record count, estimated external
subrequests, and measured wall time. Cloudflare exposes exact CPU time in
Workers Logs rather than to the function response, so wall time is useful
operationally but is not the billable CPU number.

Current app-side limits are 20 records per request, 4,167 records per IP per
hour, 100,000 records per IP per day, and 100,000 Cloudflare Function requests
per day across the app.
