// Vercel Serverless Function: 通过代理请求 Safe Global API 解析账户地址
// POST /api/resolve
// Body: { address, proxyHost, proxyPort, proxyUser, proxyPass }

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

// ============================================================
// 通过 HTTP CONNECT 代理发起 HTTPS GET 请求
// ============================================================

function httpsViaProxy(targetUrl, proxyHost, proxyPort, proxyUser, proxyPass, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl)
    const timer = setTimeout(() => reject(new Error('proxy timeout')), timeout)

    const authStr = Buffer.from(`${proxyUser}:${proxyPass}`).toString('base64')

    const connectReq = http.request({
      host: proxyHost,
      port: Number(proxyPort),
      method: 'CONNECT',
      path: `${url.hostname}:443`,
      headers: {
        'Proxy-Authorization': `Basic ${authStr}`,
        Host: `${url.hostname}:443`,
      },
    })

    connectReq.on('connect', (_res, socket) => {
      const agent = new https.Agent({ socket, keepAlive: false })
      const req = https.request(
        targetUrl,
        { agent, method: 'GET', timeout },
        (res) => {
          let body = ''
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => {
            clearTimeout(timer)
            resolve(body)
          })
        }
      )
      req.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      req.end()
    })

    connectReq.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })

    connectReq.end()
  })
}

// 无代理直接请求
function directFetch(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('direct fetch timeout')), timeout)
    https.get(url, { timeout }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        clearTimeout(timer)
        resolve(body)
      })
    }).on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

const MAX_SAFES = 5

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { address, proxyHost, proxyPort, proxyUser, proxyPass } = req.body

    if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    // 使用 Safe Transaction Service API（api.safe.global）
    // safe-client.safe.global 有 CloudFront WAF 保护，服务端请求会返回 403
    const url = `https://api.safe.global/tx-service/pol/api/v1/owners/${address}/safes`

    let raw
    if (proxyHost) {
      raw = await httpsViaProxy(url, proxyHost, proxyPort, proxyUser, proxyPass)
    } else {
      raw = await directFetch(url)
    }

    const data = JSON.parse(raw)

    let safes = []
    if (Array.isArray(data?.safes)) {
      safes = data.safes
    } else if (Array.isArray(data)) {
      safes = data
    } else if (Array.isArray(data?.['137'])) {
      safes = data['137']
    } else if (data?.safes && typeof data.safes === 'object' && !Array.isArray(data.safes)) {
      if (Array.isArray(data.safes['137'])) {
        safes = data.safes['137']
      }
    }

    return res.status(200).json({
      safes: safes.slice(0, MAX_SAFES),
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error',
      safes: [],
    })
  }
}
