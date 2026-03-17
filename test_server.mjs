// 本地模拟 Vercel Serverless Function 的测试服务器
// 用法: node test_server.mjs
// 监听 3001 端口，模拟 /api/resolve 和 /api/query

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

// ============================================================
// 复制自 api/resolve.js 的代理请求函数
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
          console.log(`  [proxy] HTTP ${res.statusCode} from ${url.hostname}`)
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

function directFetch(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('direct fetch timeout')), timeout)
    https.get(url, { timeout }, (res) => {
      console.log(`  [direct] HTTP ${res.statusCode} from ${url}`)
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

// ============================================================
// /api/resolve handler
// ============================================================

async function handleResolve(reqBody) {
  const { address, proxyHost, proxyPort, proxyUser, proxyPass } = reqBody

  console.log(`\n[/api/resolve] address=${address}, proxyHost=${proxyHost}, proxyPort=${proxyPort}`)
  console.log(`  proxyUser=${proxyUser}`)

  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(address)) {
    return { status: 400, body: { error: 'Invalid address' } }
  }

  const url = `https://api.safe.global/tx-service/pol/api/v1/owners/${address}/safes`
  console.log(`  Target URL: ${url}`)

  try {
    let raw
    if (proxyHost) {
      console.log(`  Using proxy: ${proxyHost}:${proxyPort}`)
      raw = await httpsViaProxy(url, proxyHost, proxyPort, proxyUser, proxyPass)
    } else {
      console.log(`  Using direct fetch`)
      raw = await directFetch(url)
    }

    console.log(`  Raw response length: ${raw.length}`)
    console.log(`  Raw response first 200 chars: ${raw.substring(0, 200)}`)

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

    console.log(`  Found ${safes.length} safes, returning ${Math.min(safes.length, MAX_SAFES)}`)
    return { status: 200, body: { safes: safes.slice(0, MAX_SAFES) } }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`)
    return { status: 500, body: { error: error.message || 'Internal server error', safes: [] } }
  }
}

// ============================================================
// HTTP Server
// ============================================================

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.url === '/api/resolve' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      try {
        const reqBody = JSON.parse(body)
        const result = await handleResolve(reqBody)
        res.writeHead(result.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result.body))
      } catch (e) {
        console.log(`  ❌ Parse error: ${e.message}`)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message, safes: [] }))
      }
    })
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(3001, '0.0.0.0', () => {
  console.log('Test server listening on http://0.0.0.0:3001')
  console.log('Endpoints: POST /api/resolve')
})
