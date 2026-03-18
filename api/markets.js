// Vercel Serverless Function — 市场浏览代理
// GET /api/markets?offset=0&limit=200&end_date_min=...&end_date_max=...

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
    const { offset = '0', limit = '200', end_date_min, end_date_max } = req.query || {}

    let url = `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=${limit}&offset=${offset}`
    if (end_date_min) url += `&end_date_min=${encodeURIComponent(end_date_min)}`
    if (end_date_max) url += `&end_date_max=${encodeURIComponent(end_date_max)}`

    const data = await fetchJSON(url)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
