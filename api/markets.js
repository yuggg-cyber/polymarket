// Vercel Serverless Function: market browser proxy
// GET /api/markets?end_date_min=...&end_date_max=...
//
// Keep returning Gamma event-shaped data because the front end already consumes it.
// Supplement event pages with market-level pages so month views do not miss items.

import https from 'node:https'
import { URL, URLSearchParams } from 'node:url'

export const GAMMA_EVENTS_URL = 'https://gamma-api.polymarket.com/events'
export const GAMMA_MARKETS_URL = 'https://gamma-api.polymarket.com/markets'
export const EVENT_PAGE_LIMIT = 500
export const EVENT_PAGE_BATCH_SIZE = 10
export const MAX_EVENT_PAGES = 60
export const MARKET_PAGE_LIMIT = 500
export const MARKET_PAGE_BATCH_SIZE = 10
export const MAX_MARKET_PAGES = 60
export const END_DATE_MAX_GRACE_MS = 14 * 60 * 60 * 1000

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function withEndDateMaxGrace(query = {}) {
  const endDateMax = firstQueryValue(query.end_date_max)
  if (!endDateMax) return query

  const maxDate = new Date(endDateMax)
  if (Number.isNaN(maxDate.getTime())) return query

  return {
    ...query,
    end_date_max: new Date(maxDate.getTime() + END_DATE_MAX_GRACE_MS).toISOString(),
  }
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

export function buildEventsUrl(query = {}, offset = 0) {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    order: 'volume',
    ascending: 'false',
    limit: String(EVENT_PAGE_LIMIT),
    offset: String(offset),
  })

  const endDateMin = firstQueryValue(query.end_date_min)
  const endDateMax = firstQueryValue(query.end_date_max)
  if (endDateMin) params.set('end_date_min', String(endDateMin))
  if (endDateMax) params.set('end_date_max', String(endDateMax))

  return `${GAMMA_EVENTS_URL}?${params.toString()}`
}

export function buildMarketsUrl(query = {}, offset = 0) {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    order: 'end_date',
    ascending: 'true',
    include_tag: 'true',
    limit: String(MARKET_PAGE_LIMIT),
    offset: String(offset),
  })

  const endDateMin = firstQueryValue(query.end_date_min)
  const endDateMax = firstQueryValue(query.end_date_max)
  if (endDateMin) params.set('end_date_min', String(endDateMin))
  if (endDateMax) params.set('end_date_max', String(endDateMax))

  return `${GAMMA_MARKETS_URL}?${params.toString()}`
}

function getEventKey(event) {
  const id = event?.id === undefined || event?.id === null ? '' : String(event.id)
  return id || event?.slug || ''
}

function getMarketKey(market) {
  const id = market?.id === undefined || market?.id === null ? '' : String(market.id)
  return id || market?.conditionId || market?.slug || ''
}

function getPageItems(payload, key) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.[key])) return payload[key]
  return []
}

function hasMorePages(payload, items, limit) {
  if (payload && typeof payload === 'object') {
    if (payload.has_more === false || payload.hasMore === false) return false
    if (payload.has_more === true || payload.hasMore === true) return true
  }

  return items.length >= limit
}

export async function collectEvents(query = {}, fetcher = fetchJSON) {
  const allEvents = []

  for (let pageStart = 0; pageStart < MAX_EVENT_PAGES; pageStart += EVENT_PAGE_BATCH_SIZE) {
    const batchPages = Math.min(EVENT_PAGE_BATCH_SIZE, MAX_EVENT_PAGES - pageStart)
    const offsets = Array.from(
      { length: batchPages },
      (_, index) => (pageStart + index) * EVENT_PAGE_LIMIT
    )

    const results = await Promise.allSettled(
      offsets.map((offset) => fetcher(buildEventsUrl(query, offset)))
    )

    let shouldStop = false

    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      if (result.status !== 'fulfilled') {
        shouldStop = true
        continue
      }

      const events = getPageItems(result.value, 'events')
      allEvents.push(...events)

      if (!hasMorePages(result.value, events, EVENT_PAGE_LIMIT)) {
        shouldStop = true
      }
    }

    if (shouldStop) break
  }

  return allEvents
}

export async function collectMarkets(query = {}, fetcher = fetchJSON) {
  const allMarkets = []

  for (let pageStart = 0; pageStart < MAX_MARKET_PAGES; pageStart += MARKET_PAGE_BATCH_SIZE) {
    const batchPages = Math.min(MARKET_PAGE_BATCH_SIZE, MAX_MARKET_PAGES - pageStart)
    const offsets = Array.from(
      { length: batchPages },
      (_, index) => (pageStart + index) * MARKET_PAGE_LIMIT
    )

    const results = await Promise.allSettled(
      offsets.map((offset) => fetcher(buildMarketsUrl(query, offset)))
    )

    let shouldStop = false

    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      if (result.status !== 'fulfilled') {
        shouldStop = true
        continue
      }

      const markets = getPageItems(result.value, 'markets')
      allMarkets.push(...markets)

      if (!hasMorePages(result.value, markets, MARKET_PAGE_LIMIT)) {
        shouldStop = true
      }
    }

    if (shouldStop) break
  }

  return allMarkets
}

function normalizeMarketToEvent(market) {
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

export function mergeEventsWithMarkets(events, markets) {
  const merged = new Map()
  const eventMarketKeys = new Map()

  const ensureEvent = (event) => {
    const key = getEventKey(event)
    if (!key) return null

    if (!merged.has(key)) {
      const marketsForEvent = Array.isArray(event.markets) ? [...event.markets] : []
      merged.set(key, { ...event, markets: marketsForEvent })
      eventMarketKeys.set(key, new Set(marketsForEvent.map(getMarketKey).filter(Boolean)))
    }

    return merged.get(key)
  }

  for (const event of events) {
    ensureEvent(event)
  }

  for (const market of markets) {
    const normalizedEvent = normalizeMarketToEvent(market)
    const event = ensureEvent(normalizedEvent)
    if (!event) continue

    const marketKeys = eventMarketKeys.get(getEventKey(event))
    for (const normalizedMarket of normalizedEvent.markets) {
      const marketKey = getMarketKey(normalizedMarket)
      if (marketKey && marketKeys.has(marketKey)) continue
      event.markets.push(normalizedMarket)
      if (marketKey) marketKeys.add(marketKey)
    }
  }

  return [...merged.values()]
}

function clampGraceWindowEndDates(events, originalQuery, expandedQuery) {
  const originalEndDateMax = firstQueryValue(originalQuery.end_date_max)
  const expandedEndDateMax = firstQueryValue(expandedQuery.end_date_max)
  if (!originalEndDateMax || !expandedEndDateMax || originalEndDateMax === expandedEndDateMax) {
    return events
  }

  const originalMaxMs = new Date(originalEndDateMax).getTime()
  const expandedMaxMs = new Date(expandedEndDateMax).getTime()
  if (Number.isNaN(originalMaxMs) || Number.isNaN(expandedMaxMs)) return events

  return events.map((event) => ({
    ...event,
    markets: Array.isArray(event.markets)
      ? event.markets.map((market) => {
          const endMs = new Date(market.endDate).getTime()
          if (Number.isNaN(endMs) || endMs <= originalMaxMs || endMs > expandedMaxMs) {
            return market
          }

          return { ...market, endDate: originalEndDateMax }
        })
      : [],
  }))
}

export async function collectMarketBrowserEvents(query = {}, fetcher = fetchJSON) {
  const expandedQuery = withEndDateMaxGrace(query)
  const [eventsResult, marketsResult] = await Promise.allSettled([
    collectEvents(expandedQuery, fetcher),
    collectMarkets(expandedQuery, fetcher),
  ])

  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : []
  const markets = marketsResult.status === 'fulfilled' ? marketsResult.value : []

  if (eventsResult.status === 'rejected' && marketsResult.status === 'rejected') {
    throw eventsResult.reason || marketsResult.reason
  }

  return clampGraceWindowEndDates(
    mergeEventsWithMarkets(events, markets),
    query,
    expandedQuery
  )
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
    const events = await collectMarketBrowserEvents(req.query || {})
    return res.status(200).json(events)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
