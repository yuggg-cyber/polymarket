import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEventsUrl,
  buildMarketsUrl,
  collectEvents,
  collectMarketBrowserEvents,
  EVENT_PAGE_LIMIT,
  MARKET_PAGE_LIMIT,
} from './markets.js'

function makeEvents(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    slug: `${prefix}-${index}`,
  }))
}

test('buildEventsUrl preserves the event endpoint shape used by the frontend', () => {
  const url = new URL(buildEventsUrl(
    {
      end_date_min: '2026-07-01T00:00:00.000Z',
      end_date_max: '2026-07-31T23:59:59.000Z',
    },
    5500
  ))

  assert.equal(url.pathname, '/events')
  assert.equal(url.searchParams.get('active'), 'true')
  assert.equal(url.searchParams.get('closed'), 'false')
  assert.equal(url.searchParams.get('order'), 'volume')
  assert.equal(url.searchParams.get('ascending'), 'false')
  assert.equal(url.searchParams.get('limit'), String(EVENT_PAGE_LIMIT))
  assert.equal(url.searchParams.get('offset'), '5500')
  assert.equal(url.searchParams.get('end_date_min'), '2026-07-01T00:00:00.000Z')
  assert.equal(url.searchParams.get('end_date_max'), '2026-07-31T23:59:59.000Z')
})

test('buildMarketsUrl fetches market-level month data for supplementing events', () => {
  const url = new URL(buildMarketsUrl(
    {
      end_date_min: '2026-07-01T00:00:00.000Z',
      end_date_max: '2026-08-01T06:00:00.000Z',
    },
    5500
  ))

  assert.equal(url.pathname, '/markets')
  assert.equal(url.searchParams.get('active'), 'true')
  assert.equal(url.searchParams.get('closed'), 'false')
  assert.equal(url.searchParams.get('order'), 'end_date')
  assert.equal(url.searchParams.get('ascending'), 'true')
  assert.equal(url.searchParams.get('include_tag'), 'true')
  assert.equal(url.searchParams.get('limit'), String(MARKET_PAGE_LIMIT))
  assert.equal(url.searchParams.get('offset'), '5500')
  assert.equal(url.searchParams.get('end_date_max'), '2026-08-01T06:00:00.000Z')
})

test('collectEvents continues beyond the old offset 5000 cap', async () => {
  const requestedOffsets = []

  const events = await collectEvents(
    { end_date_min: '2026-07-01T00:00:00.000Z' },
    async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      requestedOffsets.push(offset)
      if (offset <= 5000) return makeEvents(EVENT_PAGE_LIMIT, `page-${offset}`)
      if (offset === 5500) return makeEvents(17, `page-${offset}`)
      return []
    }
  )

  assert(requestedOffsets.includes(5500))
  assert.equal(events.length, EVENT_PAGE_LIMIT * 11 + 17)
})

test('collectMarketBrowserEvents deduplicates overlapping pages by id', async () => {
  const events = await collectMarketBrowserEvents(
    {},
    async (url) => {
      const parsed = new URL(url)
      const offset = Number(parsed.searchParams.get('offset'))
      if (parsed.pathname === '/markets') return []
      if (offset === 0) return [{ id: 'same', slug: 'same' }, ...makeEvents(EVENT_PAGE_LIMIT - 1, 'first')]
      if (offset === EVENT_PAGE_LIMIT) return [{ id: 'same', slug: 'same' }]
      return []
    }
  )

  assert.equal(events.filter((event) => event.id === 'same').length, 1)
})

test('collectMarketBrowserEvents supplements missing July 31 markets from market-level data', async () => {
  const trumpSlug = 'will-trump-pardon-anyone-by-july-31-20260707005101355'
  const warshipsSlug = 'which-countries-will-send-warships-through-the-strait-of-hormuz-by-july-31-20260701001952738'
  const requestedMarketMaxes = []

  const events = await collectMarketBrowserEvents(
    {
      end_date_min: '2026-07-01T00:00:00.000Z',
      end_date_max: '2026-07-31T15:59:59.000Z',
    },
    async (url) => {
      const parsed = new URL(url)
      const offset = Number(parsed.searchParams.get('offset'))
      if (parsed.pathname === '/events') return []
      requestedMarketMaxes.push(parsed.searchParams.get('end_date_max'))
      if (offset > 0) return []

      return [
        {
          id: 'trump-market',
          question: 'Will Trump pardon anyone by July 31?',
          slug: trumpSlug,
          endDate: '2026-08-01T03:59:00Z',
          outcomes: ['Yes', 'No'],
          outcomePrices: ['0.5', '0.5'],
          volumeNum: 630,
          active: true,
          closed: false,
          events: [{ id: 'trump-event', title: 'Will Trump pardon anyone by July 31?', slug: trumpSlug }],
        },
        {
          id: 'warships-market',
          question: 'Will any country send warships through the Strait of Hormuz by July 31?',
          slug: 'warships-market',
          endDate: '2026-08-01T03:59:00Z',
          outcomes: ['Yes', 'No'],
          outcomePrices: ['0.4', '0.6'],
          volumeNum: 135484,
          active: true,
          closed: false,
          events: [{ id: 'warships-event', title: 'Which countries will send warships through the Strait of Hormuz by July 31?', slug: warshipsSlug }],
        },
      ]
    }
  )

  assert(events.some((event) => event.slug === trumpSlug))
  assert(events.some((event) => event.slug === warshipsSlug))
  assert(requestedMarketMaxes.includes('2026-08-01T05:59:59.000Z'))
  assert.equal(
    events.find((event) => event.slug === trumpSlug).markets[0].endDate,
    '2026-07-31T15:59:59.000Z'
  )
})
