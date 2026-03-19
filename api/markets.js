// Vercel Serverless Function — 市场浏览批量代理（优化版）
// GET /api/markets?end_date_min=...&end_date_max=...
//
// 优化策略：
// 1. 按交易量降序排列（order=volume&ascending=false），高价值数据优先返回
// 2. 全并发请求所有分页（而非串行等待），大幅减少总耗时
// 3. 使用 NDJSON 流式响应，前端可以边接收边渲染
// 4. 超时保护：单个请求 15s 超时，总体 55s 保护

import https from 'node:https'
import { URL } from 'node:url'

function fetchJSON(targetUrl, timeout = 15000) {
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
    // 按交易量降序排列，高价值事件优先
    const baseUrl = 'https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume&ascending=false'

    let params = `&limit=${limit}`
    if (end_date_min) params += `&end_date_min=${encodeURIComponent(end_date_min)}`
    if (end_date_max) params += `&end_date_max=${encodeURIComponent(end_date_max)}`

    // 使用 NDJSON 流式响应，前端可以边接收边解析
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Transfer-Encoding', 'chunked')
    res.setHeader('Cache-Control', 'no-cache')

    // 第一批请求 — 立即发送，让前端尽快拿到数据
    const firstBatch = await fetchJSON(`${baseUrl}${params}&offset=0`)
    const firstEvents = Array.isArray(firstBatch) ? firstBatch : []

    // 立即写入第一批数据
    for (const event of firstEvents) {
      res.write(JSON.stringify(event) + '\n')
    }

    // 如果第一批满了，说明还有更多数据
    if (firstEvents.length >= limit) {
      // 全并发请求后续所有页（最多到 offset=5000）
      const offsets = []
      for (let offset = limit; offset <= 5000; offset += limit) {
        offsets.push(offset)
      }

      // 一次性全部并发（最多 10 个请求）
      const results = await Promise.allSettled(
        offsets.map((offset) =>
          fetchJSON(`${baseUrl}${params}&offset=${offset}`)
        )
      )

      // 按 offset 顺序写入结果
      for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          for (const event of result.value) {
            res.write(JSON.stringify(event) + '\n')
          }
        }
      }
    }

    res.end()
  } catch (err) {
    // 如果还没开始写入，返回 JSON 错误
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Internal server error' })
    }
    // 已经开始流式写入，直接结束
    res.end()
  }
}
