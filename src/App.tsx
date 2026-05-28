import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { BarChart3, Download, HelpCircle, KeyRound, Loader2, MapPin, Search } from 'lucide-react'
import { CircleMarker, GeoJSON, MapContainer, Pane, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { GeoJsonObject } from 'geojson'
import type { Layer, LeafletMouseEvent } from 'leaflet'
import * as XLSX from 'xlsx'
import 'leaflet/dist/leaflet.css'
import './App.css'

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

type LookupResult = {
  locationLabel: string
  coordinates: {
    latitude: number
    longitude: number
  }
  ambiguous?: boolean
  candidates?: string[]
  ward?: string
  congressionalDistrict?: {
    number: string
    name: string
    geoid: string
  }
  regions?: Record<string, RegionInfo | undefined>
  illinoisHouseDistrict?: RegionInfo
  illinoisSenateDistrict?: RegionInfo
  policeDistrict?: RegionInfo
  schoolBoardDistrict?: RegionInfo
  cookCountyCommissionerDistrict?: RegionInfo
  sources?: {
    boundaries?: string
    geocoding?: string
  }
  usage?: LatestApiUsage
}

type WardProperties = {
  ward?: string
  ward_id?: string
  st_area_sh?: string
}

type DistrictProperties = {
  NAMELSAD?: string
  FIRSTNAME?: string
  LASTNAME?: string
  WEBSITEURL?: string
  PHOTOURL?: string
  DISTRICTID?: string
  DISTRICT?: string
  CDFIPS?: string
  CD119FP?: string
  NAME?: string
  PARTY?: string
  SQMI?: number
}

type CivicProperties = WardProperties & DistrictProperties & Record<string, unknown>
type CivicFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CivicProperties
>
type CivicFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CivicProperties
>
type BoundaryOverlay =
  | 'ward'
  | 'congressional'
  | 'illinoisHouse'
  | 'illinoisSenate'
  | 'police'
  | 'schoolBoard'
  | 'cookCountyCommissioner'
type BoundaryConfig = {
  id: BoundaryOverlay
  label: string
  shortLabel: string
  kind: string
  url: string
}
type BatchRow = {
  [key: string]: string
  input: string
  status: 'ok' | 'error'
  matchedAddress: string
  ward: string
  congressionalDistrict: string
  illinoisHouseDistrict: string
  illinoisSenateDistrict: string
  policeDistrict: string
  schoolBoardDistrict: string
  cookCountyCommissionerDistrict: string
  latitude: string
  longitude: string
  ambiguous: string
  candidates: string
  error: string
}
type LookupAttempt = {
  row: BatchRow
  lookup?: LookupResult
}
type LookupWithExport = LookupResult & {
  csvRow?: BatchRow
}
type BulkApiRecord = Partial<LookupResult> & {
  input: string
  status: 'ok' | 'error'
  matchedAddress?: string
  error?: string
}
type UsageLimits = {
  cloudflareRequestsPerDay: number
  maxRecordsPerRequest: number
  estimatedIpRecordsPerDay: number
  estimatedIpRecordsPerHour: number
  cpuMsPerRequestFree: number
  memoryMbPerIsolate: number
  externalSubrequestsPerAddress: number
  externalSubrequestsPerCoordinate: number
  cloudflareExternalSubrequestsPerInvocation: number
  simultaneousOpenConnections: number
  workerLogsEventsPerDayFree: number
}
type LatestApiUsage = {
  records?: number
  estimatedExternalSubrequests?: number
  wallMs?: number
}
type UsageSummary = {
  date: string
  localRecords: number
  limits: UsageLimits
  latestApi?: LatestApiUsage
}
type RepExportKey =
  | 'ward'
  | 'congressional'
  | 'illinoisHouse'
  | 'illinoisSenate'
  | 'police'
  | 'schoolBoard'
  | 'cookCountyCommissioner'
type RepInfoKey = 'name' | 'phone' | 'email' | 'address' | 'photo' | 'contactUrl'

const MAP_COLORS = ['#267c5a', '#2563eb', '#c2410c', '#7c3aed']
const DEFAULT_USAGE_LIMITS: UsageLimits = {
  cloudflareRequestsPerDay: 100000,
  maxRecordsPerRequest: 20,
  estimatedIpRecordsPerDay: 100000,
  estimatedIpRecordsPerHour: 4167,
  cpuMsPerRequestFree: 10,
  memoryMbPerIsolate: 128,
  externalSubrequestsPerAddress: 1,
  externalSubrequestsPerCoordinate: 2,
  cloudflareExternalSubrequestsPerInvocation: 50,
  simultaneousOpenConnections: 6,
  workerLogsEventsPerDayFree: 200000,
}
const BOUNDARY_LAYERS: BoundaryConfig[] = [
  {
    id: 'ward',
    label: 'Chicago wards',
    shortLabel: 'Wards',
    kind: 'Ward',
    url: '/geojson/chicago-wards.json',
  },
  {
    id: 'congressional',
    label: 'Congressional districts',
    shortLabel: 'Congress',
    kind: 'Congressional district',
    url: '/geojson/illinois-congressional-districts.json',
  },
  {
    id: 'illinoisHouse',
    label: 'Illinois House districts',
    shortLabel: 'IL House',
    kind: 'Illinois House district',
    url: '/geojson/illinois-house.json',
  },
  {
    id: 'illinoisSenate',
    label: 'Illinois Senate districts',
    shortLabel: 'IL Senate',
    kind: 'Illinois Senate district',
    url: '/geojson/illinois-senate.json',
  },
  {
    id: 'police',
    label: 'Chicago police districts',
    shortLabel: 'Police',
    kind: 'Police district council',
    url: '/geojson/chicago-police-districts.json',
  },
  {
    id: 'schoolBoard',
    label: 'Chicago school board districts',
    shortLabel: 'School Board',
    kind: 'School board district',
    url: '/geojson/chicago-school-board.json',
  },
  {
    id: 'cookCountyCommissioner',
    label: 'Cook County commissioners',
    shortLabel: 'Cook County',
    kind: 'Cook County commissioner district',
    url: '/geojson/cook-county-commissioners.json',
  },
]
const REP_EXPORT_OPTIONS: Array<{
  key: RepExportKey
  label: string
  prefix: string
}> = [
  { key: 'ward', label: 'Alderperson', prefix: 'alderperson' },
  {
    key: 'congressional',
    label: 'Congressional rep',
    prefix: 'congressionalRepresentative',
  },
  {
    key: 'illinoisHouse',
    label: 'Illinois House',
    prefix: 'illinoisHouseRepresentative',
  },
  {
    key: 'illinoisSenate',
    label: 'Illinois Senate',
    prefix: 'illinoisSenateRepresentative',
  },
  { key: 'police', label: 'Police council', prefix: 'policeDistrictCouncilors' },
  { key: 'schoolBoard', label: 'School board', prefix: 'schoolBoardMember' },
  {
    key: 'cookCountyCommissioner',
    label: 'Cook County',
    prefix: 'cookCountyCommissioner',
  },
]
const REP_INFO_OPTIONS: Array<{ key: RepInfoKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Street address' },
  { key: 'photo', label: 'Photo' },
  { key: 'contactUrl', label: 'Contact URL' },
]
const SINGLE_RESULT_ROWS: Array<{
  key: RepExportKey
  layer: string
  fallbackLabel: string
}> = [
  { key: 'ward', layer: 'Ward', fallbackLabel: 'Ward' },
  { key: 'congressional', layer: 'Congressional', fallbackLabel: 'District' },
  { key: 'illinoisHouse', layer: 'Illinois House', fallbackLabel: 'District' },
  { key: 'illinoisSenate', layer: 'Illinois Senate', fallbackLabel: 'District' },
  { key: 'police', layer: 'Police district', fallbackLabel: 'District' },
  { key: 'schoolBoard', layer: 'School board', fallbackLabel: 'District' },
  {
    key: 'cookCountyCommissioner',
    layer: 'Cook County',
    fallbackLabel: 'District',
  },
]
const ALL_REP_EXPORT_KEYS = REP_EXPORT_OPTIONS.map((option) => option.key)
const ALL_REP_INFO_KEYS = REP_INFO_OPTIONS.map((option) => option.key)
const BASE_CSV_COLUMNS = [
  'input',
  'status',
  'matchedAddress',
  'ward',
  'congressionalDistrict',
  'illinoisHouseDistrict',
  'illinoisSenateDistrict',
  'policeDistrict',
  'schoolBoardDistrict',
  'cookCountyCommissionerDistrict',
  'latitude',
  'longitude',
  'ambiguous',
  'candidates',
  'error',
]

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function repColumn(prefix: string, field: RepInfoKey) {
  return `${prefix}${field.slice(0, 1).toUpperCase()}${field.slice(1)}`
}

function csvColumns(repKeys: RepExportKey[], infoKeys: RepInfoKey[]) {
  return [
    ...BASE_CSV_COLUMNS,
    ...REP_EXPORT_OPTIONS.filter((option) => repKeys.includes(option.key)).flatMap(
      (option) => infoKeys.map((field) => repColumn(option.prefix, field)),
    ),
  ]
}

function rowsToCsv(
  rows: BatchRow[],
  repKeys: RepExportKey[],
  infoKeys: RepInfoKey[],
) {
  const columns = csvColumns(repKeys, infoKeys)

  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvEscape(String(row[column] ?? ''))).join(','),
    ),
  ].join('\n')
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function outputFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, '') + '-lookups.csv'
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function storedUsage() {
  const date = todayKey()
  const payload = JSON.parse(
    window.localStorage.getItem('chicago-civic-usage') ?? '{}',
  ) as { date?: string; localRecords?: number }

  return {
    date,
    localRecords: payload.date === date ? payload.localRecords ?? 0 : 0,
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : undefined
}

function imageUrl(value: unknown) {
  const image = stringValue(value)
  if (!image) return undefined

  return image.startsWith('http://') || image.startsWith('https://')
    ? image
    : undefined
}

function officialRepresentatives(properties: CivicProperties) {
  if (!Array.isArray(properties.representatives)) return []

  return properties.representatives.flatMap((value) => {
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

function representativeField(region: RegionInfo | undefined, field: RepInfoKey) {
  return (
    region?.representatives
      .map((person) => (field === 'photo' ? person.photo ?? person.image : person[field]))
      .filter(Boolean)
      .join(' | ') ?? ''
  )
}

function representativeCsvFields(regions?: Record<string, RegionInfo | undefined>) {
  return Object.fromEntries(
    REP_EXPORT_OPTIONS.flatMap((option) =>
      REP_INFO_OPTIONS.map((field) => [
        repColumn(option.prefix, field.key),
        representativeField(regions?.[option.key], field.key),
      ]),
    ),
  )
}

function singleResultRegions(result: LookupResult) {
  return {
    ward: result.regions?.ward ?? {
      key: 'ward',
      label: result.ward ? `Ward ${result.ward}` : 'Ward',
      number: result.ward,
      representatives: [],
    },
    congressional:
      result.regions?.congressional ??
      (result.congressionalDistrict
        ? {
            key: 'congressional',
            label: result.congressionalDistrict.name,
            number: result.congressionalDistrict.number,
            representatives: [],
          }
        : undefined),
    illinoisHouse: result.regions?.illinoisHouse,
    illinoisSenate: result.regions?.illinoisSenate,
    police: result.regions?.police,
    schoolBoard: result.regions?.schoolBoard,
    cookCountyCommissioner: result.regions?.cookCountyCommissioner,
  } satisfies Record<RepExportKey, RegionInfo | undefined>
}

function rowFromRecord(record: BulkApiRecord): BatchRow {
  if (record.status === 'error') {
    return {
      input: record.input,
      status: 'error',
      matchedAddress: record.matchedAddress ?? record.locationLabel ?? '',
      ward: record.ward ?? '',
      congressionalDistrict: record.congressionalDistrict?.number ?? '',
      illinoisHouseDistrict: record.regions?.illinoisHouse?.number ?? '',
      illinoisSenateDistrict: record.regions?.illinoisSenate?.number ?? '',
      policeDistrict: record.regions?.police?.number ?? '',
      schoolBoardDistrict: record.regions?.schoolBoard?.number ?? '',
      cookCountyCommissionerDistrict:
        record.regions?.cookCountyCommissioner?.number ?? '',
      ...representativeCsvFields(record.regions),
      latitude: record.coordinates?.latitude?.toFixed(6) ?? '',
      longitude: record.coordinates?.longitude?.toFixed(6) ?? '',
      ambiguous: record.ambiguous ? 'yes' : '',
      candidates: (record.candidates ?? []).join(' | '),
      error: record.error ?? 'Lookup failed',
    }
  }

  return {
    input: record.input,
    status: 'ok',
    matchedAddress: record.matchedAddress ?? record.locationLabel ?? '',
    ward: record.ward ?? '',
    congressionalDistrict: record.congressionalDistrict?.number ?? '',
    illinoisHouseDistrict: record.regions?.illinoisHouse?.number ?? '',
    illinoisSenateDistrict: record.regions?.illinoisSenate?.number ?? '',
    policeDistrict: record.regions?.police?.number ?? '',
    schoolBoardDistrict: record.regions?.schoolBoard?.number ?? '',
    cookCountyCommissionerDistrict:
      record.regions?.cookCountyCommissioner?.number ?? '',
    ...representativeCsvFields(record.regions),
    latitude: record.coordinates?.latitude.toFixed(6) ?? '',
    longitude: record.coordinates?.longitude.toFixed(6) ?? '',
    ambiguous: record.ambiguous ? 'yes' : 'no',
    candidates: (record.candidates ?? []).join(' | '),
    error: '',
  }
}

function lookupFromRecord(record: BulkApiRecord): LookupResult | undefined {
  if (
    record.status !== 'ok' ||
    !record.locationLabel ||
    !record.coordinates
  ) {
    return undefined
  }

  return record as LookupResult
}

function isCoordinateLabel(label: string) {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(label.trim())
}

function locationDisplayLabel(result: LookupResult) {
  return isCoordinateLabel(result.locationLabel)
    ? 'Selected map point'
    : result.locationLabel
}

function regionFromFeature(key: BoundaryOverlay, properties: CivicProperties): RegionInfo {
  const representatives = officialRepresentatives(properties)

  switch (key) {
    case 'ward': {
      const number = stringValue(properties.ward) ?? stringValue(properties.ward_id)

      return {
        key,
        label: `Ward ${number ?? 'Unknown'}`,
        number,
        website: stringValue(properties.website),
        representatives,
      }
    }
    case 'congressional': {
      const number =
        stringValue(properties.DISTRICT)?.replace(/^0+/, '') ??
        stringValue(properties.CD119FP)?.replace(/^0+/, '') ??
        stringValue(properties.CDFIPS)?.replace(/^0+/, '') ??
        stringValue(properties.DISTRICTID)
      return {
        key,
        label: stringValue(properties.NAMELSAD) ?? `Congressional District ${number}`,
        number,
        website: stringValue(properties.WEBSITEURL),
        representatives,
      }
    }
    case 'illinoisHouse':
    case 'illinoisSenate': {
      const label = stringValue(properties.name) ?? 'Illinois district'

      return {
        key,
        label,
        number: label.replace(/^\D+/, ''),
        website: stringValue(properties.website),
        representatives,
      }
    }
    case 'police': {
      return {
        key,
        label: `${stringValue(properties.dist_label)?.toLowerCase() ?? 'Police'} District Council`,
        number: stringValue(properties.dist_num),
        website: stringValue(properties.ccpsaUrl),
        representatives,
      }
    }
    case 'schoolBoard': {
      return {
        key,
        label:
          stringValue(properties.Name)?.replace('Sub ', 'School Board ') ??
          'School Board District',
        number: stringValue(properties.elec_dist) ?? stringValue(properties.ERSB20_DISTRICT),
        population: stringValue(properties.ERSB20_TOTALPOP),
        representatives,
      }
    }
    case 'cookCountyCommissioner': {
      const number = stringValue(properties.DISTRICT_TXT)

      return {
        key,
        label: `Cook County Commissioner District ${number ?? 'Unknown'}`,
        number,
        website: stringValue(properties.website),
        representatives,
      }
    }
  }
}

function regionEntries(regions?: Record<string, RegionInfo | undefined>) {
  const order = [
    'congressional',
    'illinoisHouse',
    'illinoisSenate',
    'police',
    'schoolBoard',
    'cookCountyCommissioner',
    'ward',
  ]

  return order
    .map((key) => regions?.[key])
    .filter((region): region is RegionInfo => Boolean(region))
}

function featureId(properties: CivicProperties, overlay: BoundaryOverlay) {
  if (overlay === 'ward') {
    return stringValue(properties.ward) ?? stringValue(properties.ward_id) ?? 'unknown'
  }

  if (overlay === 'congressional') {
    return (
      stringValue(properties.DISTRICT)?.replace(/^0+/, '') ??
      stringValue(properties.CD119FP)?.replace(/^0+/, '') ??
      stringValue(properties.CDFIPS)?.replace(/^0+/, '') ??
      stringValue(properties.DISTRICTID) ??
      'unknown'
    )
  }

  if (overlay === 'illinoisHouse' || overlay === 'illinoisSenate') {
    return (
      stringValue(properties.name)?.replace(/^\D+/, '') ??
      stringValue(properties.slug)?.match(/\d+$/)?.[0] ??
      'unknown'
    )
  }

  if (overlay === 'police') return stringValue(properties.dist_num) ?? 'unknown'
  if (overlay === 'schoolBoard') {
    return (
      stringValue(properties.elec_dist) ??
      stringValue(properties.ERSB20_DISTRICT) ??
      stringValue(properties.Name) ??
      'unknown'
    )
  }

  return stringValue(properties.DISTRICT_TXT) ?? 'unknown'
}

function ringsFor(feature: CivicFeature) {
  return feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat()
}

function vertexKey(vertex: GeoJSON.Position) {
  return `${vertex[0].toFixed(5)},${vertex[1].toFixed(5)}`
}

function buildMapMeta(data: CivicFeatureCollection | null, overlay: BoundaryOverlay) {
  if (!data) return { colors: new Map<string, string>(), graph: new Map<string, Set<string>>() }

  const vertexOwners = new Map<string, Set<string>>()
  const graph = new Map<string, Set<string>>()

  for (const feature of data.features) {
    const id = featureId(feature.properties, overlay)
    graph.set(id, graph.get(id) ?? new Set())

    for (const ring of ringsFor(feature)) {
      for (const vertex of ring) {
        const key = vertexKey(vertex)
        const owners = vertexOwners.get(key) ?? new Set<string>()
        owners.add(id)
        vertexOwners.set(key, owners)
      }
    }
  }

  for (const owners of vertexOwners.values()) {
    if (owners.size < 2) continue

    const ids = [...owners]
    for (const id of ids) {
      const neighbors = graph.get(id)
      if (!neighbors) continue

      for (const neighbor of ids) {
        if (neighbor !== id) neighbors.add(neighbor)
      }
    }
  }

  const assigned = new Map<string, string>()
  const ids = [...graph.keys()]

  while (assigned.size < ids.length) {
    const next = ids
      .filter((id) => !assigned.has(id))
      .sort((a, b) => {
        const aUsed = new Set(
          [...(graph.get(a) ?? [])].map((id) => assigned.get(id)).filter(Boolean),
        ).size
        const bUsed = new Set(
          [...(graph.get(b) ?? [])].map((id) => assigned.get(id)).filter(Boolean),
        ).size

        return bUsed - aUsed || (graph.get(b)?.size ?? 0) - (graph.get(a)?.size ?? 0)
      })[0]
    const neighborColors = new Set(
      [...(graph.get(next) ?? [])].map((id) => assigned.get(id)),
    )
    const color = MAP_COLORS.find((color) => !neighborColors.has(color))

    assigned.set(next, color ?? MAP_COLORS[assigned.size % MAP_COLORS.length])
  }

  return { colors: assigned, graph }
}

function MapClickLookup({
  onLookup,
}: {
  onLookup: (latitude: number, longitude: number) => void
}) {
  useMapEvents({
    click(event) {
      onLookup(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}

function MapResultFocus({ result }: { result: LookupResult | null }) {
  const map = useMap()

  useEffect(() => {
    if (result) {
      map.setView(
        [result.coordinates.latitude, result.coordinates.longitude],
        13,
      )
    }
  }, [map, result])

  return null
}

function PreviewMapFocus({ results }: { results: LookupResult[] }) {
  const map = useMap()
  const pointKey = results
    .map(
      (result) =>
        `${result.coordinates.latitude.toFixed(6)},${result.coordinates.longitude.toFixed(6)}`,
    )
    .join('|')

  useEffect(() => {
    if (!results.length) return

    const points = results.map(
      (result) =>
        [result.coordinates.latitude, result.coordinates.longitude] as [
          number,
          number,
        ],
    )

    if (points.length === 1) {
      map.setView(points[0], 12)
    } else {
      map.fitBounds(points, { maxZoom: 12, padding: [26, 26] })
    }
  }, [map, pointKey, results])

  return null
}

function ResultsPreviewMap({ results }: { results: LookupResult[] }) {
  const first = results[0]

  if (!first) return null

  return (
    <MapContainer
      className="preview-map"
      center={[first.coordinates.latitude, first.coordinates.longitude]}
      zoom={12}
      scrollWheelZoom={false}
      dragging={results.length > 1}
      zoomControl={results.length > 1}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <PreviewMapFocus results={results} />
      {results.map((result) => (
        <CircleMarker
          key={`${result.locationLabel}-${result.coordinates.latitude}-${result.coordinates.longitude}`}
          center={[result.coordinates.latitude, result.coordinates.longitude]}
          pathOptions={{ color: '#7f1d1d', fillColor: '#ef4444', fillOpacity: 0.9 }}
          radius={7}
          bubblingMouseEvents={false}
        >
          <Tooltip sticky>{locationDisplayLabel(result)}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

function RepresentativeCards({
  regions,
  title = 'Representatives',
}: {
  regions?: Record<string, RegionInfo | undefined>
  title?: string
}) {
  const entries = regionEntries(regions)

  if (!entries.length) return null

  return (
    <div className="rep-section">
      <span className="label">{title}</span>
      <div className="rep-list">
        {entries.map((region) => (
          <article className="rep-card" key={region.key}>
            <div className="rep-card-head">
              <span>{region.label}</span>
              {region.population && (
                <small>{Number(region.population).toLocaleString()} people</small>
              )}
            </div>
            {region.representatives.map((person) => (
              <div className="person-row" key={`${region.key}-${person.name}`}>
                {person.image ? (
                  <img src={person.image} alt="" loading="lazy" />
                ) : (
                  <div className="person-placeholder" aria-hidden="true">
                    {person.name.slice(0, 1)}
                  </div>
                )}
                <div>
                  <strong>{person.name}</strong>
                  {person.title && <span>{person.title}</span>}
                  {person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}
                  {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
                  {person.address && <small>{person.address}</small>}
                  {person.contactUrl && (
                    <a href={person.contactUrl} target="_blank" rel="noreferrer">
                      Contact
                    </a>
                  )}
                </div>
              </div>
            ))}
            {region.website &&
              !region.representatives.some(
                (person) => person.contactUrl === region.website,
              ) && (
              <a
                className="rep-link"
                href={region.website}
                target="_blank"
                rel="noreferrer"
              >
                Website
              </a>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function personContact(person: PersonInfo) {
  if (person.email) {
    return (
      <a href={`mailto:${person.email}`} title={person.email}>
        Email
      </a>
    )
  }

  if (person.phone) {
    return (
      <a href={`tel:${person.phone}`} title={person.phone}>
        Phone
      </a>
    )
  }

  if (person.contactUrl ?? person.website) {
    return (
      <a href={person.contactUrl ?? person.website} target="_blank" rel="noreferrer">
        Contact
      </a>
    )
  }

  return <span className="muted">Not published</span>
}

function CivicResultTable({ result }: { result: LookupResult }) {
  const regions = singleResultRegions(result)

  return (
    <div className="civic-table-wrap">
      <table className="civic-table">
        <thead>
          <tr>
            <th>Layer</th>
            <th>Index</th>
            <th>Representative</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {SINGLE_RESULT_ROWS.map((row) => {
            const region = regions[row.key]
            const reps = region?.representatives ?? []

            return (
              <tr key={row.key}>
                <td>
                  <span className="layer-name">{row.layer}</span>
                </td>
                <td>
                  <strong>
                    {region?.number
                      ? `${row.fallbackLabel} ${region.number}`
                      : 'Not found'}
                  </strong>
                </td>
                <td>
                  {reps.length ? (
                    <div className="table-people">
                      {reps.map((person) => (
                        <span key={`${row.key}-${person.name}`}>
                          {person.name}
                          {person.title && <small>{person.title}</small>}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">Not published</span>
                  )}
                </td>
                <td>
                  {reps.length ? (
                    <div className="contact-links">
                      {reps.map((person) => (
                        <span key={`${row.key}-${person.name}-contact`}>
                          {personContact(person)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">Not published</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CsvExportControls({
  selectedReps,
  selectedFields,
  onRepChange,
  onFieldChange,
}: {
  selectedReps: RepExportKey[]
  selectedFields: RepInfoKey[]
  onRepChange: (key: RepExportKey, checked: boolean) => void
  onFieldChange: (key: RepInfoKey, checked: boolean) => void
}) {
  return (
    <div className="csv-options">
      <fieldset>
        <legend>Representatives</legend>
        {REP_EXPORT_OPTIONS.map((option) => (
          <label key={option.key}>
            <input
              type="checkbox"
              checked={selectedReps.includes(option.key)}
              onChange={(event) => onRepChange(option.key, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Info</legend>
        {REP_INFO_OPTIONS.map((option) => (
          <label key={option.key}>
            <input
              type="checkbox"
              checked={selectedFields.includes(option.key)}
              onChange={(event) => onFieldChange(option.key, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </div>
  )
}

function FullscreenMap({
  password,
  externalResults,
  onLookupUsage,
  onLatestApiUsage,
}: {
  password: string
  externalResults: LookupResult[]
  onLookupUsage: (records: number) => void
  onLatestApiUsage: (usage?: LatestApiUsage) => void
}) {
  const [enabledLayers, setEnabledLayers] = useState<BoundaryOverlay[]>([
    'ward',
    'congressional',
  ])
  const [boundaryData, setBoundaryData] = useState<
    Partial<Record<BoundaryOverlay, CivicFeatureCollection>>
  >({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedOverlay, setSelectedOverlay] = useState<BoundaryOverlay>('ward')
  const [selectedFeature, setSelectedFeature] = useState<CivicFeature | null>(null)
  const [mapResult, setMapResult] = useState<LookupResult | null>(null)
  const [focusResult, setFocusResult] = useState<LookupResult | null>(
    externalResults[0] ?? null,
  )
  const [mapError, setMapError] = useState('')
  const [mapAddress, setMapAddress] = useState('')
  const [mapZip, setMapZip] = useState('')
  const [regionSearch, setRegionSearch] = useState('')

  useEffect(() => {
    Promise.all(
      BOUNDARY_LAYERS.map(async (layer) => {
        const response = await fetch(layer.url)

        return [layer.id, await response.json()] as const
      }),
    ).then((entries) => setBoundaryData(Object.fromEntries(entries)))
  }, [])

  const layerMeta = Object.fromEntries(
    BOUNDARY_LAYERS.map((layer) => [
      layer.id,
      buildMapMeta(boundaryData[layer.id] ?? null, layer.id),
    ]),
  ) as Record<BoundaryOverlay, ReturnType<typeof buildMapMeta>>

  function highlightLookupBoundary(lookup: LookupResult) {
    const nextOverlay =
      enabledLayers.find((layer) => lookup.regions?.[layer]?.number) ??
      'ward'
    const collection = boundaryData[nextOverlay]
    const target = lookup.regions?.[nextOverlay]?.number
    const feature = collection?.features.find((feature) => {
      const id = featureId(feature.properties, nextOverlay).replace(/^0+/, '')

      return id === target?.replace(/^0+/, '')
    })

    if (feature) {
      setSelectedId(featureId(feature.properties, nextOverlay))
      setSelectedOverlay(nextOverlay)
      setSelectedFeature(feature)
    }
  }

  const visibleMapResults = mapResult
    ? [
        mapResult,
        ...externalResults.filter(
          (result) =>
            result.locationLabel !== mapResult.locationLabel ||
            result.coordinates.latitude !== mapResult.coordinates.latitude ||
            result.coordinates.longitude !== mapResult.coordinates.longitude,
        ),
      ]
    : externalResults
  const visibleMapResult = mapResult ?? externalResults[0] ?? null
  const focusTarget = focusResult ?? externalResults[0] ?? null

  function selectLookup(result: LookupResult) {
    setMapResult(result)
    highlightLookupBoundary(result)
    setMapError('')
  }

  function selectFeature(feature: CivicFeature, nextOverlay: BoundaryOverlay) {
    const id = featureId(feature.properties, nextOverlay)

    setSelectedId(id)
    setSelectedOverlay(nextOverlay)
    setSelectedFeature(feature)
    setMapResult(null)
    setMapError('')
  }

  async function lookupSingleRecord(record: string | Record<string, string | number>) {
    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(password ? { 'x-app-password': password } : {}),
      },
      body: JSON.stringify({ records: [record] }),
    })
    const payload = await response.json()
    const result = (payload.records as BulkApiRecord[] | undefined)?.[0]

    if (!response.ok || result?.status !== 'ok') {
      throw new Error(result?.error ?? payload.error ?? 'The lookup failed.')
    }

    onLatestApiUsage(payload.usage)

    return result as BulkApiRecord & LookupResult
  }

  async function lookupPoint(latitude: number, longitude: number) {
    let payload: LookupResult

    try {
      payload = await lookupSingleRecord({ latitude, longitude })
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'The map lookup failed.')
      return
    }

    setMapResult(payload)
    setFocusResult(payload)
    highlightLookupBoundary(payload)
    setMapError('')
    onLookupUsage(1)
  }

  async function searchMapAddress(event: FormEvent) {
    event.preventDefault()

    let payload: LookupResult

    try {
      payload = await lookupSingleRecord({
        address: mapAddress,
        zip: mapZip.trim(),
      })
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'The address lookup failed.')
      return
    }

    setMapResult(payload)
    setFocusResult(payload)
    highlightLookupBoundary(payload)
    setMapError('')
    onLookupUsage(1)
  }

  function findRegion(event: FormEvent) {
    event.preventDefault()

    const requested = regionSearch.trim().toLowerCase()
    const layerMatch = BOUNDARY_LAYERS.find((layer) =>
      requested.startsWith(layer.shortLabel.toLowerCase()) ||
      requested.startsWith(layer.label.toLowerCase()) ||
      requested.startsWith(layer.id.toLowerCase()),
    )
    const candidateLayers = layerMatch
      ? [layerMatch.id]
      : requested.startsWith('district') || requested.startsWith('d ')
        ? enabledLayers.filter((layer) => layer !== 'ward')
        : requested.startsWith('ward') || requested.startsWith('w ')
          ? (['ward'] satisfies BoundaryOverlay[])
          : enabledLayers
    const normalized = requested
      .replace(
        /^(ward|district|w|d|congressional|congress|il house|illinois house|house|il senate|illinois senate|senate|police|school board|school|cook county|cook)\s*/i,
        '',
      )
      .replace(/^0+/, '')
    let match: CivicFeature | undefined
    let targetOverlay: BoundaryOverlay | undefined

    for (const layer of candidateLayers) {
      match = boundaryData[layer]?.features.find((feature) => {
        const id = featureId(feature.properties, layer).replace(/^0+/, '')

        return id === normalized
      })

      if (match) {
        targetOverlay = layer
        break
      }
    }

    if (match && targetOverlay) {
      selectFeature(match, targetOverlay)
      setMapError('')
    } else {
      setMapError(`No matching region for ${regionSearch}.`)
    }
  }

  function renderBoundary(collection: CivicFeatureCollection | null, nextOverlay: BoundaryOverlay) {
    const meta = layerMeta[nextOverlay]

    if (!collection) return null

    return (
      <GeoJSON
        key={`${nextOverlay}-${selectedOverlay}-${selectedId ?? 'none'}-${enabledLayers.join('-')}`}
        data={collection as GeoJsonObject}
        style={(feature) => {
          const properties = feature?.properties as CivicProperties
          const id = featureId(properties, nextOverlay)
          const color = meta.colors.get(id) ?? MAP_COLORS[0]
          const lookupNumber = visibleMapResult?.regions?.[nextOverlay]?.number
          const selectedFromLookup =
            lookupNumber &&
            id.replace(/^0+/, '') === lookupNumber.replace(/^0+/, '')
          const selected =
            (id === selectedId && nextOverlay === selectedOverlay) ||
            Boolean(selectedFromLookup)

          return {
            color: selected ? '#374151' : color,
            dashArray: nextOverlay === 'congressional' ? '6 5' : undefined,
            fillColor: color,
            fillOpacity: selected ? 0.3 : 0.12,
            opacity: selected ? 0.95 : 0.72,
            weight: selected ? 3 : 2,
          }
        }}
        onEachFeature={(feature, layer: Layer) => {
          const typedFeature = feature as CivicFeature
          layer.on('click', (event: LeafletMouseEvent) => {
            event.originalEvent.stopPropagation()
            selectFeature(typedFeature, nextOverlay)
          })
        }}
      />
    )
  }

  const selectedRegion = selectedFeature
    ? regionFromFeature(selectedOverlay, selectedFeature.properties)
    : undefined

  return (
    <section className="map-screen">
      <div className="map-toolbar">
        <div>
          <span className="eyebrow">
            <MapPin size={16} aria-hidden="true" />
            Boundary map
          </span>
          <h1>Reuben's Region Recombobulator</h1>
        </div>
        <fieldset className="layer-checklist">
          <legend>Map layers</legend>
          {BOUNDARY_LAYERS.map((layer) => (
            <label key={layer.id}>
              <input
                type="checkbox"
                checked={enabledLayers.includes(layer.id)}
                onChange={(event) => {
                  setEnabledLayers((current) =>
                    event.target.checked
                      ? [...current, layer.id]
                      : current.filter((id) => id !== layer.id),
                  )
                  setSelectedId(null)
                }}
              />
              {layer.shortLabel}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="map-search-row">
        <form className="map-search" onSubmit={searchMapAddress}>
          <input
            value={mapAddress}
            onChange={(event) => setMapAddress(event.target.value)}
            placeholder="Address"
            required
          />
          <input
            value={mapZip}
            onChange={(event) => setMapZip(event.target.value)}
            placeholder="ZIP optional"
            inputMode="numeric"
          />
          <button type="submit">Search</button>
        </form>
        <form className="map-search region-search" onSubmit={findRegion}>
          <input
            value={regionSearch}
            onChange={(event) => setRegionSearch(event.target.value)}
            placeholder="Ward, district, house..."
            required
          />
          <button type="submit">Find</button>
        </form>
      </div>

      <div className="map-workspace">
        <MapContainer
          className="boundary-map"
          center={[41.8781, -87.6298]}
          zoom={11}
          minZoom={10}
          maxZoom={15}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickLookup onLookup={lookupPoint} />
          <MapResultFocus result={focusTarget} />
          <Pane name="boundary-pane" style={{ zIndex: 410 }}>
            {enabledLayers.map((layer) =>
              renderBoundary(boundaryData[layer] ?? null, layer),
            )}
          </Pane>
          <Pane name="point-pane" style={{ zIndex: 650 }}>
            {visibleMapResults.map((result) => (
              <CircleMarker
                key={`${result.locationLabel}-${result.coordinates.latitude}-${result.coordinates.longitude}`}
                center={[result.coordinates.latitude, result.coordinates.longitude]}
                pathOptions={{ color: '#7f1d1d', fillColor: '#ef4444', fillOpacity: 0.9 }}
                radius={7}
                bubblingMouseEvents={false}
                eventHandlers={{
                  click(event) {
                    event.originalEvent.stopPropagation()
                    selectLookup(result)
                  },
                }}
              >
                <Tooltip sticky direction="top" opacity={0.96}>
                  {locationDisplayLabel(result)}
                </Tooltip>
                {mapResult === result && (
                  <Popup>{locationDisplayLabel(result)}</Popup>
                )}
              </CircleMarker>
            ))}
          </Pane>
        </MapContainer>

        <aside className="map-info-panel">
          <span className="label">Selection</span>
          {mapError && <p className="error">{mapError}</p>}
          {visibleMapResult && (
            <div className="info-stack">
              <strong>{locationDisplayLabel(visibleMapResult)}</strong>
              <span>Ward {visibleMapResult.ward ?? 'Unknown'}</span>
              <span>
                District {visibleMapResult.congressionalDistrict?.number ?? 'Unknown'}
              </span>
              <span>
                {visibleMapResult.coordinates.latitude.toFixed(6)},{' '}
                {visibleMapResult.coordinates.longitude.toFixed(6)}
              </span>
              {visibleMapResult.ambiguous && (
                <span>Multiple possible matches: {visibleMapResult.candidates?.join(' | ')}</span>
              )}
            </div>
          )}
          {visibleMapResult?.regions && (
            <RepresentativeCards
              regions={visibleMapResult.regions}
              title="Your representatives"
            />
          )}
          {selectedRegion && (
            <RepresentativeCards
              regions={{ [selectedRegion.key]: selectedRegion }}
              title="Region representative"
            />
          )}
          {!visibleMapResult && !selectedRegion && !mapError && (
            <p>Click a map region, click a point, or search above.</p>
          )}
        </aside>
      </div>
    </section>
  )
}

function initialPassword() {
  const url = new URL(window.location.href)
  const password =
    url.searchParams.get('auth') ??
    url.searchParams.get('code') ??
    url.searchParams.get('password') ??
    window.sessionStorage.getItem('chicago-civic-password') ??
    ''

  if (
    url.searchParams.has('auth') ||
    url.searchParams.has('code') ||
    url.searchParams.has('password')
  ) {
    url.searchParams.delete('auth')
    url.searchParams.delete('code')
    url.searchParams.delete('password')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    window.sessionStorage.setItem('chicago-civic-password', password)
  }

  return password
}

function App() {
  const [activeTab, setActiveTab] = useState<'lookup' | 'map'>('lookup')
  const [mode, setMode] = useState<'address' | 'coordinates'>('address')
  const [addressList, setAddressList] = useState('')
  const [addressColumn, setAddressColumn] = useState('')
  const [fileName, setFileName] = useState('')
  const [fileRows, setFileRows] = useState<Record<string, string>[]>([])
  const [coordinatePair, setCoordinatePair] = useState('')
  const [csvRepKeys, setCsvRepKeys] = useState<RepExportKey[]>(
    ALL_REP_EXPORT_KEYS,
  )
  const [csvInfoKeys, setCsvInfoKeys] = useState<RepInfoKey[]>(ALL_REP_INFO_KEYS)
  const [password, setPassword] = useState(initialPassword)
  const [passwordInput, setPasswordInput] = useState('')
  const [unlocked, setUnlocked] = useState(() => Boolean(initialPassword()))
  const [result, setResult] = useState<LookupWithExport | null>(null)
  const [mapSeedResults, setMapSeedResults] = useState<LookupResult[]>([])
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [usage, setUsage] = useState<UsageSummary>(() => ({
    ...storedUsage(),
    limits: DEFAULT_USAGE_LIMITS,
  }))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const csvOutput = rowsToCsv(batchRows, csvRepKeys, csvInfoKeys)
  const singleExportCsv = result?.csvRow
    ? rowsToCsv([result.csvRow], csvRepKeys, csvInfoKeys)
    : ''

  useEffect(() => {
    fetch('/api/usage')
      .then((response) => response.json())
      .then((payload: { date?: string; limits?: UsageLimits }) => {
        setUsage((current) => ({
          date: payload.date ?? current.date,
          localRecords:
            payload.date && payload.date !== current.date ? 0 : current.localRecords,
          limits: payload.limits ?? current.limits,
        }))
      })
  }, [])

  function addLocalUsage(records: number) {
    const current = storedUsage()
    const next = {
      date: current.date,
      localRecords: current.localRecords + records,
    }
    window.localStorage.setItem('chicago-civic-usage', JSON.stringify(next))
    setUsage((usage) => ({ ...usage, ...next }))
  }

  function setLatestApiUsage(latestApi?: LatestApiUsage) {
    if (!latestApi) return
    setUsage((usage) => ({ ...usage, latestApi }))
  }

  function toggleCsvRep(key: RepExportKey, checked: boolean) {
    setCsvRepKeys((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    )
  }

  function toggleCsvInfo(key: RepInfoKey, checked: boolean) {
    setCsvInfoKeys((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    )
  }

  function handleLogin(event: FormEvent) {
    event.preventDefault()
    const nextPassword = passwordInput.trim()
    setPassword(nextPassword)
    setUnlocked(Boolean(nextPassword))
    window.sessionStorage.setItem('chicago-civic-password', nextPassword)
  }

  function bestAddressColumn(rows: Record<string, string>[]) {
    if (addressColumn.trim()) return addressColumn.trim()

    const firstRow = rows[0] ?? {}
    const columns = Object.keys(firstRow)

    return (
      columns.find((column) => /address|street|location/i.test(column)) ??
      columns[0] ??
      ''
    )
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const workbook = XLSX.read(await file.arrayBuffer())
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
      raw: false,
    })

    setFileName(file.name)
    setFileRows(rows)
  }

  async function lookupBulk(records: string[], defaultZip: string) {
    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(password ? { 'x-app-password': password } : {}),
      },
      body: JSON.stringify({
        records,
        defaultZip: defaultZip.trim() || undefined,
      }),
    })
    const payload = await response.json()

    if (!response.ok) {
      if (response.status === 401) {
        window.sessionStorage.removeItem('chicago-civic-password')
        setPassword('')
        setPasswordInput('')
        setUnlocked(false)
      }

      throw new Error(payload.error ?? 'The bulk lookup failed.')
    }

    const attempts = (payload.records as BulkApiRecord[]).map((record) => ({
      lookup: lookupFromRecord(record),
      row: rowFromRecord(record),
    }))
    addLocalUsage(attempts.length)
    setLatestApiUsage(payload.usage)

    return attempts satisfies LookupAttempt[]
  }

  function batchInputs() {
    if (fileRows.length) {
      const column = bestAddressColumn(fileRows)
      return fileRows.map((row) => String(row[column] ?? '').trim()).filter(Boolean)
    }

    return addressList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)
    setBatchRows([])

    if (mode === 'address') {
      const inputs = batchInputs()
      let attempts: LookupAttempt[]

      try {
        attempts = await lookupBulk(inputs, '')
      } catch (error) {
        setLoading(false)
        setError(error instanceof Error ? error.message : 'The bulk lookup failed.')
        return
      }

      const rows = attempts.map((attempt) => attempt.row)
      const singleManualAddress = !fileRows.length && inputs.length === 1
      setBatchRows(singleManualAddress ? [] : rows)
      const firstOk = attempts.find((attempt) => attempt.lookup)
      const lookups = attempts
        .map((attempt) => attempt.lookup)
        .filter((lookup): lookup is LookupResult => Boolean(lookup))
      setMapSeedResults(lookups)
      if (firstOk) {
        setResult(
          singleManualAddress
            ? { ...firstOk.lookup!, csvRow: firstOk.row }
            : null,
        )
      } else if (singleManualAddress && rows[0]) {
        setError(rows[0].error)
      }

      setLoading(false)
      return
    }

    try {
      const attempts = await lookupBulk([coordinatePair], '')
      const first = attempts[0]

      setLoading(false)

      if (!first?.lookup) {
        setError(first?.row.error ?? 'The lookup failed.')
        return
      }

      window.sessionStorage.setItem('chicago-civic-password', password)
      setResult({ ...first.lookup, csvRow: first.row })
      setMapSeedResults([first.lookup])
    } catch (error) {
      setLoading(false)
      setError(error instanceof Error ? error.message : 'The lookup failed.')
      return
    }
  }

  if (!unlocked) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <span className="eyebrow">
            <KeyRound size={16} aria-hidden="true" />
            Access code
          </span>
          <h1>Reuben's Region Recombobulator</h1>
          <label>
            Password
            <input
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit">Continue</button>
        </form>
      </main>
    )
  }

  return (
    <main className={activeTab === 'map' ? 'app fullscreen' : 'app'}>
      <nav className="app-tabs" aria-label="App views">
        <button
          type="button"
          className={activeTab === 'lookup' ? 'active' : ''}
          onClick={() => setActiveTab('lookup')}
        >
          Lookup
        </button>
        <button
          type="button"
          className={activeTab === 'map' ? 'active' : ''}
          onClick={() => setActiveTab('map')}
        >
          Map
        </button>
      </nav>

      {activeTab === 'map' ? (
        <FullscreenMap
          password={password}
          externalResults={mapSeedResults}
          onLookupUsage={addLocalUsage}
          onLatestApiUsage={setLatestApiUsage}
        />
      ) : (
        <div className="shell">
          <section className="lookup">
        <div className="intro">
          <span className="eyebrow">
            <MapPin size={16} aria-hidden="true" />
            Reuben's Region Recombobulator
          </span>
          <h1>Lookup of ward and congressional district</h1>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <div className="mode-switch" role="tablist" aria-label="Lookup mode">
            <button
              type="button"
              className={mode === 'address' ? 'active' : ''}
              onClick={() => setMode('address')}
            >
              Address
            </button>
            <button
              type="button"
              className={mode === 'coordinates' ? 'active' : ''}
              onClick={() => setMode('coordinates')}
            >
              Coordinates
            </button>
          </div>

          {mode === 'address' ? (
            <>
              <label className="wide-field">
                Addresses
                <textarea
                  value={addressList}
                  onChange={(event) => setAddressList(event.target.value)}
                  placeholder={'121 N LaSalle St\n41.985 N Clark St'}
                  rows={6}
                />
              </label>

              <div className="upload-row wide-field">
                <label>
                  Upload CSV/XLSX
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFile}
                  />
                </label>
                <label>
                  <span className="help-label">
                    Address column
                    <HelpCircle size={15} aria-hidden="true" />
                    <span className="instant-tooltip" role="tooltip">
                      Optional. If your spreadsheet has multiple columns, enter
                      the column name that contains the street address. Leave
                      blank to auto-detect.
                    </span>
                  </span>
                  <input
                    value={addressColumn}
                    onChange={(event) => setAddressColumn(event.target.value)}
                    placeholder="auto"
                  />
                </label>
              </div>
              {fileName && (
                <div className="file-note">
                  Using {fileRows.length.toLocaleString()} rows from {fileName}
                </div>
              )}
            </>
          ) : (
            <label className="wide-field">
              Coordinates
              <input
                value={coordinatePair}
                onChange={(event) => setCoordinatePair(event.target.value)}
                placeholder="41.985,-87.668"
                inputMode="decimal"
                required
              />
            </label>
          )}

          <button type="submit" disabled={loading}>
            {loading ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : (
              <Search size={18} aria-hidden="true" />
            )}
            Look up address
          </button>
        </form>
          </section>

          <section className="result" aria-live="polite">
        {!result && !error && !batchRows.length && (
          <div className="empty">
            <p>Try a known Chicago address to see the civic districts.</p>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="result-stack">
            <div className="map-panel">
              <ResultsPreviewMap results={[result]} />
            </div>
            <button
              type="button"
              className="open-map-button"
              onClick={() => setActiveTab('map')}
            >
              Open map view
            </button>

            <div className="result-grid context-grid">
              <div className="wide">
                <span className="label">Location</span>
                <strong>{result.locationLabel}</strong>
              </div>
              <div className="wide muted">
                <span className="label">Coordinates</span>
                <span>
                  {result.coordinates.latitude.toFixed(6)},{' '}
                  {result.coordinates.longitude.toFixed(6)}
                </span>
              </div>
              {result.ambiguous && (
                <div className="wide muted">
                  <span className="label">Possible matches</span>
                  <span>{result.candidates?.join(' | ')}</span>
                </div>
              )}
            </div>
            <CivicResultTable result={result} />
            {singleExportCsv && (
              <div className="batch-output compact-output">
                <CsvExportControls
                  selectedReps={csvRepKeys}
                  selectedFields={csvInfoKeys}
                  onRepChange={toggleCsvRep}
                  onFieldChange={toggleCsvInfo}
                />
                <div className="batch-actions">
                  <span className="label">CSV export</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(singleExportCsv)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(outputFilename(fileName || 'addresses.csv'), singleExportCsv)
                    }
                  >
                    <Download size={16} aria-hidden="true" />
                    Download
                  </button>
                </div>
                <textarea readOnly value={singleExportCsv} rows={4} />
              </div>
            )}
          </div>
        )}

        {batchRows.length > 0 && (
          <div className="batch-output">
            {mapSeedResults.length > 0 && (
              <>
                <div className="map-panel">
                  <ResultsPreviewMap results={mapSeedResults} />
                </div>
                <button
                  type="button"
                  className="open-map-button"
                  onClick={() => setActiveTab('map')}
                >
                  Open map view
                </button>
              </>
            )}
            <div className="batch-summary">
              <strong>{batchRows.length.toLocaleString()} addresses processed</strong>
              <span>
                {batchRows.filter((row) => row.status === 'ok').length.toLocaleString()} matched,{' '}
                {batchRows.filter((row) => row.status === 'error').length.toLocaleString()} errors
              </span>
            </div>
            <CsvExportControls
              selectedReps={csvRepKeys}
              selectedFields={csvInfoKeys}
              onRepChange={toggleCsvRep}
              onFieldChange={toggleCsvInfo}
            />
            <div className="batch-actions">
              <span className="label">CSV output</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(csvOutput)}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadText(outputFilename(fileName || 'addresses.csv'), csvOutput)
                }
              >
                <Download size={16} aria-hidden="true" />
                Download
              </button>
            </div>
            <textarea readOnly value={csvOutput} rows={10} />
          </div>
        )}
          </section>

          <section className="page-footer-panel" aria-label="Usage and API access">
            <div className="usage-panel">
              <div>
                <span className="eyebrow">
                  <BarChart3 size={16} aria-hidden="true" />
                  Daily usage
                </span>
                <strong>{usage.localRecords.toLocaleString()}</strong>
                <span>records from this browser today</span>
              </div>
              <div>
                <span className="label">Latest API</span>
                <strong>
                  {usage.latestApi?.wallMs !== undefined
                    ? `${usage.latestApi.wallMs.toLocaleString()} ms`
                    : '-'}
                </strong>
                <span>wall time</span>
              </div>
              <div>
                <span className="label">Subrequests</span>
                <strong>
                  {usage.latestApi?.estimatedExternalSubrequests !== undefined
                    ? usage.latestApi.estimatedExternalSubrequests.toLocaleString()
                    : '-'}
                </strong>
                <span>latest estimate</span>
              </div>
            </div>

            <div className="api-overview">
              <span className="label">API access</span>
              <p>
                Send a POST request to <code>/api/lookup</code> with
                <code> x-app-password</code> and a JSON <code>records</code> array.
                Records can be street-address strings, coordinate strings, or objects
                with address/latitude/longitude fields. The response returns JSON
                records plus a small usage object.
              </p>
              <pre>{`curl -X POST 'https://chicago-civic-finder.pages.dev/api/lookup' \\
  -H 'content-type: application/json' \\
  -H 'x-app-password: change-me' \\
  --data '{"records":["4226 N Ashland Ave","41.945702,-87.668495"]}'`}</pre>
              <p>
                Current app limits: {usage.limits.maxRecordsPerRequest} records per
                request, {usage.limits.estimatedIpRecordsPerHour.toLocaleString()}{' '}
                records per IP per hour,{' '}
                {usage.limits.estimatedIpRecordsPerDay.toLocaleString()} records per IP
                per day, and{' '}
                {usage.limits.cloudflareRequestsPerDay.toLocaleString()} Cloudflare
                Function requests per day across the app.
              </p>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
