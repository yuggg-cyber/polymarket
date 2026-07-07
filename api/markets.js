// Vercel Serverless Function: market browser proxy
// GET /api/markets?end_date_min=...&end_date_max=...
//
// Fetches markets directly with Gamma keyset pagination. The previous
// events+offset fetch could stop at a fixed offset and miss low-volume markets
// that still expire in the requested month.

import https from 'node:https'
import { URL, URLSearchParams } from 'node:url'

export const GAMMA_MARKETS_KEYSET_URL = 'https://gamma-api.polymarket.com/markets/keyset'
export const MARKET_PAGE_LIMIT = 100
const MAX_KEYSET_PAGES = 1000

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function toStringValue(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function toNumberValue(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function asJSONList(value, fallback) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return JSON.stringify(value)
  return JSON.stringify(fallback)
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((tag) => ({
    id: toStringValue(tag.id ?? tag.slug ?? tag.label),
    label: toStringValue(tag.label ?? tag.name ?? tag.slug),
    slug: toStringValue(tag.slug ?? tag.label ?? tag.name).toLowerCase(),
  }))
}

export function buildMarketsUrl(query = {}, afterCursor = null) {
  const params = new URLSearchParams({
    closed: 'false',
    limit: String(MARKET_PAGE_LIMIT),
    order: 'volume_num',
    ascending: 'false',
    include_tag: 'true',
  })

  const endDateMin = firstQueryValue(query.end_date_min)
  const endDateMax = firstQueryValue(query.end_date_max)
  if (endDateMin) params.set('end_date_min', String(endDateMin))
  if (endDateMax) params.set('end_date_max', String(endDateMax))
  if (afterCursor) params.set('after_cursor', afterCursor)

  return `${GAMMA_MARKETS_KEYSET_URL}?${params.toString()}`
}

export function normalizeMarketToEvent(market) {
  const event = Array.isArray(market.events) && market.events.length > 0
    ? market.events[0]
    : null
  const tags = normalizeTags(market.tags?.length ? market.tags : event?.tags)

  return {
    id: toStringValue(event?.id ?? market.eventId ?? `market-${market.id}`),
    title: toStringValue(event?.title ?? market.groupItemTitle ?? market.question),
    slug: toStringValue(event?.slug ?? market.eventSlug ?? market.slug),
    endDate: toStringValue(event?.endDate ?? market.endDate),
    image: toStringValue(event?.image ?? market.image, undefined),
    tags,
    markets: [
      {
        id: toStringValue(market.id),
        question: toStringValue(market.question),
        slug: toStringValue(market.slug),
        endDate: toStringValue(market.endDate),
        image: toStringValue(market.image ?? event?.image, undefined),
        outcomes: asJSONList(market.outcomes, ['Yes', 'No']),
        outcomePrices: asJSONList(market.outcomePrices, [0, 0]),
        volume: toStringValue(market.volume ?? market.volumeNum ?? market.volume_num, '0'),
        volume24hr: toNumberValue(market.volume24hr ?? market.volume24hrClob),
        liquidity: toNumberValue(market.liquidity ?? market.liquidityNum ?? market.liquidity_num),
        liquidityNum: toNumberValue(market.liquidityNum ?? market.liquidity_num ?? market.liquidity),
        description: toStringValue(market.description ?? event?.description),
        active: market.active !== false,
        closed: market.closed === true,
      },
    ],
  }
}

export function marketsToEvents(markets) {
  const seen = new Set()
  const events = []

  for (const market of markets) {
    const id = toStringValue(market.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    events.push(normalizeMarketToEvent(market))
  }

  return events
}

export async function collectMarkets(query = {}, fetcher = fetchJSON) {
  const markets = []
  const seenMarketIds = new Set()
  const seenCursors = new Set()
  let afterCursor = null

  for (let page = 0; page < MAX_KEYSET_PAGES; page++) {
    const payload = await fetcher(buildMarketsUrl(query, afterCursor))
    const pageMarkets = Array.isArray(payload?.markets)
      ? payload.markets
      : Array.isArray(payload)
        ? payload
        : []

    for (const market of pageMarkets) {
      const id = toStringValue(market.id)
      if (id && !seenMarketIds.has(id)) {
        seenMarketIds.add(id)
        markets.push(market)
      }
    }

    const nextCursor = typeof payload?.next_cursor === 'string' && payload.next_cursor
      ? payload.next_cursor
      : null

    if (!nextCursor || pageMarkets.length === 0) {
      return markets
    }

    if (seenCursors.has(nextCursor)) {
      throw new Error('Gamma API returned a repeated pagination cursor')
    }

    seenCursors.add(nextCursor)
    afterCursor = nextCursor
  }

  throw new Error('Gamma API pagination exceeded the safety page limit')
}

export function fetchJSON(targetUrl, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let req
    const url = new URL(targetUrl)

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    const timer = setTimeout(() => {
      req?.destroy()
      finish(reject, new Error('request timeout'))
    }, timeout)

    req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          const status = res.statusCode || 0

          if (status < 200 || status >= 300) {
            finish(reject, new Error(`Gamma API request failed with ${status}: ${body.slice(0, 200)}`))
            return
          }

          try {
            finish(resolve, JSON.parse(body))
          } catch {
            finish(reject, new Error('Invalid JSON response'))
          }
        })
      }
    )

    req.on('error', (err) => {
      finish(reject, err)
    })
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const markets = await collectMarkets(req.query || {})
    return res.status(200).json(marketsToEvents(markets))
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
