(() => {
  'use strict'

  const API_BASE = '/plugins/dsh-fish-home'
  const SPOTS = ['windowsill', 'desk', 'shelf', 'wall']
  const KINDS = ['plant', 'book', 'cup', 'shell', 'letter', 'ticket', 'other']
  const FALLBACK_CATALOG = {
    kinds: { plant: '植物', book: '书', cup: '杯子', shell: '贝壳', letter: '信', ticket: '票根', other: '小物' },
    spots: { windowsill: '窗台', desk: '桌边', shelf: '书架', wall: '墙上' },
  }
  const $ = (selector) => document.querySelector(selector)
  const $$ = (selector) => Array.from(document.querySelectorAll(selector))

  let catalog = FALLBACK_CATALOG
  let currentState = null
  let currentView = 'room'
  let currentDetailId = null
  let editingId = null
  let loaded = false
  let busy = false
  let editorRevision = null
  let editorOriginal = null
  let returnFocus = null
  let requestInFlight = false

  const refs = {
    loading: $('#loading'), pageError: $('#page-error'), pageErrorText: $('#page-error-text'), retry: $('#retry'), pageNotice: $('#page-notice'), live: $('#live-message'),
    roomTab: $('#room-tab'), journalTab: $('#journal-tab'), roomView: $('#room-view'), journalView: $('#journal-view'),
    search: $('#search'), clearSearch: $('#clear-search'), archiveFilterWrap: $('#archive-filter-wrap'), archiveFilter: $('#archive-filter'), refresh: $('#refresh'), add: $('#add-item'), firstAdd: $('#first-add'),
    firstHome: $('#first-home'), roomSearchEmpty: $('#room-search-empty'), count: $('#home-count'), capacity: $('#capacity-note'), toggle: $('#enabled-toggle'), exportLink: $('#export-link'),
    journalItems: $('#journal-items'), journalEmpty: $('#journal-empty'), journalEmptyTitle: $('#journal-empty-title'), journalEmptyText: $('#journal-empty-text'), journalCount: $('#journal-count'),
    detail: $('#detail-dialog'), detailClose: $('#detail-close'), detailBadge: $('#detail-source-badge'), detailIcon: $('#detail-icon'), detailMeta: $('#detail-meta'), detailTitle: $('#detail-title'), detailDate: $('#detail-date'), detailArchived: $('#detail-archived'), detailStory: $('#detail-story'), detailSourceNote: $('#detail-source-note'), detailQuote: $('#detail-quote'), detailProvenance: $('#detail-provenance'), detailSaveTime: $('#detail-save-time'), detailError: $('#detail-error'), detailEdit: $('#detail-edit'), detailArchive: $('#detail-archive'),
    editor: $('#editor-dialog'), form: $('#item-form'), editorClose: $('#editor-close'), editorCancel: $('#editor-cancel'), editorTitle: $('#editor-title'), editorHelp: $('#editor-help'), editorBadge: $('#editor-source-badge'), editorError: $('#editor-error'), submit: $('#editor-submit'), title: $('#item-title'), kind: $('#item-kind'), spot: $('#item-spot'), story: $('#item-story'), quote: $('#item-quote'), date: $('#item-date'), manualFields: $('#manual-source-fields'), conversationFields: $('#conversation-source-fields'), originalQuote: $('#editor-original-quote'), originalDate: $('#editor-original-date'),
  }

  function setText(node, value) { if (node) node.textContent = value == null ? '' : String(value) }
  function show(node, visible) { if (node) node.hidden = !visible }
  function announce(message) { setText(refs.live, message); window.setTimeout(() => setText(refs.live, ''), 1200) }
  function escapeDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '' }
  function formatDate(value) {
    if (!value) return ''
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!match) return String(value)
    return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
  }
  function formatMoment(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return `最后整理于 ${date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}`
  }
  function itemSource(item) { return item && item.source && item.source.kind === 'conversation' ? 'conversation' : 'manual' }
  function activeItems() { return (currentState && Array.isArray(currentState.items) ? currentState.items : []).filter((item) => !item.archived) }
  function allItems() { return currentState && Array.isArray(currentState.items) ? currentState.items : [] }
  function kindName(kind) { return (catalog.kinds && catalog.kinds[kind]) || FALLBACK_CATALOG.kinds[kind] || '小物' }
  function spotName(spot) { return (catalog.spots && catalog.spots[spot]) || FALLBACK_CATALOG.spots[spot] || '小窝' }

  function createSvgElement(name, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name)
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value))
    return node
  }
  function drawObject(kind, large) {
    const svg = createSvgElement('svg', { viewBox: '0 0 80 84', class: 'object-art', 'aria-hidden': 'true', focusable: 'false' })
    const group = createSvgElement('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    const fill = { plant: '#b6c9a7', book: '#d5b491', cup: '#d7bca1', shell: '#dbcba5', letter: '#eee1c6', ticket: '#d4c99f', other: '#c8c7af' }[kind] || '#c8c7af'
    const stroke = '#6f705d'
    const path = (d, attrs = {}) => group.appendChild(createSvgElement('path', { d, fill: 'none', stroke, 'stroke-width': 1.8, ...attrs }))
    const shape = (name, attrs = {}) => group.appendChild(createSvgElement(name, { stroke, 'stroke-width': 1.8, ...attrs }))
    if (kind === 'plant') {
      shape('path', { d: 'M25 66h31M30 62h22l-3 8H33Z', fill: '#c88f69' })
      path('M41 61C40 46 41 32 35 22M42 53C46 43 53 37 58 31M39 45C34 37 28 32 23 29')
      shape('path', { d: 'M35 24c-2-9 5-13 12-13 0 8-4 13-12 13ZM57 32c8-5 12-1 13 6-7 3-12 1-13-6ZM23 30c-7-6-12-3-13 4 6 4 11 3 13-4Z', fill })
    } else if (kind === 'book') {
      shape('path', { d: 'M15 23c11-3 20 0 25 4v40c-7-5-16-6-25-3ZM65 23c-11-3-20 0-25 4v40c7-5 16-6 25-3Z', fill: '#e6d1b2' })
      path('M20 33c7-1 13 0 17 3M20 42c7-1 13 0 17 3M60 33c-7-1-13 0-17 3M60 42c-7-1-13 0-17 3')
      shape('path', { d: 'M40 26v41', fill: 'none' })
    } else if (kind === 'cup') {
      shape('path', { d: 'M22 25h35v28c-1 9-7 13-18 13s-17-4-17-13Z', fill })
      shape('path', { d: 'M57 32h7c10 0 10 15 0 17h-7', fill: 'none' })
      path('M29 19c-2-5 4-6 1-11M41 19c-2-5 4-6 1-11M52 19c-2-5 4-6 1-11')
      path('M28 36h22', { stroke: '#b08d71' })
    } else if (kind === 'shell') {
      shape('path', { d: 'M14 61c4-22 16-36 26-36s22 14 26 36c-13 7-39 7-52 0Z', fill })
      path('M40 26v36M27 32c5 10 8 19 8 29M53 32c-5 10-8 19-8 29M18 47c8 6 14 10 19 14M62 47c-8 6-14 10-19 14')
    } else if (kind === 'letter') {
      shape('rect', { x: 13, y: 24, width: 54, height: 38, rx: 2, fill })
      path('m15 27 25 22 25-22M15 59l18-17M65 59 47 42')
      shape('path', { d: 'M50 26v13l-6-3-6 3V26', fill: '#d7aa8e' })
    } else if (kind === 'ticket') {
      shape('path', { d: 'M13 28h54v10c-7 0-7 10 0 10v10H13V48c7 0 7-10 0-10Z', fill })
      path('M29 30v26', { stroke: '#aaa27d', 'stroke-dasharray': '2 4' })
      path('M38 35h17M38 42h12M38 49h15')
      shape('circle', { cx: 22, cy: 42, r: 4, fill: '#ece1bc' })
    } else {
      shape('path', { d: 'M18 51c-4-15 8-29 23-30 15-1 25 10 22 23-3 14-20 22-34 18-6-2-9-5-11-11Z', fill })
      path('M29 33c4 5 8 8 15 10M45 25c-2 7-2 12 2 18M23 47c9-2 17 0 24 6')
    }
    svg.appendChild(group)
    if (!large) svg.classList.add('small-art')
    return svg
  }

  function readResponse(response) {
    return response.text().then((text) => {
      let payload = null
      try { payload = text ? JSON.parse(text) : {} } catch (_) { payload = {} }
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload && payload.error && payload.error.message ? payload.error.message : `请求失败（${response.status}）`)
        error.code = payload && payload.error && payload.error.code
        error.status = response.status
        error.payload = payload
        throw error
      }
      return payload
    })
  }
  async function request(path, options) {
    const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...options })
    return readResponse(response)
  }
  function payloadState(payload) {
    const state = payload && payload.state
    if (!payload || payload.ok !== true || !state || state.version !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.items) || typeof state.enabled !== 'boolean') {
      throw new Error('服务返回的数据格式不完整，请刷新后再试。')
    }
    if (payload.catalog && payload.catalog.kinds && payload.catalog.spots) catalog = payload.catalog
    return state
  }
  function jsonOptions(body) { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }

  function syncControls() {
    const writable = loaded && Boolean(currentState) && !busy && !requestInFlight
    const activeCount = activeItems().length
    const addLimit = allItems().length >= 120 || activeCount >= 16
    const limitReason = allItems().length >= 120 ? '已达到 120 件记录上限，仍可编辑、归档和恢复现有记录。' : '16 个位置已摆满，请先归档一件小物。'
    $$('[data-mutation-control]').forEach((button) => { button.disabled = !writable })
    ;[refs.add, refs.firstAdd, ...$$('[data-add-spot]')].forEach((button) => {
      button.disabled = !writable || addLimit
      button.dataset.atLimit = String(addLimit)
      button.title = addLimit ? limitReason : ''
    })
    const detailItem = findItem(currentDetailId)
    const restoreAtLimit = Boolean(detailItem && detailItem.archived && activeCount >= 16)
    refs.detailArchive.disabled = !writable || restoreAtLimit
    refs.detailArchive.dataset.atLimit = String(restoreAtLimit)
    refs.detailArchive.title = restoreAtLimit ? '先归档一件正在摆放的小物，再恢复这件。' : ''
    refs.refresh.disabled = busy || requestInFlight
    refs.retry.disabled = busy || requestInFlight
    refs.toggle.disabled = !writable
    refs.submit.disabled = !writable || (!editingId && addLimit)
    refs.editorClose.disabled = busy
    refs.editorCancel.disabled = busy
    refs.detailClose.disabled = busy
    const conversation = Boolean(editorOriginal && editorOriginal.sourceKind === 'conversation')
    ;[refs.title, refs.kind, refs.spot, refs.story].forEach((field) => { field.disabled = busy })
    refs.quote.disabled = busy || conversation
    refs.date.disabled = busy || conversation
    refs.exportLink.setAttribute('aria-disabled', String(!loaded || requestInFlight))
  }
  function setBusy(value) { busy = value; syncControls() }
  function showLoading(value) {
    show(refs.loading, value)
    refs.roomView.setAttribute('aria-busy', String(value))
    refs.journalView.setAttribute('aria-busy', String(value))
  }
  function showPageError(message) { setText(refs.pageErrorText, message); show(refs.pageError, true); showLoading(false) }
  function notice(message, error = false) {
    refs.pageNotice.className = `notice${error ? ' error' : ''}`
    setText(refs.pageNotice, message)
    show(refs.pageNotice, true)
    window.setTimeout(() => { if (refs.pageNotice.textContent === message) show(refs.pageNotice, false) }, 6500)
  }

  async function loadState() {
    if (requestInFlight) return false
    requestInFlight = true
    show(refs.pageError, false); show(refs.pageNotice, false); showLoading(true); loaded = false; syncControls()
    try {
      const payload = await request('/state')
      currentState = payloadState(payload)
      loaded = true
      showLoading(false)
      render()
      announce('小窝已更新')
      return true
    } catch (error) {
      showPageError(error.message || '暂时打不开小窝，请稍后再试。')
      return false
    } finally {
      requestInFlight = false
      syncControls()
    }
  }

  function getSearchQuery() { return refs.search.value.trim().toLocaleLowerCase() }
  function matches(item, query) {
    if (!query) return true
    return [item.title, item.story, item.source && item.source.quote, kindName(item.kind), spotName(item.spot), formatDate(item.happenedOn)].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)
  }
  function render() {
    if (!currentState) return
    syncControls()
    refs.toggle.setAttribute('aria-checked', String(Boolean(currentState.enabled)))
    const all = allItems()
    const active = all.filter((item) => !item.archived)
    const roomVisible = active.filter((item) => matches(item, getSearchQuery()))
    setText(refs.count, all.length ? `小窝里有 ${active.length} 件物件，共收着 ${all.length} 段日常。` : '小窝目前还空着，等一段真实发生过的日常。')
    if (all.length >= 120) setText(refs.capacity, '已收满 120 件日常，仍可编辑、归档和恢复现有记录；归档不减少记录总数。')
    else if (active.length >= 16) setText(refs.capacity, '小窝的 16 个位置已经摆满了；可以先归档一件，再添新的。')
    else setText(refs.capacity, active.length ? `还可以摆 ${16 - active.length} 件小物。` : '')
    refs.clearSearch.hidden = !refs.search.value
    show(refs.firstHome, active.length === 0 && !getSearchQuery())
    setText(refs.firstHome.querySelector('h3'), all.length ? '小窝暂时空着，日常都好好收着。' : '小窝空空的，日子还长。')
    setText(refs.firstHome.querySelector('p'), all.length ? '已经归档的日常仍在共同事件簿里。随时可以打开看看，或把想念的小物恢复回来。' : '这里还没有物件。等真的一起经历了什么，再为它留个位置。也可以亲手补记一段真实的日常。')
    setText(refs.firstAdd, all.length ? '再补记一段日常' : '补记第一段日常')
    show(refs.roomSearchEmpty, Boolean(getSearchQuery()) && roomVisible.length === 0)
    renderRoom(roomVisible)
    renderJournal()
    renderView()
  }
  function renderView() {
    const room = currentView === 'room'
    refs.roomTab.setAttribute('aria-selected', String(room)); refs.roomTab.tabIndex = room ? 0 : -1
    refs.journalTab.setAttribute('aria-selected', String(!room)); refs.journalTab.tabIndex = room ? -1 : 0
    refs.roomView.hidden = !room; refs.journalView.hidden = room
    refs.archiveFilterWrap.hidden = room
  }
  function clearNode(node) { while (node && node.firstChild) node.removeChild(node.firstChild) }
  function renderRoom(items) {
    SPOTS.forEach((spot) => {
      const host = $(`#items-${spot}`); clearNode(host)
      const spotItems = items.filter((item) => item.spot === spot)
      spotItems.forEach((item) => host.appendChild(makeObjectButton(item)))
      show($(`#empty-${spot}`), spotItems.length === 0)
    })
  }
  function makeObjectButton(item) {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'object-button'; button.dataset.id = item.id
    button.setAttribute('aria-label', `${item.title}，${kindName(item.kind)}，${spotName(item.spot)}，打开来历`)
    button.appendChild(drawObject(item.kind, false))
    const title = document.createElement('span'); title.className = 'object-title'; title.textContent = item.title; button.appendChild(title)
    const kind = document.createElement('span'); kind.className = 'object-kind'; kind.textContent = kindName(item.kind); button.appendChild(kind)
    button.addEventListener('click', () => openDetail(item.id))
    return button
  }
  function renderJournal() {
    const filter = refs.archiveFilter.value
    const query = getSearchQuery()
    let items = allItems().filter((item) => filter === 'active' ? !item.archived : filter === 'archived' ? item.archived : true).filter((item) => matches(item, query))
    items = items.slice().sort((a, b) => String(b.happenedOn || b.createdAt || '').localeCompare(String(a.happenedOn || a.createdAt || '')))
    clearNode(refs.journalItems)
    items.forEach((item) => refs.journalItems.appendChild(makeJournalEntry(item)))
    setText(refs.journalCount, query ? `找到 ${items.length} 段日常。` : `${items.length} 段日常 · ${items.filter((item) => item.archived).length} 段已归档`)
    show(refs.journalEmpty, items.length === 0)
    if (!items.length) {
      const hasAny = allItems().length > 0
      setText(refs.journalEmptyTitle, hasAny ? '没有符合条件的日常' : '还没有写下日常')
      setText(refs.journalEmptyText, hasAny ? '换个搜索词，或调整查看范围。' : '从一段真实发生过的经历开始吧。')
    }
  }
  function makeJournalEntry(item) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'journal-entry'; button.dataset.id = item.id
    button.setAttribute('aria-label', `打开${item.title}的来历`)
    button.appendChild(drawObject(item.kind, false))
    const body = document.createElement('span'); body.className = 'journal-entry-body'
    const title = document.createElement('h3'); title.textContent = item.title; body.appendChild(title)
    const story = document.createElement('p'); story.className = 'journal-entry-story'; story.textContent = item.story || '还没有写故事，点开慢慢补上。'; body.appendChild(story)
    const meta = document.createElement('span'); meta.className = 'journal-entry-meta'
    const source = document.createElement('span'); source.className = `source-badge${itemSource(item) === 'conversation' ? ' conversation' : ''}`; source.textContent = itemSource(item) === 'conversation' ? '来自对话' : '手动补记'; meta.appendChild(source)
    const spot = document.createElement('span'); spot.textContent = spotName(item.spot); meta.appendChild(spot)
    if (item.happenedOn) { const date = document.createElement('span'); date.textContent = formatDate(item.happenedOn); meta.appendChild(date) }
    if (item.archived) { const archived = document.createElement('span'); archived.className = 'archive-badge'; archived.textContent = '已归档'; meta.appendChild(archived) }
    body.appendChild(meta); button.appendChild(body)
    const arrow = document.createElement('span'); arrow.className = 'entry-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true'); button.appendChild(arrow)
    button.addEventListener('click', () => openDetail(item.id))
    return button
  }

  function findItem(id) { return allItems().find((item) => String(item.id) === String(id)) }
  function setDialogError(node, message) { setText(node, message); show(node, Boolean(message)) }
  function openDialog(dialog) {
    if (dialog.open) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }
  function closeDialog(dialog) {
    if (busy) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
    const candidate = returnFocus && returnFocus.isConnected ? returnFocus : (currentView === 'room' ? refs.roomTab : refs.journalTab)
    candidate.focus()
  }
  function openDetail(id, refreshing = false) {
    const item = findItem(id); if (!item || (busy && !refreshing)) return
    if (!refs.detail.open) returnFocus = document.activeElement
    currentDetailId = item.id; setDialogError(refs.detailError, '')
    clearNode(refs.detailIcon); refs.detailIcon.appendChild(drawObject(item.kind, true))
    refs.detailBadge.className = `source-badge${itemSource(item) === 'conversation' ? ' conversation' : ''}`; setText(refs.detailBadge, itemSource(item) === 'conversation' ? '来自对话' : '手动补记')
    setText(refs.detailMeta, `${kindName(item.kind)} · ${spotName(item.spot)}`); setText(refs.detailTitle, item.title); setText(refs.detailDate, item.happenedOn ? `发生于 ${formatDate(item.happenedOn)}` : '事件日期未记录')
    setText(refs.detailStory, item.story || '这件小物还没有写下故事。'); refs.detailStory.classList.toggle('is-empty', !item.story)
    setText(refs.detailSourceNote, itemSource(item) === 'conversation' ? '原话来自一次真实对话，保持原样保存。' : '这段原话是手动补记的来源摘录。')
    setText(refs.detailQuote, item.source && item.source.quote ? item.source.quote : '没有摘录原话。'); refs.detailQuote.classList.toggle('is-empty', !(item.source && item.source.quote))
    clearNode(refs.detailProvenance)
    const source = item.source || {}
    const rows = [['来源类型', itemSource(item) === 'conversation' ? 'conversation · 对话' : 'manual · 手动补记']]
    if (source.sessionId) rows.push(['会话', source.sessionId])
    if (typeof source.messageTime === 'number' && Number.isFinite(source.messageTime)) rows.push(['原话接收时间', new Date(source.messageTime).toLocaleString('zh-CN')])
    rows.forEach(([label, value]) => { const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; refs.detailProvenance.append(dt, dd) })
    setText(refs.detailSaveTime, formatMoment(item.updatedAt || item.createdAt))
    show(refs.detailArchived, Boolean(item.archived))
    setText(refs.detailArchived, activeItems().length >= 16 ? '这件小物已归档。小窝的 16 个位置已摆满，请先归档一件正在摆放的小物，再恢复它。' : '这件小物已归档，仍然保留在共同事件簿中。')
    refs.detailArchive.textContent = item.archived ? '恢复到小窝' : '收进归档'
    syncControls()
    openDialog(refs.detail)
    if (!refreshing) window.setTimeout(() => refs.detailClose.focus(), 0)
  }

  function fillSelect(select, values, labels, selected) {
    clearNode(select); values.forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = labels[value] || value; option.selected = value === selected; select.appendChild(option) })
  }
  function openEditor(item, spot) {
    if (!loaded || busy || requestInFlight) return
    if (!item && (activeItems().length >= 16 || allItems().length >= 120)) { notice('当前已达到容量上限，请先整理已有日常。', true); return }
    if (!item) returnFocus = document.activeElement
    editingId = item ? item.id : null
    editorRevision = currentState.revision
    editorOriginal = {
      sourceKind: item ? itemSource(item) : 'manual',
      quote: item && item.source ? item.source.quote || '' : '',
      dateValue: item ? escapeDate(item.happenedOn) : '',
    }
    setDialogError(refs.editorError, '')
    const conversation = item && itemSource(item) === 'conversation'
    refs.editorBadge.className = `source-badge${conversation ? ' conversation' : ''}`; refs.editorBadge.textContent = conversation ? '来自对话' : '手动补记'
    refs.editorTitle.textContent = item ? '整理这件小物' : '给日常留个位置'
    refs.editorHelp.textContent = item ? (conversation ? '可以调整小物的名字、故事、种类和位置；聊天来源会保持原样。' : '故事与来源原话分开保存，日期不记得就留空。') : '写下一段真实的经历，选件小物替它作纪念。带 * 的项目必填。'
    fillSelect(refs.kind, KINDS, catalog.kinds || FALLBACK_CATALOG.kinds, item ? item.kind : KINDS[0]); fillSelect(refs.spot, SPOTS, catalog.spots || FALLBACK_CATALOG.spots, item ? item.spot : (spot || SPOTS[0]))
    refs.title.value = item ? item.title || '' : ''; refs.story.value = item ? item.story || '' : ''; refs.quote.value = item && item.source ? item.source.quote || '' : ''; refs.date.value = item ? escapeDate(item.happenedOn) : ''
    show(refs.manualFields, !conversation); show(refs.conversationFields, conversation); refs.quote.disabled = conversation; refs.date.disabled = conversation
    if (conversation) { setText(refs.originalQuote, item.source && item.source.quote ? item.source.quote : '（没有保存原话）'); setText(refs.originalDate, item.happenedOn ? `事件日期：${formatDate(item.happenedOn)}` : '事件日期：未记录') }
    refs.submit.textContent = item ? '保存修改' : '放进小窝'
    syncControls()
    openDialog(refs.editor)
    window.setTimeout(() => refs.title.focus(), 0)
  }

  async function handleConflict() {
    const refreshed = await loadState()
    const message = refreshed ? '小窝刚刚有变化，已刷新最新状态。填写内容保留着，请核对后重新提交。' : '小窝刚刚有变化，但最新状态读取失败。请先关闭弹窗并刷新，再重新操作。'
    if (refreshed) {
      editorRevision = currentState.revision
      if (refs.detail.open) openDetail(currentDetailId, true)
    }
    if (refs.editor.open) setDialogError(refs.editorError, message)
    if (refs.detail.open) setDialogError(refs.detailError, message)
    notice(message, true)
  }
  async function mutateItem(id, body, successMessage, expectedRevision) {
    if (!currentState || !loaded || busy || requestInFlight) return false
    setBusy(true); setDialogError(refs.detailError, ''); setDialogError(refs.editorError, '')
    try {
      const revision = Number.isSafeInteger(expectedRevision) ? expectedRevision : currentState.revision
      const payload = await request(`/items/${encodeURIComponent(id)}`, jsonOptions({ expectedRevision: revision, ...body }))
      currentState = payloadState(payload); loaded = true; render(); announce(successMessage); return true
    } catch (error) {
      if (error.status === 409 || error.code === 'REVISION_CONFLICT') await handleConflict()
      else { setDialogError(refs.detailError, error.message || '暂时没能保存，请稍后再试。'); setDialogError(refs.editorError, error.message || '暂时没能保存，请稍后再试。') }
      return false
    } finally { setBusy(false) }
  }
  async function createItem(body) {
    if (!currentState || !loaded || busy || requestInFlight) return false
    setBusy(true); setDialogError(refs.editorError, '')
    try {
      const payload = await request('/items', jsonOptions({ expectedRevision: editorRevision, ...body }))
      currentState = payloadState(payload); loaded = true; render(); announce('小物已经放进小窝'); return true
    } catch (error) {
      if (error.status === 409 || error.code === 'REVISION_CONFLICT') await handleConflict()
      else setDialogError(refs.editorError, error.message || '暂时没能保存，请稍后再试。')
      return false
    } finally { setBusy(false) }
  }

  async function submitEditor(event) {
    event.preventDefault()
    if (busy || !currentState || !loaded || requestInFlight || !refs.form.reportValidity()) return
    const title = refs.title.value.trim(); const kind = refs.kind.value; const spot = refs.spot.value; const story = refs.story.value
    if (!title || title.length > 40) { setDialogError(refs.editorError, '请写一个 1–40 字的小物名字。'); refs.title.focus(); return }
    if (!story.trim() || story.length > 1200) { setDialogError(refs.editorError, '请写下故事，最多 1200 字。'); refs.story.focus(); return }
    const item = editingId ? findItem(editingId) : null
    if (editingId && !item) { setDialogError(refs.editorError, '这件小物的状态已经变化，请关闭表单并刷新。'); return }
    const conversation = item && itemSource(item) === 'conversation'
    const body = { title, kind, spot, story }
    if (!conversation) {
      const quote = refs.quote.value
      if (!quote.trim() || quote.length > 800) { setDialogError(refs.editorError, '请保留这段经历的原话，最多 800 字。'); refs.quote.focus(); return }
      // Unchanged provenance fields are omitted, so an ordinary story edit cannot clear them.
      if (!editingId || quote !== editorOriginal.quote) body.quote = quote
      if (!editingId || refs.date.value !== editorOriginal.dateValue) body.happenedOn = refs.date.value || null
    }
    const ok = editingId ? await mutateItem(editingId, body, '小物已经整理好', editorRevision) : await createItem(body)
    if (ok) { closeDialog(refs.editor); if (editingId) openDetail(editingId) }
  }
  async function toggleArchive() {
    const item = findItem(currentDetailId); if (!item || busy) return
    const archived = !item.archived; const ok = await mutateItem(item.id, { archived }, archived ? '已收进归档' : '已恢复到小窝')
    if (ok) { closeDialog(refs.detail); if (currentView === 'journal') render() }
  }
  async function toggleEnabled() {
    if (!currentState || !loaded || busy || requestInFlight) return
    setBusy(true)
    try {
      const enabled = !currentState.enabled
      const payload = await request('/config', jsonOptions({ expectedRevision: currentState.revision, enabled }))
      currentState = payloadState(payload); render(); announce(enabled ? '已打开聊天提示注入' : '已关闭聊天提示注入')
    } catch (error) {
      if (error.status === 409 || error.code === 'REVISION_CONFLICT') await handleConflict()
      else notice(error.message || '暂时没能修改设置，请稍后再试。', true)
    } finally { setBusy(false) }
  }

  function selectView(view) { currentView = view; renderView(); if (view === 'journal') renderJournal(); else renderRoom(activeItems().filter((item) => matches(item, getSearchQuery()))) }
  function onTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? refs.roomTab : event.key === 'End' ? refs.journalTab : event.currentTarget === refs.roomTab ? refs.journalTab : refs.roomTab
    selectView(next === refs.roomTab ? 'room' : 'journal'); next.focus()
  }

  refs.retry.addEventListener('click', loadState); refs.refresh.addEventListener('click', loadState); refs.toggle.addEventListener('click', toggleEnabled)
  refs.add.addEventListener('click', () => openEditor()); refs.firstAdd.addEventListener('click', () => openEditor())
  $$('[data-add-spot]').forEach((button) => button.addEventListener('click', () => openEditor(null, button.dataset.addSpot)))
  refs.roomTab.addEventListener('click', () => selectView('room')); refs.journalTab.addEventListener('click', () => selectView('journal')); refs.roomTab.addEventListener('keydown', onTabKey); refs.journalTab.addEventListener('keydown', onTabKey)
  refs.search.addEventListener('input', () => { refs.clearSearch.hidden = !refs.search.value; render() })
  refs.clearSearch.addEventListener('click', () => { refs.search.value = ''; refs.clearSearch.hidden = true; render(); refs.search.focus() })
  refs.archiveFilter.addEventListener('change', renderJournal)
  refs.detailClose.addEventListener('click', () => closeDialog(refs.detail)); refs.editorClose.addEventListener('click', () => closeDialog(refs.editor)); refs.editorCancel.addEventListener('click', () => closeDialog(refs.editor)); refs.form.addEventListener('submit', submitEditor)
  refs.detailEdit.addEventListener('click', () => { const item = findItem(currentDetailId); if (item) { closeDialog(refs.detail); openEditor(item) } })
  refs.detailArchive.addEventListener('click', toggleArchive)
  refs.exportLink.addEventListener('click', (event) => {
    if (!loaded || requestInFlight) { event.preventDefault(); notice('先读取小窝，再导出完整记录。', true) }
  })
  ;[refs.detail, refs.editor].forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog)
  }))
  ;[refs.detail, refs.editor].forEach((dialog) => dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog) }))

  loadState()
})()
