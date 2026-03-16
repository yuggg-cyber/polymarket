// Vercel Serverless Function: 通过代理请求 Polymarket API
// POST /api/query
// Body: { address, proxyHost, proxyPort, proxyUser, proxyPass }

const http = require('node:http')
const https = require('node:https')
const { URL } = require('node:url')

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

// 通过 HTTP CONNECT 代理发起 HTTPS POST 请求（用于 Polygon RPC）
function httpsPostViaProxy(targetUrl, postBody, proxyHost, proxyPort, proxyUser, proxyPass, timeout = 12000) {
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
      const bodyStr = JSON.stringify(postBody)
      const req = https.request(
        targetUrl,
        {
          agent,
          method: 'POST',
          timeout,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
        },
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
      req.write(bodyStr)
      req.end()
    })

    connectReq.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })

    connectReq.end()
  })
}

// ============================================================
// 无代理直接请求（fallback）
// ============================================================

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

function directPost(url, postBody, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('direct post timeout')), timeout)
    const bodyStr = JSON.stringify(postBody)
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
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
    req.write(bodyStr)
    req.end()
  })
}

// ============================================================
// 数据获取函数
// ============================================================

const DATA_API = 'https://data-api.polymarket.com'
const LB_API = 'https://lb-api.polymarket.com'
const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const POLYGON_RPCS = [
  'https://polygon.drpc.org',
  'https://polygon.publicnode.com',
  'https://1rpc.io/matic',
]

function fetchGet(url, proxy) {
  if (proxy) {
    return httpsViaProxy(url, proxy.host, proxy.port, proxy.user, proxy.pass)
  }
  return directFetch(url)
}

function fetchPost(url, body, proxy) {
  if (proxy) {
    return httpsPostViaProxy(url, body, proxy.host, proxy.port, proxy.user, proxy.pass)
  }
  return directPost(url, body)
}

// 通过代理获取出口 IP
async function getProxyIP(proxy) {
  try {
    const raw = await httpsViaProxy('https://httpbin.org/ip', proxy.host, proxy.port, proxy.user, proxy.pass, 8000)
    const data = JSON.parse(raw)
    return data?.origin || null
  } catch {
    // fallback: 尝试另一个 IP 检测服务
    try {
      const raw = await httpsViaProxy('https://api.ipify.org?format=json', proxy.host, proxy.port, proxy.user, proxy.pass, 8000)
      const data = JSON.parse(raw)
      return data?.ip || null
    } catch {
      return null
    }
  }
}

async function getVolume(wallet, proxy) {
  try {
    const raw = await fetchGet(`${LB_API}/volume?window=all&limit=1&address=${wallet}`, proxy)
    const data = JSON.parse(raw)
    return data?.[0]?.amount ?? 0
  } catch { return 0 }
}

async function getProfit(wallet, proxy) {
  try {
    const raw = await fetchGet(`${LB_API}/profit?window=all&limit=1&address=${wallet}`, proxy)
    const data = JSON.parse(raw)
    return data?.[0]?.amount ?? 0
  } catch { return 0 }
}

async function getMarketsTraded(wallet, proxy) {
  try {
    const raw = await fetchGet(`${DATA_API}/traded?user=${wallet}`, proxy)
    const data = JSON.parse(raw)
    return data?.traded ?? 0
  } catch { return 0 }
}

async function getPortfolioValue(wallet, proxy) {
  try {
    const raw = await fetchGet(`${DATA_API}/value?user=${wallet}`, proxy)
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data[0]?.value ?? 0) : 0
  } catch { return 0 }
}

async function getActivityStats(wallet, proxy) {
  try {
    const PAGE = 1000
    const daysSet = new Set()
    const monthsSet = new Set()
    let offset = 0
    let latestTs = null

    while (true) {
      let raw
      try {
        raw = await fetchGet(`${DATA_API}/activity?user=${wallet}&limit=${PAGE}&offset=${offset}`, proxy)
      } catch { break }
      const batch = JSON.parse(raw)
      if (!Array.isArray(batch) || batch.length === 0) break

      for (const item of batch) {
        const date = new Date(item.timestamp * 1000)
        const y = date.getFullYear()
        const mo = date.getMonth() + 1
        const day = date.getDate()
        daysSet.add(y * 10000 + mo * 100 + day)
        monthsSet.add(y * 100 + mo)
        if (latestTs === null || item.timestamp > latestTs) latestTs = item.timestamp
      }

      if (batch.length < PAGE) break
      offset += PAGE
    }

    if (latestTs === null) return { days: 0, months: 0, lastGap: null }
    const gap = Math.floor((Date.now() - latestTs * 1000) / (24 * 60 * 60 * 1000))
    return { days: daysSet.size, months: monthsSet.size, lastGap: gap }
  } catch {
    return { days: 0, months: 0, lastGap: null }
  }
}

async function getUSDCBalance(wallet, proxy) {
  const addrHex = wallet.slice(2).toLowerCase()
  const data = '0x70a08231' + addrHex.padStart(64, '0')
  const payload = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDC_CONTRACT, data }, 'latest'] }

  for (const rpc of POLYGON_RPCS) {
    try {
      const raw = await fetchPost(rpc, payload, proxy)
      const j = JSON.parse(raw)
      const result = j?.result
      if (typeof result === 'string' && result.startsWith('0x')) {
        const bigVal = result === '0x' ? 0n : BigInt(result)
        const scale = 10n ** 6n
        const valueTimes100 = (bigVal * 100n) / scale
        const whole = Number(valueTimes100 / 100n)
        const cent = Number(valueTimes100 % 100n)
        return whole + cent / 100
      }
    } catch { /* try next RPC */ }
  }
  return 0
}

async function getPositions(wallet, proxy) {
  try {
    const raw = await fetchGet(`${DATA_API}/positions?user=${wallet}&sizeThreshold=0`, proxy)
    return JSON.parse(raw)
  } catch { return [] }
}

// ============================================================
// Main handler
// ============================================================

module.exports = async function handler(req, res) {
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

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const wallet = address.toLowerCase()

    // 构建代理配置（可选）
    const proxy = proxyHost
      ? { host: proxyHost, port: proxyPort, user: proxyUser, pass: proxyPass }
      : null

    // 并行获取所有数据 + 代理出口 IP
    const tasks = [
      getVolume(wallet, proxy),
      getProfit(wallet, proxy),
      getMarketsTraded(wallet, proxy),
      getPortfolioValue(wallet, proxy),
      getActivityStats(wallet, proxy),
      getUSDCBalance(wallet, proxy),
      getPositions(wallet, proxy),
    ]

    // 如果使用代理，同时获取出口 IP
    if (proxy) {
      tasks.push(getProxyIP(proxy))
    }

    const results = await Promise.all(tasks)

    const [volume, profit, marketsTraded, portfolioValue, activityStats, availableBalance, openPositions] = results
    const proxyIp = proxy ? (results[7] || null) : null

    const netWorth = availableBalance + portfolioValue

    const positions = (openPositions || []).map((p) => ({
      title: p.title,
      slug: p.slug,
      icon: p.icon,
      outcome: p.outcome,
      size: p.size,
      avgPrice: p.avgPrice,
      currentValue: p.currentValue,
      curPrice: p.curPrice,
      cashPnl: p.cashPnl,
      percentPnl: p.percentPnl,
      totalBought: p.totalBought,
      realizedPnl: p.realizedPnl,
      redeemable: p.redeemable,
      mergeable: p.mergeable,
      endDate: p.endDate,
    }))

    return res.status(200).json({
      address,
      profit,
      availableBalance,
      portfolioValue,
      netWorth,
      totalVolume: volume,
      marketsTraded,
      lastActiveDay: activityStats.lastGap,
      activeDays: activityStats.days,
      activeMonths: activityStats.months,
      positions,
      proxyIp,
      status: 'success',
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error',
      proxyIp: null,
    })
  }
}
