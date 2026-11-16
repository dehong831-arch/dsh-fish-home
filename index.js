import os from 'node:os'
import path from 'node:path'
import { createStore } from './lib/store.js'
import { buildTools, createEvidenceCache, promptText } from './lib/tools.js'
import { createHandler, WEB_PREFIX } from './lib/web.js'

export const name = 'fish-home'
export const inject = ['systemPrompt', 'tools']

export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const store = createStore(home)
  const evidence = createEvidenceCache()
  const log = (message, error) => {
    // Never log user text or source excerpts.
    const detail = error ? ` (${error.code || error.name || 'Error'})` : ''
    console.warn(`[fish-home] ${message}${detail}`)
  }
  ctx.on('agent/inbox/claimed', (payload) => evidence.capture(payload))
  ctx.effect(() => () => evidence.clear())
  for (const tool of buildTools(store, evidence)) ctx.effect(() => ctx.tools.register(tool))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'fish-home:room',
    order: 420,
    interpolate: false,
    text: () => {
      try { return promptText(store) } catch {
        return '[鱼的日常 · 小窝] 小窝数据暂时不可读。不要据此推测或编造共同经历；请用户在小窝面板查看错误。'
      }
    },
  }))
  ctx.inject(['webServer'], (injected) => {
    injected.effect(() => injected.webServer.register({ kind: 'prefix', path: WEB_PREFIX, handler: createHandler(store, { log }) }))
  })
}
