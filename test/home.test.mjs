import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { once } from 'node:events'
import { createStore, LIMITS } from '../lib/store.js'
import { createEvidenceCache, buildTools, promptText } from '../lib/tools.js'
import { createHandler, WEB_PREFIX } from '../lib/web.js'

const root = fileURLToPath(new URL('../', import.meta.url))
function fixture(t) {
  const home = fs.mkdtempSync(path.join(root, '.test-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return { home, store: createStore(home) }
}
const content = (title = '一张书签') => ({ title, kind: 'book', spot: 'shelf', story: '测试专用：留住一次真实对话。', happenedOn: '2026-11-16' })
const manual = { kind: 'manual', quote: '这是测试里的原话摘录。' }
const conversation = { kind: 'conversation', quote: '这是测试里的原话摘录。', sessionId: 'test-session', messageTime: 100 }
const errorIs = (code) => (error) => error.code === code

test('empty home is read without creating data; writes survive a new store and back up the last good revision', (t) => {
  const { home, store } = fixture(t)
  assert.deepEqual(store.read(), { version: 1, revision: 0, enabled: true, items: [] })
  assert.equal(fs.existsSync(path.dirname(store.file)), false)
  const saved = store.create(content(), manual, 0)
  assert.equal(saved.state.revision, 1)
  assert.equal(saved.item.happenedOn, '2026-11-16')
  assert.deepEqual(createStore(home).read(), saved.state)
  store.update(saved.item.id, { spot: 'desk' }, 1)
  assert.equal(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')).revision, 1)
  assert.equal(createStore(home).read().items[0].spot, 'desk')
  assert.equal(fs.existsSync(`${store.file}.lock`), false)
})

test('duplicate saves are idempotent; concurrent stale edits and malformed dates never overwrite data', (t) => {
  const { store } = fixture(t)
  const a = store.create(content(), manual)
  const duplicate = store.create(content(), manual)
  assert.equal(duplicate.item.id, a.item.id)
  assert.equal(duplicate.state.revision, 1)
  assert.throws(() => store.update(a.item.id, { title: 'stale' }, 0), errorIs('REVISION_CONFLICT'))
  assert.throws(() => store.update(a.item.id, { happenedOn: '2026-02-30' }), errorIs('INVALID_INPUT'))
  assert.throws(() => store.update(a.item.id, { title: 'bad\u0000title' }), errorIs('INVALID_INPUT'))
  assert.throws(() => store.update(a.item.id, { source: manual }), errorIs('INVALID_INPUT'))
  assert.deepEqual(store.read(), a.state)
})

test('conversation sources remain immutable while manual sources can be corrected and items archived or restored', (t) => {
  const { store } = fixture(t)
  const saved = store.create(content(), conversation)
  assert.throws(() => store.update(saved.item.id, { quote: '伪造改写' }), errorIs('SOURCE_IMMUTABLE'))
  assert.throws(() => store.update(saved.item.id, { happenedOn: '2020-01-01' }), errorIs('SOURCE_IMMUTABLE'))
  store.update(saved.item.id, { story: '修改来历说明。', archived: true })
  assert.equal(store.read().items[0].archived, true)
  assert.deepEqual(store.read().items[0].source, conversation)
  store.update(saved.item.id, { archived: false })
  const m = store.create(content('另一张书签'), manual)
  store.update(m.item.id, { quote: '用户自己修正的摘录。', happenedOn: '' })
  assert.equal(store.read().items[1].source.quote, '用户自己修正的摘录。')
  assert.equal(store.read().items[1].happenedOn, null)
})

test('corrupt data and missing main files preserve originals and backups; locks prevent cross-process writes', (t) => {
  const { store } = fixture(t)
  store.create(content(), manual)
  store.configure(false)
  const good = fs.readFileSync(`${store.file}.bak`, 'utf8')
  fs.writeFileSync(store.file, '{ broken')
  assert.throws(() => store.read(), errorIs('STORE_CORRUPT'))
  assert.throws(() => store.create(content('新物件'), manual), errorIs('STORE_CORRUPT'))
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{ broken')
  assert.equal(fs.readFileSync(`${store.file}.bak`, 'utf8'), good)
  fs.unlinkSync(store.file)
  assert.throws(() => store.configure(true), errorIs('STORE_CORRUPT'))
  fs.writeFileSync(store.file, good)
  fs.writeFileSync(`${store.file}.lock`, 'other-process')
  assert.throws(() => store.configure(false), errorIs('STORE_BUSY'))
  assert.equal(fs.readFileSync(store.file, 'utf8'), good)
  fs.unlinkSync(`${store.file}.lock`)
  assert.equal(store.configure(false).state.enabled, false)
})

test('visible limit rejects without partial writes and archiving makes room', (t) => {
  const { store } = fixture(t)
  for (let i = 0; i < LIMITS.visible; i++) store.create(content(`物件${i}`), manual)
  const before = store.read()
  assert.throws(() => store.create(content('超出摆放上限'), manual), errorIs('LIMIT_REACHED'))
  assert.deepEqual(store.read(), before)
  store.update(before.items[0].id, { archived: true })
  store.create(content('可以放下了'), manual)
  assert.throws(() => store.update(before.items[0].id, { archived: false }), errorIs('LIMIT_REACHED'))
  assert.equal(store.read().items[0].archived, true)
})

test('only live human messages from the same session can become conversation sources', async (t) => {
  const { store } = fixture(t)
  const evidence = createEvidenceCache()
  const agent = { session: { id: 'test-session' } }
  const tools = Object.fromEntries(buildTools(store, evidence).map((tool) => [tool.name, tool]))
  const args = { ...content(), quote: '我们给小窝留一张书签。' }
  delete args.happenedOn
  const keep = () => tools.fish_home_keep.execute(args, { agent })
  assert.equal((await keep()).ok, false)
  evidence.capture({ agent, message: { role: 'user', source: { kind: 'tool' }, content: args.quote } })
  assert.equal((await keep()).ok, false)
  evidence.capture({ agent: { session: { id: 'other-session' } }, message: { role: 'user', source: { kind: 'user' }, content: args.quote } })
  assert.equal((await keep()).ok, false)
  evidence.capture({ agent, message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '前文。' }, { type: 'text', text: args.quote }] } })
  assert.equal((await keep()).ok, true)
  const item = store.read().items[0]
  assert.equal(item.source.quote, args.quote)
  assert.equal(item.source.sessionId, agent.session.id)
  assert.equal(item.happenedOn, null)
  assert.ok(item.source.messageTime > 0)
  assert.equal((await keep()).ok, true)
  assert.equal(store.read().items.length, 1)
  const looked = await tools.fish_home_look.execute({ id: item.id }, {})
  assert.equal(JSON.parse(looked.text).source.quote, args.quote)
  assert.equal((await tools.fish_home_move.execute({ id: item.id, spot: 'wall' }, {})).ok, true)
  assert.ok(promptText(store).includes(item.id))
  store.configure(false)
  assert.equal(promptText(store), '')
  evidence.clear()
  assert.throws(() => evidence.verify(agent.session.id, args.quote), errorIs('SOURCE_NOT_FOUND'))
})

test('HTTP assets, API revision checks, source spoofing, export and cross-origin protection', async (t) => {
  const { store } = fixture(t)
  const server = http.createServer(createHandler(store))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }))
  const origin = `http://127.0.0.1:${server.address().port}`
  const base = origin + WEB_PREFIX
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify(body) })
  const state = await (await fetch(base + '/state')).json()
  assert.equal(state.state.revision, 0)
  for (const asset of ['/panel', '/panel.js', '/panel.css']) {
    const response = await fetch(base + asset)
    assert.equal(response.status, 200, asset)
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"))
    assert.ok((await response.text()).length > 100)
  }
  assert.equal((await fetch(base + '/state', { method: 'HEAD' })).status, 200)
  assert.equal((await fetch(base + '/state', { headers: { origin: 'http://evil.invalid' } })).status, 403)
  assert.equal((await fetch(base + '/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await post('/items', { ...content(), quote: manual.quote, expectedRevision: 0, source: conversation })).status, 400)
  const response = await post('/items', { ...content(), quote: manual.quote, expectedRevision: 0 })
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.state.items[0].source.kind, 'manual')
  assert.equal((await post('/items', { ...content('过期编辑'), quote: manual.quote, expectedRevision: 0 })).status, 409)
  assert.equal((await post('/config', { enabled: false })).status, 400)
  assert.equal((await post('/config', { enabled: false, expectedRevision: 1 })).status, 200)
  const exportResponse = await fetch(base + '/export')
  assert.ok(exportResponse.headers.get('content-disposition').includes('fish-home.json'))
  assert.equal((await exportResponse.json()).items[0].source.quote, manual.quote)
  assert.equal((await post('/config', { enabled: true, expectedRevision: 2 }, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post('/items', { x: 'x'.repeat(17000) })).status, 413)
  assert.equal((await fetch(base + '/missing')).status, 404)
  assert.equal((await fetch(base + '/state', { method: 'DELETE' })).status, 405)
  assert.equal((await fetch(base + '/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
})
