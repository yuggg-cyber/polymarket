// Vercel Serverless Function — 市场浏览批量代理
// GET /api/markets?end_date_min=...&end_date_max=...
// 后端一次性并发拉取所有分页数据，前端只需一次请求

import https from 'node:https'
import { URL } from 'node:url'

function fetchJSON(targetUrl, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('request timeout')), timeout)
    const url = new URL(targetUrl)

    const req = https.get(
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
          clearTimeout(timer)
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error('Invalid JSON response'))
          }
        })
      }
    )

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export default async function handler(req, res) {
  // CORS
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
    const { end_date_min, end_date_max } = req.query || {}
    const limit = 500
    const baseUrl = 'https://gamma-api.polymarket.com/events?active=true&closed=false'

    let params = `&limit=${limit}`
    if (end_date_min) params += `&end_date_min=${encodeURIComponent(end_date_min)}`
    if (end_date_max) params += `&end_date_max=${encodeURIComponent(end_date_max)}`

    // 第一次请求，获取第一批数据
    const firstBatch = await fetchJSON(`${baseUrl}${params}&offset=0`)
    let allEvents = Array.isArray(firstBatch) ? firstBatch : []

    // 如果第一批就满了，说明还有更多数据，并发请求后续页
    if (allEvents.length >= limit) {
      // 预估最多 5000 条事件，生成后续偏移量
      const offsets = []
      for (let offset = limit; offset <= 5000; offset += limit) {
        offsets.push(offset)
      }

      // 并发请求所有后续页（最多 10 个并发）
      const batchSize = 5
      for (let i = 0; i < offsets.length; i += batchSize) {
        const batch = offsets.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map((offset) =>
            fetchJSON(`${baseUrl}${params}&offset=${offset}`)
          )
        )

        let hasMore = false
        for (const result of results) {
          if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
            allEvents = allEvents.concat(result.value)
            if (result.value.length >= limit) hasMore = true
          }
        }

        // 如果这一批都没有满页的，说明已经拉完了
        if (!hasMore) break
      }
    }

    return res.status(200).json(allEvents)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
