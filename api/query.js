// Vercel Serverless Function: 通过代理请求 Polymarket API
// POST /api/query
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
  } catch (_e) {
    try {
      const raw = await httpsViaProxy('https://api.ipify.org?format=json', proxy.host, proxy.port, proxy.user, proxy.pass, 8000)
      const data = JSON.parse(raw)
      return data?.ip || null
    } catch (_e2) {
      return null
    }
  }
}

// 以下函数不再 catch，让异常冒泡以便追踪失败

async function getVolume(wallet, proxy) {
  const raw = await fetchGet(`${LB_API}/volume?window=all&limit=1&address=${wallet}`, proxy)
  const data = JSON.parse(raw)
  return data?.[0]?.amount ?? 0
}

async function getProfit(wallet, proxy) {
  const raw = await fetchGet(`${LB_API}/profit?window=all&limit=1&address=${wallet}`, proxy)
  const data = JSON.parse(raw)
  return data?.[0]?.amount ?? 0
}

async function getMarketsTraded(wallet, proxy) {
  const raw = await fetchGet(`${DATA_API}/traded?user=${wallet}`, proxy)
  const data = JSON.parse(raw)
  return data?.traded ?? 0
}

async function getPortfolioValue(wallet, proxy) {
  const raw = await fetchGet(`${DATA_API}/value?user=${wallet}`, proxy)
  const data = JSON.parse(raw)
  return Array.isArray(data) ? (data[0]?.value ?? 0) : 0
}

async function getActivityStats(wallet, proxy) {
  const PAGE = 1000
  const daysSet = new Set()
  const monthsSet = new Set()
  let offset = 0
  let latestTs = null
  const MAX_PAGES = 10
  let pageCount = 0

  while (pageCount < MAX_PAGES) {
    const raw = await fetchGet(`${DATA_API}/activity?user=${wallet}&limit=${PAGE}&offset=${offset}`, proxy)
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
    pageCount++
  }

  if (latestTs === null) return { days: 0, months: 0, lastGap: null }
  const gap = Math.floor((Date.now() - latestTs * 1000) / (24 * 60 * 60 * 1000))
  return { days: daysSet.size, months: monthsSet.size, lastGap: gap }
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
    } catch (_e) { /* try next RPC */ }
  }
  throw new Error('All RPC endpoints failed')
}

async function getPositions(wallet, proxy) {
  const raw = await fetchGet(`${DATA_API}/positions?user=${wallet}&sizeThreshold=0`, proxy)
  return JSON.parse(raw)
}

// ============================================================
// 子请求包装：追踪成功/失败
// ============================================================

async function wrapSub(fieldName, fn) {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (_e) {
    return { ok: false, field: fieldName }
  }
}

// ============================================================
// Main handler
// ============================================================

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

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const wallet = address.toLowerCase()

    // 构建代理配置（可选）
    const proxy = proxyHost
      ? { host: proxyHost, port: proxyPort, user: proxyUser, pass: proxyPass }
      : null

    // 并行获取所有数据，每个子请求独立追踪成功/失败
    const [
      volumeResult,
      profitResult,
      marketsTradedResult,
      portfolioValueResult,
      activityResult,
      balanceResult,
      positionsResult,
      proxyIpResult,
    ] = await Promise.all([
      wrapSub('交易额', () => getVolume(wallet, proxy)),
      wrapSub('盈亏', () => getProfit(wallet, proxy)),
      wrapSub('池子数', () => getMarketsTraded(wallet, proxy)),
      wrapSub('持仓估值', () => getPortfolioValue(wallet, proxy)),
      wrapSub('活跃度', () => getActivityStats(wallet, proxy)),
      wrapSub('可用余额', () => getUSDCBalance(wallet, proxy)),
      wrapSub('持仓列表', () => getPositions(wallet, proxy)),
      proxy ? wrapSub('代理IP', () => getProxyIP(proxy)) : Promise.resolve({ ok: true, value: null }),
    ])

    // 收集失败的字段
    const failedFields = []
    const dataResults = [volumeResult, profitResult, marketsTradedResult, portfolioValueResult, activityResult, balanceResult, positionsResult]
    for (const r of dataResults) {
      if (!r.ok) failedFields.push(r.field)
    }

    const volume = volumeResult.ok ? volumeResult.value : 0
    const profit = profitResult.ok ? profitResult.value : 0
    const marketsTraded = marketsTradedResult.ok ? marketsTradedResult.value : 0
    const portfolioValue = portfolioValueResult.ok ? portfolioValueResult.value : 0
    const activityStats = activityResult.ok ? activityResult.value : { days: 0, months: 0, lastGap: null }
    const availableBalance = balanceResult.ok ? balanceResult.value : 0
    const openPositions = positionsResult.ok ? positionsResult.value : []
    const proxyIp = proxyIpResult.ok ? proxyIpResult.value : null

    const netWorth = availableBalance + portfolioValue

    // 持仓盈亏：汇总所有当前持仓的浮动盈亏
    const holdingPnl = positionsResult.ok
      ? (openPositions || []).reduce((sum, p) => sum + (p.cashPnl || 0), 0)
      : 0

    const positions = (openPositions || []).map((p) => ({
      title: p.title,
      slug: p.slug,
      eventSlug: p.eventSlug || '',
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

    // 判断状态
    let status = 'success'
    if (failedFields.length === dataResults.length) {
      status = 'error'
    } else if (failedFields.length > 0) {
      status = 'partial'
    }

    return res.status(200).json({
      address,
      profit,
      availableBalance,
      portfolioValue,
      netWorth,
      holdingPnl,
      totalVolume: volume,
      marketsTraded,
      lastActiveDay: activityStats.lastGap,
      activeDays: activityStats.days,
      activeMonths: activityStats.months,
      positions,
      proxyIp,
      failedFields: failedFields.length > 0 ? failedFields : undefined,
      status,
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Internal server error',
      proxyIp: null,
    })
  }
}
