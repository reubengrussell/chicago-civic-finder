import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

type CivicFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
>

type CivicCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CivicFeature['properties']
>

type PersonInfo = {
  name: string
  title?: string
  phone?: string
  email?: string
  address?: string
  photo?: string
  image?: string
  website?: string
  contactUrl?: string
}

type RegionInfo = {
  key: string
  label: string
  number?: string
  website?: string
  population?: string
  representatives: PersonInfo[]
}

export type BoundaryDefinition = {
  key: string
  file: string
}

export const BOUNDARIES: BoundaryDefinition[] = [
  { key: 'congressional', file: 'illinois-congressional-districts.json' },
  { key: 'illinoisHouse', file: 'illinois-house.json' },
  { key: 'illinoisSenate', file: 'illinois-senate.json' },
  { key: 'police', file: 'chicago-police-districts.json' },
  { key: 'schoolBoard', file: 'chicago-school-board.json' },
  { key: 'ward', file: 'chicago-wards.json' },
  { key: 'cookCountyCommissioner', file: 'cook-county-commissioners.json' },
]

export type BoundaryLoader = () => Promise<
  Array<BoundaryDefinition & { data: CivicCollection }>
>

export type LookupInput = {
  method: string
  appPassword?: string
  requestPassword?: string
  params: URLSearchParams
  body?: unknown
  loadBoundaries: BoundaryLoader
}

export type LookupResponse = {
  status: number
  headers?: Record<string, string>
  body: Record<string, unknown>
}

type ParsedLookup = {
  input: string
  street?: string
  zip?: string
  latitude?: number
  longitude?: number
}

type LookupBodyRecord =
  | string
  | {
      id?: string | number
      input?: string
      address?: string
      street?: string
      zip?: string | number
      coordinates?: string
      latitude?: string | number
      longitude?: string | number
    }

const MAX_RECORDS_PER_REQUEST = 20

export const LOOKUP_LIMITS = {
  cloudflareRequestsPerDay: 100000,
  maxRecordsPerRequest: MAX_RECORDS_PER_REQUEST,
  estimatedIpRecordsPerDay: 100000,
  estimatedIpRecordsPerHour: Math.ceil(100000 / 24),
  cpuMsPerRequestFree: 10,
  memoryMbPerIsolate: 128,
  externalSubrequestsPerAddress: 1,
  externalSubrequestsPerCoordinate: 2,
  cloudflareExternalSubrequestsPerInvocation: 50,
  simultaneousOpenConnections: 6,
  workerLogsEventsPerDayFree: 200000,
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : undefined
}

function findFeature(
  longitude: number,
  latitude: number,
  collection: CivicCollection,
) {
  const location = point([longitude, latitude])

  return collection.features.find((feature) =>
    booleanPointInPolygon(location, feature),
  )
}

function imageUrl(value: unknown) {
  const image = stringValue(value)
  if (!image) return undefined

  return image.startsWith('http://') || image.startsWith('https://')
    ? image
    : undefined
}

function officialRepresentatives(props: Record<string, unknown>) {
  if (!Array.isArray(props.representatives)) return []

  return props.representatives.flatMap((value) => {
    if (!value || typeof value !== 'object') return []

    const representative = value as Record<string, unknown>
    const name = stringValue(representative.name)
    const image = imageUrl(representative.photo) ?? imageUrl(representative.image)

    if (!name) return []

    return [
      {
        name,
        title: stringValue(representative.title),
        phone: stringValue(representative.phone),
        email: stringValue(representative.email),
        address: stringValue(representative.address),
        photo: image,
        image,
        website: stringValue(representative.website),
        contactUrl: stringValue(representative.contactUrl),
      },
    ]
  })
}

function regionInfo(key: string, feature?: CivicFeature): RegionInfo | undefined {
  if (!feature) return undefined

  const props = feature.properties

  switch (key) {
    case 'ward': {
      const number = stringValue(props.ward) ?? stringValue(props.ward_id)
      return {
        key,
        label: `Ward ${number ?? 'Unknown'}`,
        number,
        website: stringValue(props.website),
        representatives: officialRepresentatives(props),
      }
    }
    case 'congressional': {
      const number =
        stringValue(props.DISTRICT)?.replace(/^0+/, '') ??
        stringValue(props.CD119FP)?.replace(/^0+/, '')

      return {
        key,
        label: stringValue(props.NAMELSAD) ?? `Congressional District ${number}`,
        number,
        website: stringValue(props.WEBSITEURL),
        representatives: officialRepresentatives(props),
      }
    }
    case 'illinoisHouse':
    case 'illinoisSenate': {
      return {
        key,
        label: stringValue(props.name) ?? 'Illinois district',
        number: stringValue(props.name)?.replace(/^\D+/, ''),
        website: stringValue(props.website),
        representatives: officialRepresentatives(props),
      }
    }
    case 'police': {
      return {
        key,
        label: `${stringValue(props.dist_label)?.toLowerCase() ?? 'Police'} District Council`,
        number: stringValue(props.dist_num),
        website: stringValue(props.ccpsaUrl),
        representatives: officialRepresentatives(props),
      }
    }
    case 'schoolBoard': {
      return {
        key,
        label:
          stringValue(props.Name)?.replace('Sub ', 'School Board ') ??
          'School Board District',
        number: stringValue(props.elec_dist) ?? stringValue(props.ERSB20_DISTRICT),
        population: stringValue(props.ERSB20_TOTALPOP),
        representatives: officialRepresentatives(props),
      }
    }
    case 'cookCountyCommissioner': {
      const number = stringValue(props.DISTRICT_TXT)
      return {
        key,
        label: `Cook County Commissioner District ${number ?? 'Unknown'}`,
        number,
        website: stringValue(props.website),
        representatives: officialRepresentatives(props),
      }
    }
    default:
      return undefined
  }
}

async function civicRegions(
  longitude: number,
  latitude: number,
  loadBoundaries: BoundaryLoader,
) {
  const entries = await loadBoundaries()
  const regions: Record<string, RegionInfo | undefined> = {}

  for (const boundary of entries) {
    regions[boundary.key] = regionInfo(
      boundary.key,
      findFeature(longitude, latitude, boundary.data),
    )
  }

  return regions
}

type CensusGeographies = {
  '119th Congressional Districts'?: Array<{
    BASENAME: string
    GEOID: string
    NAME: string
  }>
}

type CensusMatch = {
  matchedAddress: string
  coordinates: {
    x: number
    y: number
  }
  geographies: CensusGeographies
}

type LookupLocation = {
  label: string
  latitude: number
  longitude: number
  geographies?: CensusGeographies
  ambiguous?: boolean
  candidates?: string[]
}

async function getAddressGeographies(street: string, zip?: string) {
  const params = new URLSearchParams({
    street,
    city: 'Chicago',
    state: 'IL',
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'all',
    format: 'json',
  })

  if (zip) params.set('zip', zip)

  const censusResponse = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/address?${params}`,
  )

  if (!censusResponse.ok) {
    throw new Error('The Census geocoder did not respond.')
  }

  const censusData = (await censusResponse.json()) as {
    result?: { addressMatches?: CensusMatch[] }
  }
  const matches = censusData.result?.addressMatches ?? []
  const match = matches[0]

  if (!match) return undefined

  return {
    label: match.matchedAddress,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    geographies: match.geographies,
    ambiguous: matches.length > 1,
    candidates: matches.slice(0, 5).map((match) => match.matchedAddress),
  }
}

function csvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function csvRow(values: string[]) {
  return values.map(csvValue).join(',')
}

function parseCsvRows(csv: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const next = csv[index + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else if (char !== '\r') {
      value += char
    }
  }

  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }

  return rows
}

async function getAddressBatchGeographies(records: ParsedLookup[]) {
  const csv = records
    .map((record, index) =>
      csvRow([
        index.toString(),
        record.street ?? '',
        'Chicago',
        'IL',
        record.zip ?? '',
      ]),
    )
    .join('\n')
  const form = new FormData()

  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'addresses.csv')
  form.append('benchmark', 'Public_AR_Current')

  const censusResponse = await fetch(
    'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
    {
      method: 'POST',
      body: form,
    },
  )

  if (!censusResponse.ok) {
    throw new Error('The Census geocoder did not respond.')
  }

  const locations = new Map<number, LookupLocation>()

  for (const row of parseCsvRows(await censusResponse.text())) {
    const index = Number(row[0])
    const status = row[2]
    const matchedAddress = row[4]
    const [longitude, latitude] = (row[5] ?? '')
      .split(',')
      .map((value) => Number(value))

    if (
      !Number.isInteger(index) ||
      status !== 'Match' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue
    }

    locations.set(index, {
      label: matchedAddress,
      latitude,
      longitude,
      ambiguous: false,
      candidates: [],
    })
  }

  return locations
}

function parseCoordinatePair(value?: string) {
  const [latitude, longitude] =
    value?.split(',').map((part) => Number(part.trim())) ?? []

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : undefined
}

function validCoordinates(latitude?: number, longitude?: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude! >= -90 &&
    latitude! <= 90 &&
    longitude! >= -180 &&
    longitude! <= 180
  )
}

function parseTextRecord(input: string, defaultZip?: string): ParsedLookup {
  const trimmed = input.trim()
  const coordinatePair = parseCoordinatePair(trimmed)

  if (coordinatePair) {
    return { input: trimmed, ...coordinatePair }
  }

  return {
    input: trimmed,
    street: trimmed,
    zip: defaultZip,
  }
}

function parseBodyRecord(
  record: LookupBodyRecord,
  defaultZip?: string,
): ParsedLookup | undefined {
  if (typeof record === 'string') return parseTextRecord(record, defaultZip)
  if (!record || typeof record !== 'object') return undefined

  const input =
    stringValue(record.input) ??
    stringValue(record.address) ??
    stringValue(record.street) ??
    stringValue(record.coordinates) ??
    [record.latitude, record.longitude].map(stringValue).filter(Boolean).join(',')

  if (!input) return undefined

  const coordinatePair = parseCoordinatePair(stringValue(record.coordinates))
  const latitude =
    coordinatePair?.latitude ??
    (stringValue(record.latitude) ? Number(stringValue(record.latitude)) : undefined)
  const longitude =
    coordinatePair?.longitude ??
    (stringValue(record.longitude)
      ? Number(stringValue(record.longitude))
      : undefined)
  const street =
    stringValue(record.address) ?? stringValue(record.street) ?? undefined

  if (latitude !== undefined || longitude !== undefined) {
    return {
      input,
      latitude,
      longitude,
    }
  }

  return {
    input,
    street: street ?? input,
    zip: stringValue(record.zip) ?? defaultZip,
  }
}

function bulkRecords(body: unknown, defaultZip?: string) {
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
  const zip = stringValue(payload.defaultZip) ?? defaultZip

  return source
    .map((record) => parseBodyRecord(record as LookupBodyRecord, zip))
    .filter((record): record is ParsedLookup => Boolean(record))
}

async function getCoordinateGeographies(latitude: number, longitude: number) {
  const params = new URLSearchParams({
    x: longitude.toString(),
    y: latitude.toString(),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: 'all',
    format: 'json',
  })

  const censusResponse = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params}`,
  )

  if (!censusResponse.ok) {
    throw new Error('The Census geocoder did not respond.')
  }

  const censusData = (await censusResponse.json()) as {
    result?: { geographies?: CensusGeographies }
  }

  return {
    label:
      (await getReverseLocationLabel(latitude, longitude)) ??
      'Selected map point',
    latitude,
    longitude,
    geographies: censusData.result?.geographies ?? {},
    ambiguous: false,
    candidates: [],
  }
}

async function getReverseLocationLabel(latitude: number, longitude: number) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: latitude.toString(),
    lon: longitude.toString(),
    zoom: '18',
    addressdetails: '1',
  })

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      {
        headers: {
          'User-Agent': 'CivicFinder/1.0',
        },
      },
    )

    if (!response.ok) return undefined

    const payload = (await response.json()) as {
      address?: Record<string, string>
      display_name?: string
    }
    const address = payload.address ?? {}
    const street =
      [address.house_number, address.road].filter(Boolean).join(' ') ||
      address.road ||
      address.pedestrian ||
      address.neighbourhood
    const city = address.city ?? address.town ?? address.village
    const state = address.state === 'Illinois' ? 'IL' : address.state
    const label = [street, city, state, address.postcode].filter(Boolean).join(', ')

    return label || payload.display_name
  } catch {
    return undefined
  }
}

async function lookupOne(
  lookupInput: ParsedLookup,
  loadBoundaries: BoundaryLoader,
): Promise<Record<string, unknown>> {
  const hasAddress = Boolean(lookupInput.street || lookupInput.zip)
  const hasCoordinates = Boolean(
    lookupInput.latitude !== undefined || lookupInput.longitude !== undefined,
  )

  if (hasAddress && hasCoordinates) {
    throw new Error('Submit either an address and ZIP or latitude and longitude.')
  }

  if (!hasAddress && !hasCoordinates) {
    throw new Error('Address and ZIP or latitude and longitude are required.')
  }

  if (hasAddress && !lookupInput.street) {
    throw new Error('Street address is required.')
  }

  if (
    hasCoordinates &&
    !validCoordinates(lookupInput.latitude, lookupInput.longitude)
  ) {
    throw new Error('Enter valid latitude and longitude values.')
  }

  let lookup

  try {
    lookup = hasCoordinates
      ? await getCoordinateGeographies(
          lookupInput.latitude!,
          lookupInput.longitude!,
        )
      : await getAddressGeographies(lookupInput.street!, lookupInput.zip)
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'The lookup failed.',
      { cause: error },
    )
  }

  if (!lookup) {
    throw new Error('No matching Chicago address was found for that street and ZIP.')
  }

  return lookupFromLocation(lookup, loadBoundaries)
}

async function lookupFromLocation(
  lookup: LookupLocation,
  loadBoundaries: BoundaryLoader,
): Promise<Record<string, unknown>> {
  const regions = await civicRegions(lookup.longitude, lookup.latitude, loadBoundaries)
  const ward = regions.ward?.number
  const congressionalDistrict = regions.congressional
  const base = {
    locationLabel: lookup.label,
    coordinates: { latitude: lookup.latitude, longitude: lookup.longitude },
    ambiguous: lookup.ambiguous ?? false,
    candidates: lookup.candidates ?? [],
    ward,
    congressionalDistrict: congressionalDistrict
      ? {
          number: congressionalDistrict.number,
          name: congressionalDistrict.label,
          geoid: '',
        }
      : undefined,
    illinoisHouseDistrict: regions.illinoisHouse,
    illinoisSenateDistrict: regions.illinoisSenate,
    policeDistrict: regions.police,
    schoolBoardDistrict: regions.schoolBoard,
    cookCountyCommissionerDistrict: regions.cookCountyCommissioner,
    regions,
    sources: {
      boundaries: 'Generated static boundary files with official-source representative metadata',
      geocoding: 'U.S. Census Geocoder, Current benchmark/vintage',
    },
  }

  if (!ward) {
    throw Object.assign(new Error('The location did not fall inside a Chicago ward.'), {
      lookup: base,
    })
  }

  return base
}

function recordFromLookup(input: string, lookup: Record<string, unknown>) {
  return {
    input,
    status: 'ok',
    matchedAddress: lookup.locationLabel,
    ...lookup,
    error: '',
  }
}

function errorRecord(input: string, error: unknown) {
  const partial =
    error &&
    typeof error === 'object' &&
    'lookup' in error &&
    typeof error.lookup === 'object'
      ? (error.lookup as Record<string, unknown>)
      : {}

  return {
    input,
    status: 'error',
    matchedAddress: partial.locationLabel ?? '',
    ...partial,
    error: error instanceof Error ? error.message : 'The lookup failed.',
  }
}

function estimateExternalSubrequests(records: ParsedLookup[], usedAddressBatch: boolean) {
  if (usedAddressBatch) return records.length ? 1 : 0

  return records.reduce(
    (total, record) =>
      total +
      (record.latitude !== undefined || record.longitude !== undefined
        ? LOOKUP_LIMITS.externalSubrequestsPerCoordinate
        : LOOKUP_LIMITS.externalSubrequestsPerAddress),
    0,
  )
}

async function runBulkLookup(input: LookupInput): Promise<LookupResponse> {
  const records = bulkRecords(input.body, input.params.get('zip')?.trim())

  if (!records.length) {
    return {
      status: 400,
      body: {
        error:
          'Send a JSON body with a records array of addresses or coordinate pairs.',
      },
    }
  }

  if (records.length > MAX_RECORDS_PER_REQUEST) {
    return {
      status: 413,
      body: {
        error: `Send ${MAX_RECORDS_PER_REQUEST} records or fewer per request.`,
        limits: LOOKUP_LIMITS,
      },
    }
  }

  const addressBatch = records.every(
    (record) =>
      record.street &&
      record.latitude === undefined &&
      record.longitude === undefined,
  )
  const output = []

  if (addressBatch) {
    try {
      const locations = await getAddressBatchGeographies(records)

      for (const [index, record] of records.entries()) {
        try {
          const location = locations.get(index)

          if (!location) {
            throw new Error(
              'No matching Chicago address was found for that street and ZIP.',
            )
          }

          output.push(
            recordFromLookup(
              record.input,
              await lookupFromLocation(location, input.loadBoundaries),
            ),
          )
        } catch (error) {
          output.push(errorRecord(record.input, error))
        }
      }
    } catch (error) {
      for (const record of records) {
        output.push(errorRecord(record.input, error))
      }
    }
  } else {
    for (const record of records) {
      try {
        output.push(
          recordFromLookup(
            record.input,
            await lookupOne(record, input.loadBoundaries),
          ),
        )
      } catch (error) {
        output.push(errorRecord(record.input, error))
      }
    }
  }

  return {
    status: 200,
    body: {
      records: output,
      usage: {
        records: output.length,
        estimatedExternalSubrequests: estimateExternalSubrequests(
          records,
          addressBatch,
        ),
      },
      limits: LOOKUP_LIMITS,
    },
  }
}

export async function runLookup(input: LookupInput): Promise<LookupResponse> {
  if (input.method !== 'GET' && input.method !== 'POST') {
    return {
      status: 405,
      headers: { Allow: 'GET, POST' },
      body: { error: 'Use GET for one lookup or POST for bulk lookups.' },
    }
  }

  if (input.appPassword && input.requestPassword !== input.appPassword) {
    return {
      status: 401,
      body: { error: 'Enter the password to use this app.' },
    }
  }

  if (input.method === 'POST') {
    return runBulkLookup(input)
  }

  const street = input.params.get('street')?.trim()
  const zip = input.params.get('zip')?.trim()
  const coordinatesParam = input.params.get('coordinates')?.trim()
  const [pairedLatitude, pairedLongitude] =
    coordinatesParam?.split(',').map((part) => part.trim()) ?? []
  const latitudeParam = input.params.get('latitude')?.trim() ?? pairedLatitude
  const longitudeParam = input.params.get('longitude')?.trim() ?? pairedLongitude
  const latitude = latitudeParam ? Number(latitudeParam) : undefined
  const longitude = longitudeParam ? Number(longitudeParam) : undefined

  try {
    return {
      status: 200,
      body: await lookupOne(
        {
          input: street ?? coordinatesParam ?? '',
          street: street || undefined,
          zip: zip || undefined,
          latitude,
          longitude,
        },
        input.loadBoundaries,
      ),
    }
  } catch (error) {
    const partial =
      error &&
      typeof error === 'object' &&
      'lookup' in error &&
      typeof error.lookup === 'object'
        ? (error.lookup as Record<string, unknown>)
        : undefined
    const message = error instanceof Error ? error.message : 'The lookup failed.'
    const status = message.includes('did not respond')
      ? 502
      : message.includes('No matching') || message.includes('inside a Chicago ward')
        ? 404
        : 400

    return {
      status,
      body: {
        error: message,
        ...partial,
      },
    }
  }
}
