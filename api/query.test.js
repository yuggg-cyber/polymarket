import test from 'node:test'
import assert from 'node:assert/strict'

import { getClosedPositionsPage } from './query.js'

test('closed positions page request forwards the configured proxy', async () => {
  const wallet = '0x1234567890abcdef1234567890abcdef12345678'
  const proxy = {
    host: 'proxy.example.com',
    port: '8080',
    user: 'user_session-test',
    pass: 'secret',
  }
  let requestedUrl = ''
  let requestedProxy = null

  const positions = await getClosedPositionsPage(wallet, 50, proxy, async (url, forwardedProxy) => {
    requestedUrl = url
    requestedProxy = forwardedProxy
    return JSON.stringify([{ title: 'test market' }])
  })

  assert.equal(
    requestedUrl,
    `https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=50&offset=50&sortBy=TIMESTAMP&sortDirection=DESC`
  )
  assert.equal(requestedProxy, proxy)
  assert.deepEqual(positions, [{ title: 'test market' }])
})

test('closed positions page rejects malformed API data', async () => {
  await assert.rejects(
    getClosedPositionsPage(
      '0x1234567890abcdef1234567890abcdef12345678',
      0,
      null,
      async () => JSON.stringify({ error: 'rate limited' })
    ),
    /Invalid closed positions response/
  )
})
