import {
  dayCounterKeys,
  hourCounterKeys,
  recentEvents,
  sumCounters,
} from './analytics-store.js'
import type { AnalyticsEnv } from './analytics-store.js'

type PagesEnv = AnalyticsEnv & {
  APP_PASSWORD?: string
  APP_KEYS?: string
}

type PagesContext = {
  request: Request
  env: PagesEnv
}

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
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

function configuredApiKeys(env: PagesEnv) {
  return [env.APP_PASSWORD, env.APP_KEYS]
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
}

function authorized(env: PagesEnv, password?: string) {
  const keys = configuredApiKeys(env)

  return Boolean(keys.length && password && keys.includes(password))
}

export async function onRequest(context: PagesContext) {
  const url = new URL(context.request.url)

  if (context.request.method !== 'GET') {
    return Response.json(
      { error: 'Use GET for analytics.' },
      { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'GET' } },
    )
  }

  if (!authorized(context.env, requestPassword(context.request, url))) {
    return Response.json(
      { error: 'A valid API key is required for analytics.' },
      { status: 401, headers: PRIVATE_HEADERS },
    )
  }

  if (!context.env.ANALYTICS_KV) {
    return Response.json(
      { error: 'Analytics storage is not configured.' },
      { status: 503, headers: PRIVATE_HEADERS },
    )
  }

  const kv = context.env.ANALYTICS_KV
  const [last24h, last7d, last30d, recent] = await Promise.all([
    sumCounters(kv, hourCounterKeys(24)),
    sumCounters(kv, dayCounterKeys(7)),
    sumCounters(kv, dayCounterKeys(30)),
    recentEvents(kv, 50),
  ])

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      windows: {
        last24h,
        last7d,
        last30d,
      },
      recent,
    },
    { headers: PRIVATE_HEADERS },
  )
}
