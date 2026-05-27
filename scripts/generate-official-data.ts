import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

type Feature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
>
type Collection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
>
type FieldName = 'name' | 'email' | 'phone' | 'address' | 'photo'
type FieldStatus =
  | {
      status: 'value'
      value: string
      source: string
      fetchedAt: string
    }
  | {
      status: 'unavailable'
      source: string
      fetchedAt: string
      reason: string
    }
type OfficialRepresentative = {
  title?: string
  name?: string
  email?: string
  phone?: string
  address?: string
  photo?: string
  image?: string
  website?: string
  contactUrl?: string
  fieldStatus: Record<FieldName, FieldStatus>
}
type PersonRecord = {
  title?: string
  name?: string
  email?: string
  phone?: string
  address?: string
  photo?: string
  website?: string
  contactUrl?: string
  sources?: Partial<Record<FieldName, string>>
}
type CoverageRow = {
  regionType: string
  regionId: string
  representative: string
  field: FieldName
  status: FieldStatus['status']
  value: string
  source: string
  reason: string
}
type AldermanInfoRow = {
  ward?: string
  alderman?: string
  email?: string
  ward_phone?: string
  address?: string
  city?: string
  state?: string
  zipcode?: string
  website?: {
    url?: string
  }
}

const execFileAsync = promisify(execFile)
const root = new URL('..', import.meta.url)
const fetchedAt = new Date().toISOString()
const fields: FieldName[] = ['name', 'email', 'phone', 'address', 'photo']
const sshHost = process.env.CIVIC_FETCH_SSH_HOST
const fallbackTransports = new Map<string, string>()

const files = {
  ward: 'chicago-wards.json',
  congressional: 'illinois-congressional-districts.json',
  illinoisHouse: 'illinois-house.json',
  illinoisSenate: 'illinois-senate.json',
  police: 'chicago-police-districts.json',
  schoolBoard: 'chicago-school-board.json',
  cookCountyCommissioner: 'cook-county-commissioners.json',
}

const sourceUrls = {
  wards: 'https://data.cityofchicago.org/api/geospatial/p293-wvbd?method=export&format=GeoJSON',
  aldermanInfo: 'https://data.cityofchicago.org/resource/c6ie-9e6c.json?$limit=50000',
  wardPage: (ward: string) =>
    `https://www.chicago.gov/city/en/about/wards/${ward.padStart(2, '0')}.html`,
  houseClerk: 'https://clerk.house.gov/xml/lists/MemberData.xml',
  houseDirectory: 'https://www.house.gov/representatives',
  ilgaHouse: 'http://www.ilga.gov/House/Members/rptMemberList',
  ilgaSenate: 'http://www.ilga.gov/Senate/Members/rptMemberList',
  policeCouncil: (district: string) =>
    `https://ccpsa.chicago.gov/district-council/${ordinal(district)}-district-council/`,
  cpsBoard: 'https://www.cps.edu/about/chicago-board-of-education/',
  cpsSchoolBoard: 'https://www.cps.edu/api/ersbgeojson/lists',
  cookCommissioners:
    'https://www.cookcountyil.gov/all-people?field_people_agency_target_id_entityreference_filter%5B%5D=2208&apply_filter=yes',
  cookLegistarPeople: 'https://cook-county.legistar.com/People.aspx',
}

function jsonPath(file: string) {
  return new URL(`public/geojson/${file}`, root)
}

function legacyJsonPath(file: string) {
  return new URL(`data/legacy-geojson/${file}`, root)
}

async function readJson(file: string) {
  return JSON.parse(await readFile(jsonPath(file), 'utf8')) as Collection
}

async function readLegacyJson(file: string) {
  try {
    return JSON.parse(await readFile(legacyJsonPath(file), 'utf8')) as Collection
  } catch {
    return readJson(file)
  }
}

async function writeJson(file: string, data: Collection) {
  await writeFile(jsonPath(file), `${JSON.stringify(data)}\n`)
}

function clean(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  return decodeHtml(String(value))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&aacute;/g, 'á')
}

function absoluteUrl(url: string | undefined, base: string) {
  if (!url) return undefined
  return new URL(decodeHtml(url), base).toString()
}

function normalizeName(value: unknown) {
  return clean(value)
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(alderman|alderwoman|alderperson|dr\.|pastor)\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function nameSearchKey(value: unknown) {
  return normalizeName(value)
    ?.split(' ')
    .filter((part) => part.length > 1)
    .join(' ')
}

function displayAldermanName(value: unknown) {
  const name = clean(value)
  if (!name) return undefined
  const [last, first] = name.split(',').map((part) => part.trim())

  return first && last ? `${first} ${last}` : name
}

function fieldValue(
  value: string | undefined,
  source: string,
  reason = 'Not published by official source',
): FieldStatus {
  return value
    ? { status: 'value', value, source, fetchedAt }
    : { status: 'unavailable', source, fetchedAt, reason }
}

function representative(record: PersonRecord, fallbackSource: string) {
  const fieldStatus = Object.fromEntries(
    fields.map((field) => {
      const value = field === 'photo' ? record.photo : record[field]
      return [
        field,
        fieldValue(value, record.sources?.[field] ?? fallbackSource),
      ]
    }),
  ) as Record<FieldName, FieldStatus>

  return {
    title: record.title,
    name: record.name,
    email: record.email,
    phone: record.phone,
    address: record.address,
    photo: record.photo,
    image: record.photo,
    website: record.website,
    contactUrl: record.contactUrl,
    fieldStatus,
  } satisfies OfficialRepresentative
}

async function fetchText(url: string) {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 civic-data-generator' },
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const body = await response.text()
      if (
        url.includes('ilga.gov') &&
        url.endsWith('rptMemberList') &&
        !body.includes('Title: Report for Active Members') &&
        !body.includes('member-card')
      ) {
        throw new Error('ILGA response did not contain the active-member report')
      }

      return body
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
  }

  if (url.includes('ilga.gov')) {
    const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`
    const response = await fetch(readerUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 civic-data-generator' },
    })
    if (!response.ok) {
      throw new Error(
        `Official source fallback transport failed: ${readerUrl} (${response.status})`,
      )
    }
    fallbackTransports.set(url, readerUrl)
    return await response.text()
  }

  if (url.includes('ilga.gov') && sshHost) {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-o',
        'ConnectTimeout=8',
        sshHost,
        'curl',
        '-A',
        'Mozilla/5.0 civic-data-generator',
        '-L',
        '-sS',
        '--max-time',
        '30',
        url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    )
    return stdout
  }

  throw new Error(
    `Official source fetch failed after 3 attempts: ${url}. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

async function fetchJson<T>(url: string) {
  return JSON.parse(await fetchText(url)) as T
}

function matchOne(pattern: RegExp, text: string) {
  const match = text.match(pattern)
  return clean(match?.[1])
}

function rowAfter(label: string, html: string) {
  return matchOne(
    new RegExp(
      `<tr[\\s\\S]*?<td[^>]*>[\\s\\S]*?${label}[\\s\\S]*?<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`,
      'i',
    ),
    html,
  )
}

function ordinal(value: string | number) {
  const number = Number(value)
  const suffix =
    number % 100 >= 11 && number % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[number % 10] ??
        'th'
  return `${number}${suffix}`
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
) {
  const results: R[] = []
  for (let index = 0; index < values.length; index += limit) {
    results.push(...(await Promise.all(values.slice(index, index + limit).map(fn))))
  }
  return results
}

function featureId(regionType: string, feature: Feature) {
  const props = feature.properties
  if (regionType === 'ward') return clean(props.ward) ?? clean(props.ward_id) ?? ''
  if (regionType === 'congressional') {
    return clean(props.DISTRICT)?.replace(/^0+/, '') ?? clean(props.CD119FP)?.replace(/^0+/, '') ?? ''
  }
  if (regionType === 'illinoisHouse' || regionType === 'illinoisSenate') {
    return clean(props.name)?.replace(/^\D+/, '') ?? ''
  }
  if (regionType === 'police') return clean(props.dist_num) ?? ''
  if (regionType === 'schoolBoard') return clean(props.Name) ?? clean(props.ERSB20_LONGNAME) ?? ''
  if (regionType === 'cookCountyCommissioner') return clean(props.DISTRICT_TXT) ?? ''
  return ''
}

function setReps(feature: Feature, reps: OfficialRepresentative[], source: string) {
  feature.properties.representatives = reps
  feature.properties.representativeSource = source
  feature.properties.representativeFetchedAt = fetchedAt
}

async function enrichWards(collection: Collection) {
  const aldermanInfo = new Map(
    (await fetchJson<AldermanInfoRow[]>(sourceUrls.aldermanInfo)).map((row) => [
      clean(row.ward),
      row,
    ]),
  )

  await mapLimit(collection.features, 8, async (feature) => {
    const ward = clean(feature.properties.ward) ?? clean(feature.properties.ward_id)
    if (!ward) throw new Error('Ward feature missing ward number')
    const source = sourceUrls.wardPage(ward)
    const row = aldermanInfo.get(ward)
    const robustAddress = row?.address
      ? [
          clean(row.address),
          clean(row.city),
          [clean(row.state), clean(row.zipcode)].filter(Boolean).join(' '),
        ].filter(Boolean).join(', ')
      : undefined
    const needsWardPage = !row?.alderman || !row.email || !row.ward_phone || !robustAddress
    const html = needsWardPage ? await fetchText(source) : undefined
    const name =
      displayAldermanName(row?.alderman) ??
      matchOne(
        /<h3>\s*(?:<a[^>]*>)?\s*(?:Alderman|Alderwoman|Alderperson)\s+([^<]+?)(?:\s*<\/a>)?\s*<\/h3>/i,
        html ?? '',
      ) ??
      clean(feature.properties.name)
    const email = clean(row?.email) ?? clean(html?.match(/mailto:([^"'>?]+)/i)?.[1])
    const phone = clean(row?.ward_phone) ?? rowAfter('Phone:', html ?? '')
    const address = robustAddress ?? rowAfter('Ward Office:', html ?? '')
    const website = absoluteUrl(row?.website?.url, sourceUrls.aldermanInfo) ?? source

    feature.properties.name = name
    feature.properties.email = email
    feature.properties.phone = phone
    feature.properties.address = address
    feature.properties.website = website
    delete feature.properties.image
    setReps(
      feature,
      [
        representative(
          {
            title: 'Alderperson',
            name,
            email,
            phone,
            address,
            website,
            contactUrl: website,
            sources: {
              name: row?.alderman ? sourceUrls.aldermanInfo : source,
              email: row?.email ? sourceUrls.aldermanInfo : source,
              phone: row?.ward_phone ? sourceUrls.aldermanInfo : source,
              address: robustAddress ? sourceUrls.aldermanInfo : source,
            },
          },
          source,
        ),
      ],
      sourceUrls.aldermanInfo,
    )
  })
}

function parseHouseDirectory(html: string) {
  const byDistrict = new Map<string, { website?: string; phone?: string; room?: string }>()
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []

  for (const row of rows) {
    const district = matchOne(/Illinois\s+(\d+)(?:st|nd|rd|th)/i, row)
    if (!district) continue
    byDistrict.set(district, {
      website: absoluteUrl(row.match(/<a href="([^"]+)"/i)?.[1], sourceUrls.houseDirectory),
      room: matchOne(/views-field-value-7 views-field-value-8">([\s\S]*?)<\/td>/i, row),
      phone: matchOne(/views-field-value-9">([\s\S]*?)<\/td>/i, row),
    })
  }

  return byDistrict
}

function parseHouseClerk(xml: string) {
  const byDistrict = new Map<string, PersonRecord>()
  const members = xml.match(/<member>[\s\S]*?<\/member>/g) ?? []

  for (const member of members) {
    const statedistrict = matchOne(/<statedistrict>(IL\d\d)<\/statedistrict>/, member)
    if (!statedistrict) continue
    const district = statedistrict.slice(2).replace(/^0+/, '')
    const building = matchOne(/<office-building>(.*?)<\/office-building>/, member)
    const room = matchOne(/<office-room>(.*?)<\/office-room>/, member)
    const zip = matchOne(/<office-zip>(.*?)<\/office-zip>/, member) ?? '20515'
    const address = [room, building, `Washington, DC ${zip}`].filter(Boolean).join(' ')
    byDistrict.set(district, {
      title: 'U.S. Representative',
      name: matchOne(/<official-name>(.*?)<\/official-name>/, member),
      phone: matchOne(/<phone>(.*?)<\/phone>/, member),
      address,
    })
  }

  return byDistrict
}

async function enrichCongressional(collection: Collection) {
  const [clerk, directory] = await Promise.all([
    fetchText(sourceUrls.houseClerk),
    fetchText(sourceUrls.houseDirectory),
  ])
  const clerkMembers = parseHouseClerk(clerk)
  const directoryMembers = parseHouseDirectory(directory)

  for (const feature of collection.features) {
    const district = featureId('congressional', feature)
    const clerkMember = clerkMembers.get(district)
    const directoryMember = directoryMembers.get(district)
    const source = sourceUrls.houseClerk
    const record: PersonRecord = {
      ...clerkMember,
      phone: clerkMember?.phone ?? directoryMember?.phone,
      address: clerkMember?.address ?? directoryMember?.room,
      website: directoryMember?.website ?? clean(feature.properties.WEBSITEURL),
      contactUrl: directoryMember?.website ?? clean(feature.properties.WEBSITEURL),
      sources: {
        name: source,
        phone: clerkMember?.phone ? source : sourceUrls.houseDirectory,
        address: clerkMember?.address ? source : sourceUrls.houseDirectory,
        email: source,
        photo: source,
      },
    }

    feature.properties.FIRSTNAME = record.name?.split(' ')[0]
    feature.properties.LASTNAME = record.name?.split(' ').slice(1).join(' ')
    feature.properties.WEBSITEURL = record.website
    feature.properties.PHONE = record.phone
    delete feature.properties.PHOTOURL
    setReps(feature, [representative(record, source)], source)
  }
}

type IlgaMember = {
  district: string
  name: string
  title: string
  url: string
  photo?: string
  email?: string
  phone?: string
  address?: string
}

function parseIlgaMembers(html: string, chamber: 'House' | 'Senate') {
  if (html.includes('Title: Report for Active Members')) {
    return parseIlgaReport(html, chamber)
  }

  const members = new Map<string, IlgaMember>()
  const cards = html.match(/<div class="member-card[\s\S]*?<\/p>\s*<\/div>\s*<\/div>\s*<\/div>/g) ?? []

  for (const card of cards) {
    const url = absoluteUrl(
      card.match(new RegExp(`href="(/${chamber}/Members/Details/\\d+)"`))?.[1],
      `https://www.ilga.gov/${chamber}/Members`,
    )
    const name = matchOne(/<h5 class="card-title"><a[^>]*>([\s\S]*?)<\/a>/, card)
    const district = matchOne(/<br\s*\/>\s*(\d+)(?:st|nd|rd|th) District/i, card)
    if (!url || !name || !district || members.has(district)) continue

    members.set(district, {
      district,
      name,
      title: chamber === 'House' ? 'Illinois House Representative' : 'Illinois State Senator',
      url,
      photo: absoluteUrl(card.match(/<img src="([^"]+)"/i)?.[1], url),
    })
  }

  return members
}

function parseIlgaReport(markdown: string, chamber: 'House' | 'Senate') {
  return chamber === 'House'
    ? parseHouseMemberReport(markdown)
    : parseSenateMemberReport(markdown)
}

function cleanReportAddress(value: string | undefined) {
  return clean(
    value
      ?.replace(/\(\d{3}\)\s*\d{3}-\d{4}(?:\s*Fax)?/g, '')
      .replace(/\s+/g, ' '),
  )
}

function parseHouseMemberReport(markdown: string) {
  const members = new Map<string, IlgaMember>()
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/www\.ilga\.gov\/House\/Members\/Details\/\d+)\)\s+\([A-Z]\)\s+([\s\S]*?)(?=\n\[[^\]]+\]\(https?:\/\/www\.ilga\.gov\/House\/Members\/Details\/\d+\)\s+\([A-Z]\)|\n!\[|$)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(markdown))) {
    const [, name, url, body] = match
    const district = body.match(/(\d+)(?:st|nd|rd|th)\s+District/i)?.[1]
    if (!district) continue

    const email = clean(body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0])
    const phones = [...body.matchAll(/\(\d{3}\)\s*\d{3}-\d{4}/g)].map((phone) =>
      clean(phone[0]),
    )
    const addressSource = email ? body.slice(body.indexOf(email) + email.length) : body
    const address = cleanReportAddress(addressSource)

    members.set(district, {
      district,
      name: clean(name)!,
      title: 'Illinois House Representative',
      url,
      email,
      phone: phones.at(-1),
      address,
    })
  }

  return members
}

function parseSenateMemberReport(markdown: string) {
  const members = new Map<string, IlgaMember>()
  const rows = markdown.match(/^\| \[[^\n]+$/gm) ?? []

  for (const row of rows) {
    const columns = row.split('|').map((column) => column.trim())
    const member = columns[1] ?? ''
    const districtOffice = columns[3] ?? ''
    const memberMatch = member.match(
      /^\[([^\]]+)\]\((https?:\/\/www\.ilga\.gov\/Senate\/Members\/Details\/\d+)\)\s+\([A-Z]\)\s+(\d+)(?:st|nd|rd|th)\s+District$/,
    )
    if (!memberMatch) continue

    const [, name, url, district] = memberMatch
    const phones = [...districtOffice.matchAll(/\(\d{3}\)\s*\d{3}-\d{4}/g)].map(
      (phone) => clean(phone[0]),
    )

    members.set(district, {
      district,
      name: clean(name)!,
      title: 'Illinois State Senator',
      url,
      phone: phones[0],
      address: cleanReportAddress(districtOffice),
    })
  }

  return members
}

function parseIlgaDetail(html: string) {
  const rows = html.match(/<div class="row(?: pt-2)?">[\s\S]*?<\/div>\s*<\/div>/g) ?? []
  let districtOffice: string | undefined
  let districtPhone: string | undefined
  let email: string | undefined

  for (const row of rows) {
    if (/District Office:/i.test(row)) {
      const body = row.match(/<div class="col-sm-8">([\s\S]*?)<\/div>/i)?.[1]
      const lines = (body?.split(/<br\s*\/?>/i) ?? []).map(clean).filter(Boolean)
      districtPhone = lines.find((line) => /\(\d{3}\)|\d{3}[-.]\d{3}/.test(line))
      districtOffice = lines.filter((line) => line !== districtPhone).join(', ')
    }
    if (/Other Contact Info:/i.test(row)) {
      email = clean(row.match(/<div class="col-sm-8">([\s\S]*?)<\/div>/i)?.[1])
        ?.split(' ')
        .find((part) => part.includes('@'))
    }
  }

  return { email, phone: districtPhone, address: districtOffice }
}

async function enrichIlga(collection: Collection, chamber: 'House' | 'Senate') {
  const source = chamber === 'House' ? sourceUrls.ilgaHouse : sourceUrls.ilgaSenate
  const members = parseIlgaMembers(await fetchText(source), chamber)
  const needsDetails = [...members.values()].filter(
    (member) => !member.email && !member.phone && !member.address && !source.endsWith('rptMemberList'),
  )
  const details = new Map<string, ReturnType<typeof parseIlgaDetail>>()

  await mapLimit(needsDetails, 8, async (member) => {
    details.set(member.district, parseIlgaDetail(await fetchText(member.url)))
  })

  const regionType = chamber === 'House' ? 'illinoisHouse' : 'illinoisSenate'
  for (const feature of collection.features) {
    const district = featureId(regionType, feature)
    const member = members.get(district)
    if (!member) throw new Error(`${chamber} district ${district} missing from ILGA source`)
    const detail = details.get(district)
    const person = {
      name: member.name,
      phone: member.phone ?? detail?.phone,
      email: member.email ?? detail?.email,
      district_office: member.address ?? detail?.address,
      image: member.photo,
    }

    feature.properties.person = person
    feature.properties.website = member.url
    setReps(
      feature,
      [
        representative(
          {
            title: member.title,
            name: member.name,
            email: member.email ?? detail?.email,
            phone: member.phone ?? detail?.phone,
            address: member.address ?? detail?.address,
            photo: member.photo,
            website: member.url,
            contactUrl: member.url,
            sources: {
              name: source,
              email: source,
              phone: source,
              address: source,
              photo: member.photo ? source : undefined,
            },
          },
          member.url,
        ),
      ],
      source,
    )
  }
}

function parseCouncilMembers(html: string, source: string) {
  const blocks = html.match(/<div class="member-column">[\s\S]*?<a class="see-more"[^>]*>/g) ?? []
  return blocks.map((block) => ({
    name: matchOne(/<h3 class="title">([\s\S]*?)<\/h3>/, block),
    title: matchOne(/<p class="position">([\s\S]*?)<\/p>/, block),
    photo: realPhotoUrl(absoluteUrl(block.match(/<img src="([^"]+)"/i)?.[1], source)),
    url: absoluteUrl(block.match(/href="([^"]+)"/i)?.[1], source),
  }))
}

function realPhotoUrl(url: string | undefined) {
  return url?.includes('headshot-placeholder') ? undefined : url
}

function parseObfuscatedMailto(html: string) {
  const mailto = html.match(/href="mailto:([^"]+)"/i)?.[1]
  return clean(mailto)
}

async function enrichPolice(collection: Collection) {
  await mapLimit(collection.features, 4, async (feature) => {
    const district = clean(feature.properties.dist_num)
    if (!district) throw new Error('Police feature missing district number')
    const source = sourceUrls.policeCouncil(district)
    const members = parseCouncilMembers(await fetchText(source), source)
    const reps = await mapLimit(members, 4, async (member) => {
      const email = member.url ? parseObfuscatedMailto(await fetchText(member.url)) : undefined
      return representative(
        {
          title: member.title,
          name: member.name,
          email,
          photo: member.photo,
          website: member.url,
          contactUrl: member.url,
          sources: { email: member.url },
        },
        source,
      )
    })

    for (let index = 1; index <= 5; index += 1) {
      delete feature.properties[`person_${index}_name`]
      delete feature.properties[`person_${index}_title`]
      delete feature.properties[`person_${index}_email`]
    }
    reps.forEach((rep, index) => {
      feature.properties[`person_${index + 1}_name`] = rep.name
      feature.properties[`person_${index + 1}_title`] = rep.title
      feature.properties[`person_${index + 1}_email`] = rep.email
    })
    feature.properties.ccpsaUrl = source
    setReps(feature, reps, source)
  })
}

async function enrichSchoolBoard(collection: Collection) {
  const [cpsGeojson, boardHtml] = await Promise.all([
    fetchJson<[Collection]>(sourceUrls.cpsSchoolBoard),
    fetchText(sourceUrls.cpsBoard),
  ])
  const officialNames = new Map(
    cpsGeojson[0].features.map((feature) => [
      clean(feature.properties.Name)?.toLowerCase(),
      clean(feature.properties.SCHOOL_BOARD_MEMBER),
    ]),
  )
  const links = new Map<string, { name: string; url: string }>()
  const linkPattern =
    /<a href="(https:\/\/www\.cpsboe\.org\/about\/bios\/\d+)"[^>]*>([\s\S]*?)<\/a>\s*-\s*(?:Vice President,\s*)?Member,\s*District\s*(\d+[AB])/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkPattern.exec(boardHtml))) {
    links.set(linkMatch[3].toLowerCase(), {
      name: clean(linkMatch[2])!,
      url: linkMatch[1],
    })
  }

  await mapLimit(collection.features, 6, async (feature) => {
    const nameKey = clean(feature.properties.Name)?.toLowerCase()
    const district = clean(feature.properties.Name)?.match(/(\d+[ab])/i)?.[1].toLowerCase()
    const officialName = officialNames.get(nameKey) ?? clean(feature.properties.SCHOOL_BOARD_MEMBER)
    const link = district ? links.get(district) : undefined
    const html = link ? await fetchText(link.url) : undefined
    const email = clean(html?.match(/mailto:([^"'>?]+)/i)?.[1])
    const photo = absoluteUrl(html?.match(/<img src="([^"]+)"[^>]*class="thumb"/i)?.[1], link?.url ?? sourceUrls.cpsBoard)

    feature.properties.SCHOOL_BOARD_MEMBER = officialName
    feature.properties.name = officialName
    feature.properties.image = photo
    setReps(
      feature,
      [
        representative(
          {
            title: 'Member',
            name: officialName,
            email,
            photo,
            website: link?.url,
            contactUrl: link?.url,
            sources: {
              name: sourceUrls.cpsSchoolBoard,
              email: link?.url,
              photo: link?.url,
            },
          },
          sourceUrls.cpsSchoolBoard,
        ),
      ],
      sourceUrls.cpsSchoolBoard,
    )
  })
}

function parseCookCommissionerList(html: string) {
  const byDistrict = new Map<string, { name: string; url: string }>()
  const items = html.match(/<div class="profile-item">[\s\S]*?<\/div><\/span><\/div><\/div>/g) ?? []

  for (const item of items) {
    const title = matchOne(/<div class="profile-job-title">([\s\S]*?)<\/div>/, item)
    const district = title?.match(/(?:County Board Commissioner|Cook County Commissioner),?\s*(\d+)(?:st|nd|rd|th)? District/i)?.[1]
    const url = absoluteUrl(item.match(/<div class="profile-name">[\s\S]*?<a href="([^"]+)"/i)?.[1], sourceUrls.cookCommissioners)
    const name = matchOne(/<div class="profile-name">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/i, item)
    if (district && url && name) byDistrict.set(district, { name, url })
  }

  return byDistrict
}

function parseCookProfile(html: string, source: string) {
  const name = matchOne(/<h1>([\s\S]*?)<\/h1>/, html)
  const photo = absoluteUrl(
    html.match(/field--node-field-profile-photo[\s\S]*?<img[^>]*src="([^"]+)"/i)?.[1],
    source,
  )
  const email = clean(html.match(/mailto:([^"'>?]+)/i)?.[1])
  const phone = matchOne(/<p class="profile-phone">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/, html)
  const address = clean(
    html.match(/<p class="address" translate="no">([\s\S]*?)<\/p>/i)?.[1],
  )
  return { name, email, phone, address, photo }
}

function parseCookLegistarEmails(html: string) {
  const byName = new Map<string, string>()
  const byWebsite = new Map<string, string>()
  const bySlug = new Map<string, string>()
  const rows = html.match(/<tr class="rg(?:Alt)?Row"[\s\S]*?<\/tr>/g) ?? []

  for (const row of rows) {
    const name = matchOne(/hypPerson"[^>]*>[\s\S]*?<font[^>]*>([\s\S]*?)<\/font>/i, row)
    const email = clean(row.match(/mailto:([^"'>?]+)/i)?.[1])
    const website = absoluteUrl(
      row.match(/hypWebSite"[^>]*href="([^"]+)"/i)?.[1],
      sourceUrls.cookLegistarPeople,
    )
    const key = nameSearchKey(name)

    if (key && email) byName.set(key, email)
    if (website && email) byWebsite.set(website.toLowerCase(), email)
    if (website && email) bySlug.set(profileSlugKey(website), email)
  }

  return { byName, byWebsite, bySlug }
}

function profileSlugKey(url: string) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''

  return slug
    .split('-')
    .filter((part) => part.length > 1)
    .join(' ')
}

function cookLegistarEmail(
  emails: ReturnType<typeof parseCookLegistarEmails>,
  name: string | undefined,
  website: string,
) {
  const byWebsite = emails.byWebsite.get(website.toLowerCase())
  if (byWebsite) return byWebsite

  const bySlug = emails.bySlug.get(profileSlugKey(website))
  if (bySlug) return bySlug

  const key = nameSearchKey(name)
  const byName = key ? emails.byName.get(key) : undefined
  if (byName || !key) return byName

  const [first, ...rest] = key.split(' ')
  const last = rest.at(-1)
  const match = [...emails.byName.entries()].find(([candidate]) => {
    const parts = candidate.split(' ')

    return parts[0] === first && parts.at(-1) === last
  })

  return match?.[1]
}

async function enrichCookCommissioners(collection: Collection) {
  const [commissionerHtml, legistarHtml] = await Promise.all([
    fetchText(sourceUrls.cookCommissioners),
    fetchText(sourceUrls.cookLegistarPeople),
  ])
  const list = parseCookCommissionerList(commissionerHtml)
  const legistarEmails = parseCookLegistarEmails(legistarHtml)
  const details = new Map<string, ReturnType<typeof parseCookProfile>>()

  await mapLimit([...list.entries()], 5, async ([district, item]) => {
    details.set(district, parseCookProfile(await fetchText(item.url), item.url))
  })

  for (const feature of collection.features) {
    const district = featureId('cookCountyCommissioner', feature)
    const item = list.get(district)
    const detail = details.get(district)
    if (!item || !detail) {
      throw new Error(`Cook commissioner district ${district} missing from official source`)
    }
    const legistarEmail = cookLegistarEmail(
      legistarEmails,
      detail.name ?? item.name,
      item.url,
    )
    const record = {
      title: 'Cook County Commissioner',
      name: detail.name ?? item.name,
      email: detail.email ?? legistarEmail,
      phone: detail.phone,
      address: detail.address,
      photo: detail.photo,
      website: item.url,
      contactUrl: item.url,
      sources: {
        email: detail.email ? item.url : sourceUrls.cookLegistarPeople,
      },
    } satisfies PersonRecord

    feature.properties.name = record.name
    feature.properties.email = record.email
    feature.properties.phone = record.phone
    feature.properties.address = record.address
    feature.properties.image = record.photo
    feature.properties.website = item.url
    setReps(feature, [representative(record, item.url)], sourceUrls.cookCommissioners)
  }
}

function legacyReps(regionType: string, feature: Feature) {
  const props = feature.properties
  if (regionType === 'police') {
    const names: string[] = []
    for (let index = 1; clean(props[`person_${index}_name`]); index += 1) {
      names.push(clean(props[`person_${index}_name`])!)
    }
    return names
  }
  if (regionType === 'schoolBoard') return [clean(props.SCHOOL_BOARD_MEMBER) ?? clean(props.name) ?? '']
  if (regionType === 'illinoisHouse' || regionType === 'illinoisSenate') {
    const person = props.person as Record<string, unknown> | undefined
    return [clean(person?.name) ?? '']
  }
  if (regionType === 'congressional') {
    return [[props.FIRSTNAME, props.LASTNAME].map(clean).filter(Boolean).join(' ')]
  }
  return [clean(props.name) ?? '']
}

function generatedReps(feature: Feature) {
  return (feature.properties.representatives as OfficialRepresentative[] | undefined)?.map(
    (rep) => rep.name ?? '',
  ) ?? []
}

function staleDiff(regionType: string, before: Collection, after: Collection) {
  return before.features.flatMap((beforeFeature, index) => {
    const afterFeature = after.features[index]
    const oldNames = legacyReps(regionType, beforeFeature).map(normalizeName).sort()
    const newNames = generatedReps(afterFeature).map(normalizeName).sort()
    return oldNames.join('|') === newNames.join('|')
      ? []
      : [
          {
            regionType,
            regionId: featureId(regionType, afterFeature),
            before: legacyReps(regionType, beforeFeature),
            after: generatedReps(afterFeature),
          },
        ]
  })
}

function coverage(regionType: string, collection: Collection) {
  const rows: CoverageRow[] = []

  for (const feature of collection.features) {
    const reps = feature.properties.representatives as OfficialRepresentative[] | undefined
    for (const rep of reps ?? []) {
      for (const field of fields) {
        const status = rep.fieldStatus[field]
        rows.push({
          regionType,
          regionId: featureId(regionType, feature),
          representative: rep.name ?? '',
          field,
          status: status.status,
          value: status.status === 'value' ? status.value : '',
          source: status.source,
          reason: status.status === 'unavailable' ? status.reason : '',
        })
      }
    }
  }

  return rows
}

function csvEscape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function rowsToCsv(rows: CoverageRow[]) {
  const columns = ['regionType', 'regionId', 'representative', 'field', 'status', 'value', 'source', 'reason'] as const
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n')
}

async function main() {
  const before = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, file]) => [key, await readJson(file)]),
    ),
  ) as Record<keyof typeof files, Collection>
  const legacy = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, file]) => [
        key,
        await readLegacyJson(file),
      ]),
    ),
  ) as Record<keyof typeof files, Collection>
  const after = Object.fromEntries(
    Object.entries(before).map(([key, value]) => [
      key,
      JSON.parse(JSON.stringify(value)) as Collection,
    ]),
  ) as Record<keyof typeof files, Collection>

  await enrichWards(after.ward)
  await enrichCongressional(after.congressional)
  await enrichIlga(after.illinoisHouse, 'House')
  await enrichIlga(after.illinoisSenate, 'Senate')
  await enrichPolice(after.police)
  await enrichSchoolBoard(after.schoolBoard)
  await enrichCookCommissioners(after.cookCountyCommissioner)

  for (const [key, file] of Object.entries(files)) {
    await writeJson(file, after[key as keyof typeof files])
  }

  const coverageRows = Object.entries(after).flatMap(([regionType, collection]) =>
    coverage(regionType, collection),
  )
  const diffs = Object.entries(legacy).flatMap(([regionType, collection]) =>
    staleDiff(regionType, collection, after[regionType as keyof typeof files]),
  )

  await mkdir(new URL('data/generated/', root), { recursive: true })
  await writeFile(
    new URL('data/generated/representative-coverage.csv', root),
    `${rowsToCsv(coverageRows)}\n`,
  )
  await writeFile(
    new URL('data/generated/stale-diff.json', root),
    `${JSON.stringify({ fetchedAt, diffs }, null, 2)}\n`,
  )
  await writeFile(
    new URL('data/generated/source-manifest.json', root),
    `${JSON.stringify({ fetchedAt, sources: manifestSources() }, null, 2)}\n`,
  )

  console.log(`coverage rows: ${coverageRows.length}`)
  console.log(`stale diffs: ${diffs.length}`)
}

function manifestSources() {
  return {
    robust: {
      boundaries: {
        wards: sourceUrls.wards,
        congressionalDistricts: 'public/geojson/illinois-congressional-districts.json',
        illinoisHouseDistricts: 'public/geojson/illinois-house.json',
        illinoisSenateDistricts: 'public/geojson/illinois-senate.json',
        policeDistricts: 'public/geojson/chicago-police-districts.json',
        schoolBoardDistricts: 'public/geojson/chicago-school-board.json',
        cookCountyCommissionerDistricts:
          'public/geojson/cook-county-commissioners.json',
      },
      representativeFeeds: {
        wardAlderpersonInfo: sourceUrls.aldermanInfo,
        congressionalClerkXml: sourceUrls.houseClerk,
        congressionalHouseDirectory: sourceUrls.houseDirectory,
        illinoisHouseActiveMemberReport: sourceUrls.ilgaHouse,
        illinoisSenateActiveMemberReport: sourceUrls.ilgaSenate,
        cpsSchoolBoardGeojson: sourceUrls.cpsSchoolBoard,
      },
    },
    brittle: {
      htmlScrapes: {
        wardPagesFallback:
          'https://www.chicago.gov/city/en/about/wards/{ward}.html',
        policeDistrictCouncilPages:
          'https://ccpsa.chicago.gov/district-council/{ordinal-district}-district-council/',
        cpsBoardBios: sourceUrls.cpsBoard,
        cookCountyCommissionerProfiles: sourceUrls.cookCommissioners,
        cookCountyLegistarPeople: sourceUrls.cookLegistarPeople,
      },
      fallbackTransports: Object.fromEntries(fallbackTransports),
      notes: [
        'HTML scrapes are official public pages but can break if page markup changes.',
        'ILGA report URLs are official sources; reader fallback is only a transport fallback when direct fetches time out.',
        'Contact URLs are included separately from email when a published form/profile page is the appropriate contact route.',
      ],
    },
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
