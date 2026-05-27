import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOUNDARIES, runLookup } from './lookup-core.js'
import type { BoundaryLoader } from './lookup-core.js'

const loadBoundaries: BoundaryLoader = (() => {
  let promise: ReturnType<BoundaryLoader> | undefined

  return () => {
    promise ??= Promise.all(
      BOUNDARIES.map(async (boundary) => ({
        ...boundary,
        data: JSON.parse(
          await readFile(
            join(process.cwd(), 'public', 'geojson', boundary.file),
            'utf8',
          ),
        ),
      })),
    )

    return promise
  }
})()

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function requestPassword(req: VercelRequest) {
  const header = req.headers['x-app-password']

  return (
    getParam(req.query.auth)?.trim() ??
    getParam(req.query.code)?.trim() ??
    getParam(req.query.password)?.trim() ??
    (Array.isArray(header) ? header[0] : header)
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const lookup = await runLookup({
    method: req.method ?? 'GET',
    appPassword: process.env.APP_PASSWORD,
    requestPassword: requestPassword(req),
    params: new URLSearchParams(
      Object.entries(req.query).flatMap(([key, value]) => {
        if (Array.isArray(value)) return value.map((entry) => [key, entry])
        if (value === undefined) return []

        return [[key, value]]
      }),
    ),
    body: req.body,
    loadBoundaries,
  })

  for (const [key, value] of Object.entries(lookup.headers ?? {})) {
    res.setHeader(key, value)
  }

  return res.status(lookup.status).json(lookup.body)
}
