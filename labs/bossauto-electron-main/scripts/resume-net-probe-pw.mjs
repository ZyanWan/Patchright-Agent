// 一次性诊断(patchright 版):验证 BOSS 简历详情正文是否随某个网络接口以可读文本返回。
// 比裸 CDP 版可靠:patchright 的 page.on('response') 天然覆盖 OOPIF 子 frame(含 c-resume),
// response.text() 直接拿 body,不用手动管 CDP session。
// 流程:connectOverCDP 9222 → 在现有 context 新开一个临时 tab(只监听这个 page)→ goto 推荐页
//   → 照 runner 的姿势点第一张卡的"姓名"打开详情正文 → 等 c-resume frame 出现
//   → 收集这期间响应,对 c-resume frame 发起的 / url 像简历接口的取 text,扫中文与关键词 → 关 tab。
import { chromium } from 'patchright'

const PORT = Number(process.env.BSA_CDP_PORT || 9222)
const WATCHDOG_MS = Number(process.env.BSA_CDP_WATCHDOG_MS || 90000)
let stage = 'start'
const wd = setTimeout(() => {
  console.log(JSON.stringify({ error: 'watchdog timeout', stage }, null, 2))
  process.exit(2)
}, WATCHDOG_MS)

const KW = ['工作经历', '工作经验', '项目经验', '项目经历', '教育经历', '岗位职责', '负责', '期望', '优势', '自我评价', '专业技能']
const URL_HINT = /resume|geek|zpgeek|wapi|detail|card|candidate/i
const reHan = new RegExp('[\\u4e00-\\u9fa5]')
const reHanG = new RegExp('[\\u4e00-\\u9fa5]', 'g')
const rePuaG = new RegExp('[\\ue000-\\uf8ff]', 'g')
const CARD = 'li.geek-info-card, li.card-item div.candidate-card-wrap, li.card-item, .geek-item, .candidate-card'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function analyze(url, mimeType, frameUrl, resType, body) {
  const s = String(body || '')
  const han = (s.match(reHanG) || []).length
  const pua = (s.match(rePuaG) || []).length
  const hitKw = KW.filter((k) => s.includes(k))
  let sample = ''
  if (hitKw.length) {
    const idx = s.indexOf(hitKw[0])
    sample = s.slice(Math.max(0, idx - 40), idx + 400)
  } else if (han > 20) {
    const m = s.match(reHan)
    const idx = m ? s.indexOf(m[0]) : 0
    sample = s.slice(Math.max(0, idx - 20), idx + 400)
  }
  return { url, frameUrl, resType, mimeType, len: s.length, han, pua, hitKw, sample }
}

async function tryClick(page) {
  const frame =
    page.frames().find((f) => f.name() === 'recommendFrame') ||
    page.frames().find((f) => /recommend/.test(f.url()) && f !== page.mainFrame()) ||
    page.mainFrame()
  const card = frame.locator(CARD).first()
  if ((await card.count().catch(() => 0)) === 0) return null
  await card.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
  const name = card.locator('.name-label, span.name, .geek-name').first()
  let label = ''
  if ((await name.count().catch(() => 0)) > 0) {
    label = await name.innerText().catch(() => '')
    await name.click({ timeout: 3000 })
  } else {
    await card.click({ timeout: 3000, position: { x: 100, y: 40 } })
  }
  return { name: label.replace(/\s+/g, ' ').slice(0, 24) }
}

async function main() {
  stage = 'connect'
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0] || (await browser.newContext())

  stage = 'find logged-in tab'
  const pages = ctx.pages()
  const page =
    pages.find((p) => /\/web\/chat\/recommend/.test(p.url())) ||
    pages.find((p) => /\/web\/chat\//.test(p.url())) ||
    pages.find((p) => /zhipin\.com/.test(p.url()))
  if (!page) {
    console.log(JSON.stringify({ error: 'no logged-in recommend tab found', stage }, null, 2))
    await browser.close().catch(() => {})
    clearTimeout(wd)
    process.exit(1)
  }
  const captured = []
  page.on('response', (resp) => {
    try {
      captured.push({
        resp,
        url: resp.url(),
        status: resp.status(),
        resType: resp.request().resourceType(),
        frameUrl: resp.frame() ? resp.frame().url() : ''
      })
    } catch {
      // 忽略已失效的响应
    }
  })

  // 不导航、不新开:就用用户当前这个已登录的推荐页。先 ESC 清掉可能浮着的旧详情。
  stage = 'click name'
  for (let k = 0; k < 2; k++) {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(150)
  }
  let clicked = null
  for (let i = 0; i < 40 && !clicked; i++) {
    await sleep(500)
    clicked = await tryClick(page).catch(() => null)
  }

  stage = 'wait c-resume'
  let cResumeUrl = ''
  for (let i = 0; i < 30 && !cResumeUrl; i++) {
    await sleep(500)
    const f = page.frames().find((fr) => /\/web\/frame\/c-resume\//.test(fr.url()))
    if (f) cResumeUrl = f.url()
  }
  await sleep(3500) // 让 c-resume 的接口都落地

  stage = 'analyze'
  const findings = []
  const seen = new Set()
  for (const c of captured) {
    const fromResume = /\/web\/frame\/c-resume\//.test(c.frameUrl)
    const looksData = URL_HINT.test(c.url) && (c.resType === 'xhr' || c.resType === 'fetch')
    if (!(fromResume || looksData)) continue
    if (['image', 'font', 'media', 'stylesheet'].includes(c.resType)) continue
    if (seen.has(c.url)) continue
    seen.add(c.url)
    let body = ''
    try {
      body = await c.resp.text()
    } catch (e) {
      body = '__ERR__:' + e.message
    }
    const ct = (c.resp.headers() || {})['content-type'] || ''
    const a = analyze(c.url, ct, c.frameUrl, c.resType, body)
    a.fromResume = fromResume
    findings.push(a)
  }

  // 恢复用户视图:ESC 关掉刚打开的详情浮层;绝不关闭用户的 tab,只断开 CDP 连接。
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(150)
  }
  await browser.close().catch(() => {})

  findings.sort((a, b) => {
    const sa = (a.fromResume ? 100000 : 0) + a.hitKw.length * 10000 + a.han
    const sb = (b.fromResume ? 100000 : 0) + b.hitKw.length * 10000 + b.han
    return sb - sa
  })
  console.log(JSON.stringify({
    clicked,
    cResumeUrl,
    totalResponses: captured.length,
    candidateCount: findings.length,
    topFindings: findings.slice(0, 14)
  }, null, 2))
  clearTimeout(wd)
  setTimeout(() => process.exit(0), 50)
}

main().catch((e) => {
  console.log(JSON.stringify({ error: e.message, stack: (e.stack || '').slice(0, 300), stage }, null, 2))
  process.exit(1)
})
