import { readFile } from 'node:fs/promises'

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>
type Collection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>

const fields = ['name', 'email', 'phone', 'address', 'photo'] as const
const root = new URL('..', import.meta.url)
const files = {
  ward: 'chicago-wards.json',
  congressional: 'illinois-congressional-districts.json',
  illinoisHouse: 'illinois-house.json',
  illinoisSenate: 'illinois-senate.json',
  police: 'chicago-police-districts.json',
  schoolBoard: 'chicago-school-board.json',
  cookCountyCommissioner: 'cook-county-commissioners.json',
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : undefined
}

async function readJson(file: string) {
  return JSON.parse(
    await readFile(new URL(`public/geojson/${file}`, root), 'utf8'),
  ) as Collection
}

function reps(feature: Feature | undefined) {
  return (feature?.properties.representatives ?? []) as Array<
    Record<string, unknown>
  >
}

function names(feature: Feature | undefined) {
  return reps(feature).map((rep) => stringValue(rep.name)).filter(Boolean)
}

function contactUrls(feature: Feature | undefined) {
  return reps(feature).map((rep) => stringValue(rep.contactUrl)).filter(Boolean)
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function byRegionId(regionType: keyof typeof files, feature: Feature) {
  const props = feature.properties
  if (regionType === 'ward') return stringValue(props.ward) ?? stringValue(props.ward_id)
  if (regionType === 'police') return stringValue(props.dist_num)
  if (regionType === 'schoolBoard') return stringValue(props.Name)
  if (regionType === 'cookCountyCommissioner') return stringValue(props.DISTRICT_TXT)
  if (regionType === 'illinoisHouse' || regionType === 'illinoisSenate') {
    return stringValue(props.name)?.replace(/^\D+/, '')
  }
  return stringValue(props.DISTRICT)?.replace(/^0+/, '') ?? stringValue(props.CD119FP)?.replace(/^0+/, '')
}

function findFeature(
  collection: Collection,
  regionType: keyof typeof files,
  id: string,
) {
  return collection.features.find((feature) => byRegionId(regionType, feature) === id)
}

async function main() {
  const collections = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, file]) => [key, await readJson(file)]),
    ),
  ) as Record<keyof typeof files, Collection>

  for (const [regionType, collection] of Object.entries(collections)) {
    for (const feature of collection.features) {
      assert(
        Array.isArray(feature.properties.representatives),
        `${regionType} feature missing representatives`,
      )
      for (const rep of reps(feature)) {
        const fieldStatus = rep.fieldStatus as Record<string, unknown> | undefined
        for (const field of fields) {
          const status = fieldStatus?.[field] as
            | Record<string, unknown>
            | undefined
          assert(status, `${regionType} rep missing ${field} status`)
          assert(
            status.status === 'value' || status.status === 'unavailable',
            `${regionType} rep has invalid ${field} status`,
          )
          assert(stringValue(status.source), `${regionType} rep missing ${field} source`)
          assert(
            stringValue(status.fetchedAt),
            `${regionType} rep missing ${field} fetchedAt`,
          )
        }
      }
    }
  }

  const spotChecks: Array<[keyof typeof files, string, string]> = [
    ['ward', '35', 'Anthony J. Quezada'],
    ['schoolBoard', 'Sub District 9a', 'Dr. Angel L. Velez'],
    ['cookCountyCommissioner', '2', 'Michael Scott Jr.'],
    ['cookCountyCommissioner', '5', 'Dr. Kisha McCaskill'],
    ['cookCountyCommissioner', '8', 'Jessica Vásquez'],
    ['police', '17', 'Luis Bermudez'],
  ]

  for (const [regionType, id, expectedName] of spotChecks) {
    const feature = findFeature(collections[regionType], regionType, id)
    assert(
      names(feature).includes(expectedName),
      `${regionType} ${id} missing ${expectedName}`,
    )
  }

  const contactChecks: Array<[keyof typeof files, string, RegExp]> = [
    ['congressional', '5', /quigley\.house\.gov/i],
    ['illinoisSenate', '7', /ilga\.gov\/Senate\/Members\/Details/i],
    ['police', '17', /ccpsa\.chicago\.gov/i],
    ['schoolBoard', 'Sub District 9a', /cpsboe\.org\/about\/bios/i],
    ['cookCountyCommissioner', '5', /cookcountyil\.gov/i],
  ]

  for (const [regionType, id, expectedUrl] of contactChecks) {
    const feature = findFeature(collections[regionType], regionType, id)
    assert(
      contactUrls(feature).some((url) => expectedUrl.test(url)),
      `${regionType} ${id} missing expected contact URL`,
    )
  }

  const coverage = await readFile(
    new URL('data/generated/representative-coverage.csv', root),
    'utf8',
  )
  for (const regionType of Object.keys(files)) {
    for (const field of fields) {
      assert(
        coverage.includes(`${regionType},`) && coverage.includes(`,${field},`),
        `coverage missing ${regionType} ${field}`,
      )
    }
  }

  const staleDiff = JSON.parse(
    await readFile(new URL('data/generated/stale-diff.json', root), 'utf8'),
  ) as { diffs?: Array<{ after?: string[] }> }
  const staleNames = new Set(staleDiff.diffs?.flatMap((diff) => diff.after ?? []))
  for (const expectedName of [
    'Anthony J. Quezada',
    'Dr. Angel L. Velez',
    'Michael Scott Jr.',
    'Dr. Kisha McCaskill',
    'Jessica Vásquez',
    'Luis Bermudez',
  ]) {
    assert(staleNames.has(expectedName), `stale diff missing ${expectedName}`)
  }

  console.log('generated data validation passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
