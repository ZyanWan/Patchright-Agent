// 纯只读:看 connectOverCDP 后能看到几个 context、各 context 有哪些 page、各 page 的 frame 结构。
// 不点击、不导航、不开标签、不抓 body。用于定位"为什么抓不到推荐页/卡片"。
import { chromium } from 'patchright'

const PORT = Number(process.env.BSA_CDP_PORT || 9222)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const contexts = browser.contexts()
const out = contexts.map((c, i) => ({
  ctx: i,
  pageCount: c.pages().length,
  pages: c.pages().map((p) => ({
    url: p.url(),
    frames: p.frames().map((f) => ({ name: f.name(), url: f.url().slice(0, 90) }))
  }))
}))
console.log(JSON.stringify({ contextCount: contexts.length, out }, null, 2))
await browser.close().catch(() => {})
setTimeout(() => process.exit(0), 50)
