// Vercel Serverless Function: market browser proxy
// GET /api/markets?end_date_min=...&end_date_max=...
//
// Keep using Gamma events because the front end already consumes that shape.
// The fix is to page past the old fixed offset cap instead of stopping at 5000.

import https from 'node:https'
import { URL, URLSearchParams } from 'node:url'

export const GAMMA_EVENTS_URL = 'https://gamma-api.polymarket.com/events'
export const EVENT_PAGE_LIMIT = 500
export const EVENT_PAGE_BATCH_SIZE = 10
export const MAX_EVENT_PAGES = 60

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
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

function dedupeEvents(events) {
  const seen = new Set()
  const result = []

  for (const event of events) {
    const id = event?.id === undefined || event?.id === null ? '' : String(event.id)
    const key = id || event?.slug
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(event)
  }

  return result
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
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
        shouldStop = true
        continue
      }

      allEvents.push(...result.value)

      if (result.value.length < EVENT_PAGE_LIMIT) {
        shouldStop = true
      }
    }

    if (shouldStop) break
  }

  return dedupeEvents(allEvents)
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
    const events = await collectEvents(req.query || {})
    return res.status(200).json(events)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
