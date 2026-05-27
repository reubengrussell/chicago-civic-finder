import { LOOKUP_LIMITS } from '../../api/lookup-core.js'

export async function onRequest() {
  return Response.json(
    {
      date: new Date().toISOString().slice(0, 10),
      limits: LOOKUP_LIMITS,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}
