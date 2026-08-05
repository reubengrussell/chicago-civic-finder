import { LOOKUP_LIMITS } from '../../api/lookup-core.js'

type IpBucket = {
  dayKey: string
  dayCount: number
  hourKey: string
  hourCount: number
}

type AccessTier = 'anonymous' | 'authenticated'

type QuotaInput = {
  tier: AccessTier
  ip: string
  key?: string
  weight: number
}

const subjectBuckets = new Map<string, IpBucket>()
const appBuckets = new Map<string, IpBucket>()

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

function keyFingerprint(key: string) {
  let hash = 5381

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 33) ^ key.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}

function checkBucket(
  buckets: Map<string, IpBucket>,
  bucketKey: string,
  weight: number,
  hourlyLimit: number,
  dailyLimit: number,
  now: Date,
) {
  const dayKey = utcDay(now)
  const hourKey = utcHour(now)
  const existing = buckets.get(bucketKey)
  const bucket: IpBucket = {
    dayKey,
    dayCount: existing?.dayKey === dayKey ? existing.dayCount : 0,
    hourKey,
    hourCount: existing?.hourKey === hourKey ? existing.hourCount : 0,
  }
  const nextHourCount = bucket.hourCount + weight
  const nextDayCount = bucket.dayCount + weight
  const blocked = nextHourCount > hourlyLimit || nextDayCount > dailyLimit
  const resetAt = nextHourCount > hourlyLimit ? nextUtcHour(now) : nextUtcDay(now)

  if (!blocked) {
    bucket.hourCount = nextHourCount
    bucket.dayCount = nextDayCount
    buckets.set(bucketKey, bucket)
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

export function checkQuota(input: QuotaInput, now = new Date()) {
  const subjectKey =
    input.tier === 'authenticated' && input.key
      ? `key:${keyFingerprint(input.key)}`
      : `ip:${input.ip}`
  const subject =
    input.tier === 'authenticated'
      ? checkBucket(
          subjectBuckets,
          subjectKey,
          input.weight,
          LOOKUP_LIMITS.authenticatedEstimatedKeyRecordsPerHour,
          LOOKUP_LIMITS.authenticatedEstimatedKeyRecordsPerDay,
          now,
        )
      : checkBucket(
          subjectBuckets,
          subjectKey,
          input.weight,
          LOOKUP_LIMITS.estimatedIpRecordsPerHour,
          LOOKUP_LIMITS.estimatedIpRecordsPerDay,
          now,
        )

  if (subject.blocked) {
    return {
      ...subject,
      tier: input.tier,
    }
  }

  const app = checkBucket(
    appBuckets,
    `app:${input.tier}`,
    input.weight,
    input.tier === 'authenticated'
      ? LOOKUP_LIMITS.authenticatedCloudflareRequestsPerDay
      : LOOKUP_LIMITS.anonymousCloudflareRequestsPerDay,
    input.tier === 'authenticated'
      ? LOOKUP_LIMITS.authenticatedCloudflareRequestsPerDay
      : LOOKUP_LIMITS.anonymousCloudflareRequestsPerDay,
    now,
  )

  return {
    blocked: app.blocked,
    tier: input.tier,
    hourlyLimit: subject.hourlyLimit,
    dailyLimit: subject.dailyLimit,
    remaining: Math.min(subject.remaining, app.remaining),
    resetAt: app.blocked ? app.resetAt : subject.resetAt,
  }
}

export function quotaHeaders(quota: ReturnType<typeof checkQuota>) {
  return {
    'X-RateLimit-Limit': quota.hourlyLimit.toString(),
    'X-RateLimit-Remaining': quota.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(quota.resetAt / 1000).toString(),
  }
}
