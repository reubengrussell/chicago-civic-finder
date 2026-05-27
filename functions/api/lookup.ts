import { BOUNDARIES, runLookup } from '../../api/lookup-core.js'
import type { BoundaryLoader } from '../../api/lookup-core.js'
import { callerIp, checkIpQuota, quotaHeaders, requestWeight } from './quota.js'

type PagesEnv = {
  APP_PASSWORD?: string
}

type PagesContext = {
  request: Request
  env: PagesEnv
}

let boundariesPromise: ReturnType<BoundaryLoader> | undefined

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function loadBoundaries(request: Request): BoundaryLoader {
  return () => {
    boundariesPromise ??= Promise.all(
      BOUNDARIES.map(async (boundary) => {
        const url = new URL(`/geojson/${boundary.file}`, request.url)
        const response = await fetch(url)

        if (!response.ok) {
          throw new Error(`Boundary asset ${boundary.file} failed: ${response.status}`)
        }

        return {
          ...boundary,
          data: await response.json(),
        }
      }),
    )

    return boundariesPromise
  }
}

function requestPassword(request: Request, url: URL) {
  return (
    url.searchParams.get('auth')?.trim() ??
    url.searchParams.get('code')?.trim() ??
    url.searchParams.get('password')?.trim() ??
    request.headers.get('x-app-password')?.trim() ??
    undefined
  )
}

export async function onRequest(context: PagesContext) {
  const startedAt = performance.now()
  const url = new URL(context.request.url)
  const body =
    context.request.method === 'POST'
      ? await context.request.json().catch(() => undefined)
      : undefined
  const quota = checkIpQuota(
    callerIp(context.request),
    requestWeight(context.request.method, body),
  )

  if (quota.blocked) {
    return Response.json(
      {
        error: 'Too many lookups from this IP. Try again after the reset time.',
      },
      {
        status: 429,
        headers: {
          ...PRIVATE_HEADERS,
          ...quotaHeaders(quota),
          'Retry-After': Math.max(
            1,
            Math.ceil((quota.resetAt - Date.now()) / 1000),
          ).toString(),
        },
      },
    )
  }

  const lookup = await runLookup({
    method: context.request.method,
    appPassword: context.env.APP_PASSWORD,
    requestPassword: requestPassword(context.request, url),
    params: url.searchParams,
    body,
    loadBoundaries: loadBoundaries(context.request),
  })
  const wallMs = Math.round((performance.now() - startedAt) * 10) / 10
  const responseBody =
    'usage' in lookup.body && lookup.body.usage
      ? {
          ...lookup.body,
          usage: {
            ...(lookup.body.usage as Record<string, unknown>),
            wallMs,
          },
        }
      : {
          ...lookup.body,
          usage: { wallMs },
        }

  return Response.json(responseBody, {
    status: lookup.status,
    headers: {
      ...PRIVATE_HEADERS,
      ...lookup.headers,
      ...quotaHeaders(quota),
      'Server-Timing': `lookup;dur=${wallMs}`,
    },
  })
}
