import type { LookupResponse } from '../../api/lookup-core.js'

export type AccessTier = 'anonymous' | 'authenticated'

type KvListResult = {
  keys: Array<{ name: string }>
  list_complete: boolean
  cursor?: string
}

type AnalyticsKv = {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  list(options?: {
    prefix?: string
    limit?: number
    cursor?: string
  }): Promise<KvListResult>
}

export type AnalyticsEnv = {
  ANALYTICS_KV?: AnalyticsKv
}

export type LookupAnalyticsEvent = {
  id: string
  timestamp: string
  method: string
  path: string
  status: number
  accessTier: AccessTier
  recordsRequested: number
  recordsReturned: number
  errorRecords: number
  estimatedExternalSubrequests?: number
  wallMs: number
  ip: string
  country?: string
  userAgent?: string
  contentLength?: string
  contentType?: string
  inputs: string[]
  matchedAddresses: string[]
}

type Counter = {
  requests: number
  records: number
  errors: number
  updatedAt: string
}

const EVENT_TTL_SECONDS = 60 * 60 * 24 * 35
const STATS_TTL_SECONDS = 60 * 60 * 24 * 45
const MAX_STORED_INPUTS = 1000

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : undefined
}

function eventId() {
  return crypto.randomUUID()
}

function reverseTimestampKey(timestampMs: number) {
  return String(9999999999999 - timestampMs).padStart(13, '0')
}

function hourKey(date: Date) {
  return date.toISOString().slice(0, 13)
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function recordInputsFromBody(body: unknown) {
  const payload =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const source =
    Array.isArray(body)
      ? body
      : Array.isArray(payload.records)
        ? payload.records
        : Array.isArray(payload.lookups)
          ? payload.lookups
          : Array.isArray(payload.inputs)
            ? payload.inputs
            : Array.isArray(payload.addresses)
              ? payload.addresses
              : Array.isArray(payload.coordinates)
                ? payload.coordinates
                : []

  return source.flatMap((record) => {
    if (typeof record === 'string' || typeof record === 'number') {
      const value = stringValue(record)
      return value ? [value] : []
    }

    if (!record || typeof record !== 'object') return []

    const item = record as Record<string, unknown>
    const value =
      stringValue(item.input) ??
      stringValue(item.address) ??
      stringValue(item.street) ??
      stringValue(item.coordinates) ??
      [item.latitude, item.longitude].map(stringValue).filter(Boolean).join(',')

    return value ? [value] : []
  })
}

function lookupInputs(method: string, params: URLSearchParams, body: unknown) {
  if (method === 'POST') return recordInputsFromBody(body)

  const coordinates =
    params.get('coordinates') ??
    params.get('coords') ??
    (params.get('lat') && params.get('lng')
      ? `${params.get('lat')},${params.get('lng')}`
      : undefined)
  const address =
    params.get('address') ??
    params.get('street') ??
    params.get('q') ??
    params.get('query')

  return [coordinates, address]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
}

function lookupRecords(body: LookupResponse['body']) {
  return Array.isArray(body.records)
    ? (body.records as Array<Record<string, unknown>>)
    : []
}

function matchedAddresses(body: LookupResponse['body']) {
  return lookupRecords(body)
    .map((record) => stringValue(record.matchedAddress))
    .filter((value): value is string => Boolean(value))
}

function usageNumber(body: LookupResponse['body'], key: string) {
  const usage =
    body.usage && typeof body.usage === 'object'
      ? (body.usage as Record<string, unknown>)
      : {}
  const value = usage[key]

  return typeof value === 'number' ? value : undefined
}

async function readCounter(kv: AnalyticsKv, key: string): Promise<Counter> {
  const current = await kv.get(key)

  if (!current) {
    return { requests: 0, records: 0, errors: 0, updatedAt: '' }
  }

  try {
    return JSON.parse(current) as Counter
  } catch {
    return { requests: 0, records: 0, errors: 0, updatedAt: '' }
  }
}

async function incrementCounter(kv: AnalyticsKv, key: string, event: LookupAnalyticsEvent) {
  const current = await readCounter(kv, key)
  const next: Counter = {
    requests: current.requests + 1,
    records: current.records + event.recordsRequested,
    errors: current.errors + event.errorRecords,
    updatedAt: event.timestamp,
  }

  await kv.put(key, JSON.stringify(next), { expirationTtl: STATS_TTL_SECONDS })
}

export async function recordLookupAnalytics(input: {
  env: AnalyticsEnv
  request: Request
  url: URL
  body: unknown
  lookup: LookupResponse
  wallMs: number
  accessTier: AccessTier
}) {
  const kv = input.env.ANALYTICS_KV
  if (!kv) return

  const now = new Date()
  const body = input.lookup.body
  const records = lookupRecords(body)
  const inputs = lookupInputs(input.request.method, input.url.searchParams, input.body)
    .slice(0, MAX_STORED_INPUTS)
  const event: LookupAnalyticsEvent = {
    id: eventId(),
    timestamp: now.toISOString(),
    method: input.request.method,
    path: input.url.pathname,
    status: input.lookup.status,
    accessTier: input.accessTier,
    recordsRequested:
      inputs.length || usageNumber(body, 'records') || records.length || 1,
    recordsReturned: records.length,
    errorRecords: records.filter((record) => record.status === 'error').length,
    estimatedExternalSubrequests: usageNumber(
      body,
      'estimatedExternalSubrequests',
    ),
    wallMs: input.wallMs,
    ip:
      input.request.headers.get('cf-connecting-ip') ??
      input.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown',
    country: input.request.headers.get('cf-ipcountry') ?? undefined,
    userAgent: input.request.headers.get('user-agent') ?? undefined,
    contentLength: input.request.headers.get('content-length') ?? undefined,
    contentType: input.request.headers.get('content-type') ?? undefined,
    inputs,
    matchedAddresses: matchedAddresses(body).slice(0, MAX_STORED_INPUTS),
  }
  const eventKey = `event:${reverseTimestampKey(now.getTime())}:${event.id}`

  await Promise.all([
    kv.put(eventKey, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS }),
    incrementCounter(kv, `stats:hour:${hourKey(now)}`, event),
    incrementCounter(kv, `stats:day:${dayKey(now)}`, event),
  ])
}

export async function sumCounters(kv: AnalyticsKv, keys: string[]) {
  const counters = await Promise.all(keys.map((key) => readCounter(kv, key)))

  return counters.reduce(
    (total, counter) => ({
      requests: total.requests + counter.requests,
      records: total.records + counter.records,
      errors: total.errors + counter.errors,
    }),
    { requests: 0, records: 0, errors: 0 },
  )
}

export async function recentEvents(kv: AnalyticsKv, limit = 50) {
  const listing = await kv.list({ prefix: 'event:', limit })
  const events = await Promise.all(
    listing.keys.map(async (key) => {
      const value = await kv.get(key.name)
      if (!value) return undefined

      try {
        return JSON.parse(value) as LookupAnalyticsEvent
      } catch {
        return undefined
      }
    }),
  )

  return events.filter((event): event is LookupAnalyticsEvent => Boolean(event))
}

export function hourCounterKeys(hours: number, now = new Date()) {
  return Array.from({ length: hours }, (_, index) => {
    const date = new Date(now.getTime() - index * 60 * 60 * 1000)
    return `stats:hour:${hourKey(date)}`
  })
}

export function dayCounterKeys(days: number, now = new Date()) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000)
    return `stats:day:${dayKey(date)}`
  })
}
