const PORT = Number(process.env.BSA_CDP_PORT || 9222)
const CLICK = process.argv.includes('--click')
const DEBUG = process.env.BSA_CDP_DEBUG === '1'
let stage = 'start'
const debug = (...args) => {
  if (DEBUG) console.error('[cdp-probe]', ...args)
}
setTimeout(() => {
  console.log(JSON.stringify({ error: 'probe watchdog timeout', stage }, null, 2))
  process.exit(2)
}, Number(process.env.BSA_CDP_WATCHDOG_MS || 30000))

const HOOK_SOURCE = `(() => {
  if (window.__bsaCdpProbeInstalled) return;
  window.__bsaCdpProbeInstalled = true;
  const probe = window.__bsaCdpProbe = window.__bsaCdpProbe || {
    captured: [],
    drawImages: [],
    stats: { fillText: 0, strokeText: 0, drawImage: 0, getContext2d: 0, webgl: 0, worker: 0, offscreen: 0 }
  };
  function pushText(kind, ctx, args) {
    try {
      probe.stats[kind]++;
      probe.captured.push({
        kind,
        t: String(args[0]),
        x: Number(args[1]),
        y: Number(args[2]),
        fs: String(ctx.fillStyle).slice(0, 40),
        font: String(ctx.font || '').slice(0, 80)
      });
    } catch (e) {}
  }
  function patch2d(proto) {
    if (!proto || proto.__bsaCdpProbePatched) return;
    Object.defineProperty(proto, '__bsaCdpProbePatched', { value: true });
    for (const name of ['fillText', 'strokeText']) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = function(...args) {
        pushText(name, this, args);
        return orig.apply(this, args);
      };
    }
    const origDraw = proto.drawImage;
    if (typeof origDraw === 'function') {
      proto.drawImage = function(...args) {
        try {
          probe.stats.drawImage++;
          const src = args[0];
          probe.drawImages.push({
            tag: src && src.tagName ? String(src.tagName) : Object.prototype.toString.call(src),
            w: Number(src && (src.naturalWidth || src.videoWidth || src.width || 0)),
            h: Number(src && (src.naturalHeight || src.videoHeight || src.height || 0)),
            x: Number(args[1]),
            y: Number(args[2])
          });
          if (probe.drawImages.length > 200) probe.drawImages.shift();
        } catch (e) {}
        return origDraw.apply(this, args);
      };
    }
  }
  try { patch2d(CanvasRenderingContext2D.prototype); } catch (e) {}
  try { patch2d(OffscreenCanvasRenderingContext2D.prototype); } catch (e) {}
  try {
    const origGet = HTMLCanvasElement.prototype.getContext;
    if (origGet && !HTMLCanvasElement.prototype.__bsaCdpProbeGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, '__bsaCdpProbeGetContext', { value: true });
      HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
        try {
          if (String(type).includes('2d')) probe.stats.getContext2d++;
          if (String(type).includes('webgl')) probe.stats.webgl++;
        } catch (e) {}
        return origGet.call(this, type, ...rest);
      };
    }
  } catch (e) {}
  try {
    if (HTMLCanvasElement.prototype.transferControlToOffscreen && !HTMLCanvasElement.prototype.__bsaCdpProbeOffscreen) {
      const orig = HTMLCanvasElement.prototype.transferControlToOffscreen;
      Object.defineProperty(HTMLCanvasElement.prototype, '__bsaCdpProbeOffscreen', { value: true });
      HTMLCanvasElement.prototype.transferControlToOffscreen = function(...args) {
        try { probe.stats.offscreen++; } catch (e) {}
        return orig.apply(this, args);
      };
    }
  } catch (e) {}
  try {
    if (window.Worker && !window.Worker.__bsaCdpProbePatched) {
      const OrigWorker = window.Worker;
      const WrappedWorker = function(...args) {
        try { probe.stats.worker++; } catch (e) {}
        return Reflect.construct(OrigWorker, args, new.target || OrigWorker);
      };
      WrappedWorker.prototype = OrigWorker.prototype;
      Object.defineProperty(WrappedWorker, '__bsaCdpProbePatched', { value: true });
      window.Worker = WrappedWorker;
    }
  } catch (e) {}
})();`

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 10000)
      this.ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('CDP websocket error'))
      }, { once: true })
    })
    this.ws.addEventListener('message', (event) => this.onMessage(event))
  }

  on(method, fn) {
    const list = this.handlers.get(method) || []
    list.push(fn)
    this.handlers.set(method, list)
  }

  emit(method, payload) {
    for (const fn of this.handlers.get(method) || []) fn(payload)
    for (const fn of this.handlers.get('*') || []) fn(method, payload)
  }

  onMessage(event) {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(`${msg.error.message || 'CDP error'} ${msg.error.data || ''}`.trim()))
      else p.resolve(msg.result || {})
      return
    }
    if (msg.method) this.emit(msg.method, { ...(msg.params || {}), cdpSessionId: msg.sessionId })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 10000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  close() {
    this.ws?.close()
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

function flattenFrames(node, out = []) {
  if (!node) return out
  out.push(node.frame)
  for (const child of node.childFrames || []) flattenFrames(child, out)
  return out
}

function valueOf(result) {
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception')
  return result?.result?.value
}

async function main() {
  stage = 'fetch version'
  debug('fetch version')
  const version = await getJson(`http://127.0.0.1:${PORT}/json/version`)
  const cdp = new Cdp(version.webSocketDebuggerUrl)
  const sessions = new Map()
  const frameContexts = new Map()
  const attached = []

  function rememberContext(sessionId, ctx) {
    const frameId = ctx?.auxData?.frameId
    if (!sessionId || !frameId) return
    const key = `${sessionId}:${frameId}`
    const list = frameContexts.get(key) || []
    list.push({ id: ctx.id, isDefault: ctx.auxData?.isDefault !== false })
    frameContexts.set(key, list)
  }

  async function inject(sessionId, targetInfo) {
    if (!sessionId || sessions.get(sessionId)?.injecting) return
    debug('inject start', sessionId, targetInfo?.type, targetInfo?.url)
    const meta = sessions.get(sessionId) || { targetInfo }
    meta.injecting = true
    sessions.set(sessionId, meta)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK_SOURCE }, sessionId).catch(() => {})
    await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    await cdp.send('Page.enable', {}, sessionId).catch(() => {})
    await cdp.send('Runtime.enable', {}, sessionId).catch(() => {})
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    }, sessionId).catch(() => {})
    await cdp.send('Runtime.evaluate', { expression: HOOK_SOURCE, awaitPromise: false }, sessionId).catch(() => {})
    meta.ready = true
    debug('inject done', sessionId)
  }

  cdp.on('Target.attachedToTarget', (p) => {
    const targetInfo = p.targetInfo || {}
    debug('attached', p.sessionId, targetInfo.type, targetInfo.url || '')
    sessions.set(p.sessionId, { targetInfo, injected: false })
    attached.push({ sessionId: p.sessionId, type: targetInfo.type, url: targetInfo.url || '' })
    void inject(p.sessionId, targetInfo)
  })
  cdp.on('Runtime.executionContextCreated', (p) => rememberContext(p.cdpSessionId, p.context))
  cdp.on('Target.targetInfoChanged', (p) => {
    for (const meta of sessions.values()) {
      if (meta.targetInfo?.targetId === p.targetInfo?.targetId) meta.targetInfo = p.targetInfo
    }
  })

  debug('connect ws')
  stage = 'connect ws'
  await cdp.connect()
  debug('set discover')
  stage = 'set discover'
  await cdp.send('Target.setDiscoverTargets', { discover: true })
  debug('set auto attach')
  stage = 'set auto attach'
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true
  })

  let bossSession = ''
  stage = 'find boss session'
  for (let i = 0; i < 30 && !bossSession; i++) {
    for (const [sessionId, meta] of sessions.entries()) {
      if (/zhipin\.com\/web\/chat\/recommend/.test(String(meta.targetInfo?.url || ''))) {
        bossSession = sessionId
        break
      }
    }
    if (!bossSession) await sleep(200)
  }
  debug('boss session', bossSession)
  if (!bossSession) throw new Error('No recommend page session found')

  let clicked = false
  if (CLICK) {
    debug('click first card')
    stage = 'click first card'
    clicked = await clickFirstCard(cdp, bossSession, frameContexts)
  }

  debug('wait resume')
  stage = 'wait resume'
  const resume = await waitForResumeProbe(cdp, sessions, frameContexts, 20000)
  debug('got resume')
  console.log(JSON.stringify({
    browser: version.Browser,
    attached: attached.map((i) => ({ type: i.type, url: i.url })).slice(0, 20),
    clicked,
    resume
  }, null, 2))
  cdp.close()
  setTimeout(() => process.exit(0), 50)
}

async function clickFirstCard(cdp, pageSession, frameContexts) {
  const tree = await cdp.send('Page.getFrameTree', {}, pageSession)
  const frames = flattenFrames(tree.frameTree)
  const frame = frames.find((f) => f.name === 'recommendFrame') ||
    frames.find((f) => /recommend/.test(f.url || '') && f.parentId) ||
    frames.find((f) => /recommend/.test(f.url || ''))
  if (!frame) throw new Error('No recommend frame found')

  const key = `${pageSession}:${frame.id}`
  let contexts = frameContexts.get(key) || []
  for (let i = 0; i < 20 && contexts.length === 0; i++) {
    await sleep(250)
    contexts = frameContexts.get(key) || []
  }
  const contextId = (contexts.find((c) => c.isDefault) || contexts[0])?.id
  if (!contextId) throw new Error('No recommend frame execution context')

  const card = await cdp.send('Runtime.evaluate', {
    contextId,
    returnByValue: true,
    expression: `(() => {
      const sels = ['li.card-item div.candidate-card-wrap', 'li.card-item', '.candidate-card', '.geek-item'];
      for (const sel of sels) {
        const nodes = Array.from(document.querySelectorAll(sel));
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (r.width > 80 && r.height > 40) {
            return { sel, x: r.left + Math.min(110, Math.max(40, r.width / 4)), y: r.top + Math.min(45, Math.max(25, r.height / 4)), text: (el.innerText || '').slice(0, 120) };
          }
        }
      }
      return null;
    })()`
  }, pageSession).then(valueOf)
  if (!card) throw new Error('No visible candidate card found')

  let offset = { x: 0, y: 0 }
  if (frame.parentId) {
    await cdp.send('DOM.enable', {}, pageSession).catch(() => {})
    const owner = await cdp.send('DOM.getFrameOwner', { frameId: frame.id }, pageSession)
    const model = await cdp.send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }, pageSession)
    const border = model.model.border
    offset = { x: Math.min(border[0], border[2], border[4], border[6]), y: Math.min(border[1], border[3], border[5], border[7]) }
  }

  const x = offset.x + card.x
  const y = offset.y + card.y
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, pageSession)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, pageSession)
  await sleep(80)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, pageSession)
  return true
}

async function waitForResumeProbe(cdp, sessions, frameContexts, timeoutMs) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    for (const [sessionId, meta] of sessions.entries()) {
      const info = meta.targetInfo || {}
      if (info.type && info.type !== 'page' && info.type !== 'iframe') continue
      if (info.url && !/zhipin\.com/.test(info.url)) continue
      const tree = await cdp.send('Page.getFrameTree', {}, sessionId).catch(() => null)
      if (!tree) continue
      for (const frame of flattenFrames(tree.frameTree)) {
        if (!/\/web\/frame\/c-resume\//.test(frame.url || '')) continue
        const contexts = frameContexts.get(`${sessionId}:${frame.id}`) || []
        const contextId = (contexts.find((c) => c.isDefault) || contexts[0])?.id
        if (!contextId) continue
        last = await probeContext(cdp, sessionId, contextId).catch((e) => ({ error: e.message, url: frame.url }))
        if (last?.hooked || last?.canvasCount > 0) return last
      }
    }
    await sleep(500)
  }
  return last || { error: 'c-resume frame not found before timeout' }
}

async function probeContext(cdp, sessionId, contextId) {
  return cdp.send('Runtime.evaluate', {
    contextId,
    returnByValue: true,
    expression: `(() => {
      const canvases = Array.from(document.querySelectorAll('canvas')).slice(0, 5).map((c) => {
        let data = '';
        try { data = c.toDataURL().length; } catch (e) { data = 'ERR:' + e.name; }
        return { w: c.width, h: c.height, data };
      });
      const probe = window.__bsaCdpProbe || null;
      return {
        url: location.href,
        ready: document.readyState,
        bodyTextLen: document.body ? document.body.innerText.length : 0,
        hooked: !!window.__bsaCdpProbeInstalled,
        canvasCount: canvases.length,
        canvases,
        stats: probe ? probe.stats : null,
        capturedLen: probe ? probe.captured.length : 0,
        capturedSample: probe ? probe.captured.slice(0, 20) : [],
        drawImageSample: probe ? probe.drawImages.slice(0, 20) : []
      };
    })()`
  }, sessionId).then(valueOf)
}

main().catch((e) => {
  console.error(e.stack || e.message)
  process.exitCode = 1
})
