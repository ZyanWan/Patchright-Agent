// DOM 直读关键假设验证:
// 当用户在打开候选人详情(详情浮窗 / 详情页)时,试一批候选 selector,
// 看哪个能直接读到简历正文文字(说明 BOSS 招聘端有 DOM 直读入口),
// 如果有,就完全跳过 canvas hook 那条远路。
import { currentPage } from './browser'
import { log } from './logger'
import type { ProbeResult } from '../../shared/ipc'

// 邦聘代码里直接读 .base-info-content,先把这个+常见候选都试一遍
const CANDIDATE_SELECTORS = [
  '.base-info-content',
  '.geek-base-info',
  '.resume-content',
  '.resume-detail-wrap',
  '.resume-detail',
  '.geek-detail',
  '.geek-detail-content',
  '.work-experience',
  '.educational-experience',
  '.project-experience',
  '[class*="resume"]',
  '[class*="experience"]'
]

export async function probeDomRead(): Promise<ProbeResult> {
  const page = currentPage()
  if (!page) {
    log.warn('probe 前需要先启动 Chromium')
    return { attempted: [], hits: [], topUrl: '', iframes: [] }
  }

  log.info('开始 DOM 直读探测,候选选择器数量:' + CANDIDATE_SELECTORS.length)

  const result = await page.evaluate((selectors: string[]) => {
    const out: {
      attempted: string[]
      hits: { selector: string; sampleText: string; len: number }[]
      topUrl: string
      iframes: { name: string; url: string }[]
    } = { attempted: selectors, hits: [], topUrl: location.href, iframes: [] }

    // 收集所有 iframes 信息,方便定位候选人详情藏在哪
    Array.from(document.querySelectorAll('iframe')).forEach((f) => {
      const name = (f as HTMLIFrameElement).name || ''
      const url = (f as HTMLIFrameElement).src || ''
      out.iframes.push({ name, url })
    })

    // 在顶层 document + 所有同源 iframe 内分别试
    const docs: Document[] = [document]
    Array.from(document.querySelectorAll('iframe')).forEach((f) => {
      try {
        const d = (f as HTMLIFrameElement).contentDocument
        if (d) docs.push(d)
      } catch {
        // 跨源 iframe 拿不到,跳过
      }
    })

    for (const sel of selectors) {
      for (const d of docs) {
        const nodes = d.querySelectorAll(sel)
        if (nodes.length === 0) continue
        // 取第一个 node 的可见文本(剔除空白)
        const txt = Array.from(nodes)
          .map((n) => (n as HTMLElement).innerText || n.textContent || '')
          .join('\n')
          .replace(/\s+/g, ' ')
          .trim()
        if (txt.length > 30) {
          out.hits.push({
            selector: sel,
            sampleText: txt.slice(0, 400),
            len: txt.length
          })
          break // 同一 selector 命中一次就够
        }
      }
    }
    return out
  }, CANDIDATE_SELECTORS)

  log.info(
    `探测完成:命中 ${result.hits.length} 个选择器,顶层 URL=${result.topUrl},iframe ${result.iframes.length} 个`
  )
  if (result.hits.length > 0) {
    log.info('★ 发现 DOM 直读入口,canvas hook 那条路可以完全跳过')
  } else {
    log.warn('未发现 DOM 直读入口;可能候选人详情还没打开,或仍走 canvas 渲染')
  }
  return result
}
