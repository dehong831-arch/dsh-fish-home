import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const KINDS = Object.freeze({ plant: '植物', book: '书', cup: '杯子', shell: '贝壳', letter: '信', ticket: '票根', other: '小物' })
export const SPOTS = Object.freeze({ windowsill: '窗台', desk: '桌边', shelf: '书架', wall: '墙上' })
export const LIMITS = Object.freeze({ items: 120, visible: 16, title: 40, story: 1200, quote: 800, bytes: 2 * 1024 * 1024 })
export const CATALOG = Object.freeze({ kinds: KINDS, spots: SPOTS })

export class HomeError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'HomeError'; this.code = code; this.status = status }
}
export function fail(code, message, status) { throw new HomeError(code, message, status) }
export function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    fail('INVALID_INPUT', `${field}须为 1–${max} 字的文字。`)
  }
  return value.trim()
}
function choice(value, choices, field) {
  if (typeof value !== 'string' || !Object.hasOwn(choices, value)) fail('INVALID_INPUT', `${field}无效。`)
  return value
}
function dateOnly(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('INVALID_INPUT', '事件日期须为真实的 YYYY-MM-DD；不知道就留空。')
  return value
}
function sourceOf(source) {
  if (!source || !['manual', 'conversation'].includes(source.kind)) fail('INVALID_INPUT', '来源类型无效。')
  const quote = text(source.quote, '原话摘录', LIMITS.quote)
  if (source.kind === 'manual') return { kind: 'manual', quote, sessionId: null, messageTime: null }
  const sessionId = text(source.sessionId, '会话编号', 180)
  if (!Number.isFinite(source.messageTime) || source.messageTime < 0) fail('INVALID_INPUT', '来源消息的时间无效。')
  return { kind: 'conversation', quote, sessionId, messageTime: source.messageTime }
}
function fields(input) {
  return {
    title: text(input.title, '物件名称', LIMITS.title),
    kind: choice(input.kind, KINDS, '物件种类'),
    spot: choice(input.spot, SPOTS, '摆放位置'),
    story: text(input.story, '来历', LIMITS.story),
    happenedOn: dateOnly(input.happenedOn),
  }
}
function initial() { return { version: 1, revision: 0, enabled: true, items: [] } }
function validState(state) {
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.enabled !== 'boolean' || !Array.isArray(state.items)) fail('STORE_CORRUPT', '小窝数据格式不正确。', 503)
  if (state.items.length > LIMITS.items || state.items.filter((item) => item.archived === false).length > LIMITS.visible) fail('LIMIT_REACHED', `最多保存 ${LIMITS.items} 件，同时摆出 ${LIMITS.visible} 件；可以先收起一些。`, 409)
  const ids = new Set()
  for (const item of state.items) {
    if (!item || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id) || typeof item.archived !== 'boolean') fail('STORE_CORRUPT', '小窝物件编号或归档状态损坏。', 503)
    ids.add(item.id)
    fields(item)
    sourceOf(item.source)
    for (const key of ['createdAt', 'updatedAt']) {
      if (typeof item[key] !== 'string' || !Number.isFinite(Date.parse(item[key]))) fail('STORE_CORRUPT', '小窝物件时间损坏。', 503)
    }
  }
  return state
}
function assertRevision(state, expected) {
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected !== state.revision)) fail('REVISION_CONFLICT', '小窝刚刚有了变化。请刷新后再保存。', 409)
}
function requireOnly(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) fail('INVALID_INPUT', '请求包含不支持的字段。')
}

/** Synchronous transactions stay inside one turn; the exclusive lock covers other DSH processes. */
export function createStore(home) {
  const directory = path.join(home, 'fish-home')
  const file = path.join(directory, 'state.json')
  const backup = `${file}.bak`
  const lock = `${file}.lock`

  function load() {
    try {
      const stat = fs.statSync(file)
      if (stat.size > LIMITS.bytes) fail('STORE_CORRUPT', '小窝数据过大，已停止读取以保护原文件。', 503)
      const raw = fs.readFileSync(file, 'utf8')
      return { state: validState(JSON.parse(raw)), raw }
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (fs.existsSync(backup)) fail('STORE_CORRUPT', '主数据文件缺失，但还有备份。请先恢复备份；不会创建空屋覆盖。', 503)
        return { state: initial(), raw: null }
      }
      if (error instanceof HomeError && error.code === 'STORE_CORRUPT') throw error
      fail('STORE_CORRUPT', '小窝数据暂时读不到或已损坏。原文件和备份均保留，未写入。', 503)
    }
  }
  function writeAtomic(state, previous) {
    const temp = `${file}.${randomUUID()}.tmp`
    const backupTemp = `${backup}.${randomUUID()}.tmp`
    const serialized = JSON.stringify(state, null, 2) + '\n'
    if (Buffer.byteLength(serialized) > LIMITS.bytes) fail('LIMIT_REACHED', '小窝数据已到容量上限。', 409)
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, serialized, 'utf8'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (previous !== null) {
        fs.writeFileSync(backupTemp, previous, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        fs.renameSync(backupTemp, backup)
      }
      fs.renameSync(temp, file)
    } finally {
      for (const target of [temp, backupTemp]) {
        try { fs.unlinkSync(target) } catch (error) { if (error.code !== 'ENOENT') console.warn('[fish-home] 临时文件清理失败：', error.code) }
      }
    }
  }
  function transact(expected, change) {
    fs.mkdirSync(directory, { recursive: true })
    let fd
    try { fd = fs.openSync(lock, 'wx', 0o600) } catch (error) {
      if (error.code === 'EEXIST') fail('STORE_BUSY', '小窝正在保存。稍后重试；若重启后仍如此，请查看说明中的锁文件恢复步骤。', 409)
      throw error
    }
    try {
      fs.writeFileSync(fd, String(process.pid))
      const { state, raw } = load()
      assertRevision(state, expected)
      const result = change(state)
      if (result?.unchanged) return { state, item: result.item ?? null }
      state.revision += 1
      validState(state)
      writeAtomic(state, raw)
      return { state, item: result?.item ?? null }
    } finally {
      fs.closeSync(fd)
      fs.unlinkSync(lock)
    }
  }
  return {
    file,
    read: () => load().state,
    create(input, source, expected) {
      requireOnly(input, ['title', 'kind', 'spot', 'story', 'happenedOn'])
      const content = fields(input)
      const origin = sourceOf(source)
      return transact(expected, (state) => {
        const existing = state.items.find((item) => item.title === content.title && item.source.quote === origin.quote && item.source.sessionId === origin.sessionId && item.source.kind === origin.kind)
        if (existing) return { item: existing, unchanged: true }
        const now = new Date().toISOString()
        const item = { id: randomUUID(), ...content, source: origin, createdAt: now, updatedAt: now, archived: false }
        state.items.push(item)
        return { item }
      })
    },
    update(id, input, expected) {
      requireOnly(input, ['title', 'kind', 'spot', 'story', 'happenedOn', 'quote', 'archived'])
      return transact(expected, (state) => {
        const item = state.items.find((entry) => entry.id === id)
        if (!item) fail('NOT_FOUND', '这件东西不在小窝里。', 404)
        if (item.source.kind === 'conversation' && (Object.hasOwn(input, 'quote') || Object.hasOwn(input, 'happenedOn'))) fail('SOURCE_IMMUTABLE', '对话来源与原话不能改写；可修改物件名称、来历说明和位置。')
        if (Object.hasOwn(input, 'archived') && typeof input.archived !== 'boolean') fail('INVALID_INPUT', '归档状态须为 true 或 false。')
        const next = fields({ ...item, ...input })
        Object.assign(item, next)
        if (Object.hasOwn(input, 'quote')) item.source = sourceOf({ ...item.source, quote: input.quote })
        if (Object.hasOwn(input, 'archived')) item.archived = input.archived
        item.updatedAt = new Date().toISOString()
        return { item }
      })
    },
    configure(enabled, expected) {
      if (typeof enabled !== 'boolean') fail('INVALID_INPUT', 'enabled 须为 true 或 false。')
      return transact(expected, (state) => {
        if (state.enabled === enabled) return { unchanged: true }
        state.enabled = enabled
      })
    },
  }
}
