import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOG, HomeError, fail } from './store.js'

export const WEB_PREFIX = '/plugins/dsh-fish-home'
const MAX_BODY = 16 * 1024
const ASSETS = new Map([
  ['/panel', ['panel.html', 'text/html; charset=utf-8']],
  ['/panel.js', ['panel.js', 'text/javascript; charset=utf-8']],
  ['/panel.css', ['panel.css', 'text/css; charset=utf-8']],
])
const SECURITY = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
}
export const snapshot = (state) => ({ ok: true, state, catalog: CATALOG })
function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  res.writeHead(status, { ...SECURITY, 'content-type': type, 'content-length': bytes.length, ...extra })
  res.end(req.method === 'HEAD' ? undefined : bytes)
}
function checkOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') fail('CROSS_ORIGIN', '请从 DSH 本身打开小窝。', 403)
  if (req.headers.origin) {
    let origin
    try { origin = new URL(req.headers.origin) } catch { fail('CROSS_ORIGIN', '请求来源不正确。', 403) }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail('CROSS_ORIGIN', '跨站请求被拒绝。', 403)
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted)
    }
    const error = (reason) => { cleanup(); req.resume(); reject(reason) }
    const aborted = () => error(new HomeError('ABORTED', '请求已中断。', 400))
    const data = (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) return error(new HomeError('BODY_TOO_LARGE', '这次写下的内容太长。', 413))
      chunks.push(chunk)
    }
    const end = () => {
      cleanup()
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_INPUT', '请求须为 JSON 对象。')
        resolve(body)
      } catch (reason) { reject(reason instanceof HomeError ? reason : new HomeError('INVALID_JSON', '请求不是有效的 JSON。')) }
    }
    timer = setTimeout(() => error(new HomeError('REQUEST_TIMEOUT', '请求等待太久，请重试。', 408)), 10_000)
    timer.unref?.()
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted)
  })
}
function checkKeys(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key))) fail('INVALID_INPUT', '请求包含不支持的字段。')
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail('INVALID_INPUT', '缺少有效的保存版本，请刷新后重试。')
}
export function createHandler(store, { log = () => {} } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname !== WEB_PREFIX && !url.pathname.startsWith(`${WEB_PREFIX}/`)) fail('NOT_FOUND', '没有这个页面。', 404)
      const route = url.pathname.slice(WEB_PREFIX.length) || '/panel'
      checkOrigin(req)
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = ASSETS.get(route === '/' ? '/panel' : route)
        if (asset) return send(req, res, 200, fs.readFileSync(fileURLToPath(new URL(asset[0], import.meta.url))), asset[1])
        if (route === '/state') return send(req, res, 200, snapshot(store.read()))
        if (route === '/export') return send(req, res, 200, JSON.stringify(store.read(), null, 2) + '\n', 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="fish-home.json"' })
        fail('NOT_FOUND', '没有这个页面。', 404)
      }
      if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '不支持这个操作。' } }, undefined, { allow: 'GET, HEAD, POST' })
      const match = route.match(/^\/items\/([a-f0-9-]{36})$/)
      if (!['/items', '/config'].includes(route) && !match) fail('NOT_FOUND', '没有这个操作。', 404)
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') fail('CONTENT_TYPE', '请使用 JSON 请求。', 415)
      if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); fail('BODY_TOO_LARGE', '这次写下的内容太长。', 413) }
      const body = await readBody(req)
      const { expectedRevision, ...input } = body
      let result
      if (route === '/config') {
        checkKeys(body, ['expectedRevision', 'enabled'])
        result = store.configure(body.enabled, expectedRevision)
      } else if (route === '/items') {
        checkKeys(body, ['expectedRevision', 'title', 'kind', 'spot', 'story', 'quote', 'happenedOn'])
        const { quote, ...fields } = input
        result = store.create(fields, { kind: 'manual', quote }, expectedRevision)
      } else {
        checkKeys(body, ['expectedRevision', 'title', 'kind', 'spot', 'story', 'quote', 'happenedOn', 'archived'])
        result = store.update(match[1], input, expectedRevision)
      }
      return send(req, res, 200, snapshot(result.state))
    } catch (error) {
      if (!(error instanceof HomeError)) log('小窝请求失败', error)
      if (res.destroyed || res.headersSent) return
      return send(req, res, error instanceof HomeError ? error.status : 500, { ok: false, error: { code: error instanceof HomeError ? error.code : 'INTERNAL_ERROR', message: error instanceof HomeError ? error.message : '小窝暂时无法读写。没有报告保存成功，请稍后再试。' } })
    }
  }
}
