import { LOOKUP_LIMITS } from '../../api/lookup-core.js'

type IpBucket = {
  dayKey: string
  dayCount: number
  hourKey: string
  hourCount: number
}

const ipBuckets = new Map<string, IpBucket>()

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

function utcHour(date: Date) {
  return date.toISOString().slice(0, 13)
}

function nextUtcHour(date: Date) {
  return Math.floor(date.getTime() / 3600000) * 3600000 + 3600000
}

function nextUtcDay(date: Date) {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  )
}

export function callerIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

export function requestWeight(method: string, body: unknown) {
  if (method !== 'POST') return 1
  if (Array.isArray(body)) return body.length
  if (!body || typeof body !== 'object') return 1

  const payload = body as Record<string, unknown>
  const records =
    payload.records ??
    payload.lookups ??
    payload.inputs ??
    payload.addresses ??
    payload.coordinates

  return Array.isArray(records) ? Math.max(records.length, 1) : 1
}

export function checkIpQuota(ip: string, weight: number, now = new Date()) {
  const dayKey = utcDay(now)
  const hourKey = utcHour(now)
  const existing = ipBuckets.get(ip)
  const bucket: IpBucket = {
    dayKey,
    dayCount: existing?.dayKey === dayKey ? existing.dayCount : 0,
    hourKey,
    hourCount: existing?.hourKey === hourKey ? existing.hourCount : 0,
  }
  const nextHourCount = bucket.hourCount + weight
  const nextDayCount = bucket.dayCount + weight
  const hourlyLimit = LOOKUP_LIMITS.estimatedIpRecordsPerHour
  const dailyLimit = LOOKUP_LIMITS.estimatedIpRecordsPerDay
  const blocked = nextHourCount > hourlyLimit || nextDayCount > dailyLimit
  const resetAt = nextHourCount > hourlyLimit ? nextUtcHour(now) : nextUtcDay(now)

  if (!blocked) {
    bucket.hourCount = nextHourCount
    bucket.dayCount = nextDayCount
    ipBuckets.set(ip, bucket)
  }

  return {
    blocked,
    hourlyLimit,
    dailyLimit,
    remaining: Math.max(
      0,
      Math.min(hourlyLimit - bucket.hourCount, dailyLimit - bucket.dayCount),
    ),
    resetAt,
  }
}

export function quotaHeaders(quota: ReturnType<typeof checkIpQuota>) {
  return {
    'X-RateLimit-Limit': quota.hourlyLimit.toString(),
    'X-RateLimit-Remaining': quota.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(quota.resetAt / 1000).toString(),
  }
}
