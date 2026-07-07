import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMarketsUrl,
  collectMarkets,
  marketsToEvents,
  MARKET_PAGE_LIMIT,
} from './markets.js'

test('buildMarketsUrl uses Gamma markets keyset pagination parameters', () => {
  const url = new URL(buildMarketsUrl(
    {
      end_date_min: '2026-07-01T00:00:00.000Z',
      end_date_max: '2026-07-31T23:59:59.000Z',
    },
    'next-cursor'
  ))

  assert.equal(url.pathname, '/markets/keyset')
  assert.equal(url.searchParams.get('closed'), 'false')
  assert.equal(url.searchParams.get('limit'), String(MARKET_PAGE_LIMIT))
  assert.equal(url.searchParams.get('order'), 'volume_num')
  assert.equal(url.searchParams.get('ascending'), 'false')
  assert.equal(url.searchParams.get('include_tag'), 'true')
  assert.equal(url.searchParams.get('after_cursor'), 'next-cursor')
  assert.equal(url.searchParams.get('end_date_min'), '2026-07-01T00:00:00.000Z')
  assert.equal(url.searchParams.get('end_date_max'), '2026-07-31T23:59:59.000Z')
})

test('collectMarkets follows next_cursor until the final page', async () => {
  const requestedUrls = []
  const pages = [
    {
      markets: [{ id: '1', question: 'first' }],
      next_cursor: 'cursor-2',
    },
    {
      markets: [
        { id: '2', question: 'second' },
        { id: '1', question: 'duplicate' },
      ],
      next_cursor: 'cursor-3',
    },
    {
      markets: [{ id: '3', question: 'third' }],
      next_cursor: '',
    },
  ]

  const markets = await collectMarkets(
    { end_date_min: '2026-07-01T00:00:00.000Z' },
    async (url) => {
      requestedUrls.push(url)
      return pages.shift()
    }
  )

  assert.deepEqual(markets.map((market) => market.id), ['1', '2', '3'])
  assert.equal(requestedUrls.length, 3)
  assert.equal(new URL(requestedUrls[0]).searchParams.get('after_cursor'), null)
  assert.equal(new URL(requestedUrls[1]).searchParams.get('after_cursor'), 'cursor-2')
  assert.equal(new URL(requestedUrls[2]).searchParams.get('after_cursor'), 'cursor-3')
})

test('marketsToEvents preserves market-level date and event metadata', () => {
  const events = marketsToEvents([
    {
      id: 'market-1',
      question: 'Will this market resolve in July?',
      slug: 'july-market',
      endDate: '2026-07-15T00:00:00Z',
      outcomes: ['Yes', 'No'],
      outcomePrices: ['0.42', '0.58'],
      volumeNum: 1234.5,
      volume24hr: 12.3,
      liquidityNum: 45.6,
      active: true,
      closed: false,
      tags: [{ id: 'tag-1', label: 'Politics', slug: 'politics' }],
      events: [
        {
          id: 'event-1',
          title: 'July event',
          slug: 'july-event',
          endDate: '2026-08-01T00:00:00Z',
          image: 'https://example.com/event.png',
        },
      ],
    },
  ])

  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'event-1')
  assert.equal(events[0].slug, 'july-event')
  assert.equal(events[0].markets[0].id, 'market-1')
  assert.equal(events[0].markets[0].endDate, '2026-07-15T00:00:00Z')
  assert.equal(events[0].markets[0].volume, '1234.5')
  assert.equal(events[0].markets[0].outcomes, JSON.stringify(['Yes', 'No']))
  assert.deepEqual(events[0].tags, [{ id: 'tag-1', label: 'Politics', slug: 'politics' }])
})
