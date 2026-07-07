import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEventsUrl,
  collectEvents,
  EVENT_PAGE_LIMIT,
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

test('collectEvents deduplicates overlapping pages by id', async () => {
  const events = await collectEvents(
    {},
    async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'))
      if (offset === 0) return [{ id: 'same', slug: 'same' }, ...makeEvents(EVENT_PAGE_LIMIT - 1, 'first')]
      if (offset === EVENT_PAGE_LIMIT) return [{ id: 'same', slug: 'same' }]
      return []
    }
  )

  assert.equal(events.filter((event) => event.id === 'same').length, 1)
})
