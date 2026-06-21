// 详情面板里的写操作:收藏 / 打招呼
// BOSS 详情面板内嵌在列表 frame(recommendFrame/searchFrame),与列表卡按钮共存,
// 必须把按钮查找作用域收窄到"详情容器"内,否则可能误点列表里其它候选人的按钮
import type { Page, Frame, Locator } from 'patchright'
import { log } from './logger'
import { humanPause, sleep } from './human'

// 详情容器候选 selector:限定按钮/已沟通判断作用域,只在详情面板内查找,排除列表卡按钮
// 实测 BOSS 招聘端详情面板用 .resume-layout-wrap > .resume-middle-wrap > ... > .resume-item-detail
// (历史 .resume-detail-wrap 已不存在,保留作其它场景的兜底)
const DETAIL_CONTAINER_SELECTORS = [
  '.resume-item-detail', // 最精确:仅当前打开的详情节点
  '.resume-simple-box',
  '.resume-right-side',
  '.resume-detail-wrap',
  '[class*="resume-detail"]',
  '[class*="candidate-detail"]',
  '[class*="geek-info-page"]',
  '.geek-detail', // 历史兜底,与 runner.ts readDetail 同步
  '.candidate-detail',
  '.resume-detail',
  '.resume-layout-wrap' // 最外层兜底,放最后避免抢先命中
]

const COLLECT_SELECTORS = [
  '.like-icon-and-text',
  '.like-icon',
  '[class*="like-icon"]',
  '[class*="collect"]'
]

const GREET_SELECTORS = [
  '.button-chat-wrap.resumeGreet button.btn-greet', // 实测:详情面板按钮 wrap 带 resumeGreet 标记,最稳
  '.button-chat-wrap.resumeGreet',
  'button.btn-greet',
  '.btn-greet',
  'div.chat-button-wrap',
  'div.button-chat-wrap',
  'button:has-text("打招呼")',
  'button:has-text("立即沟通")',
  'a:has-text("打招呼")'
]

// 找首个含详情容器(可见且有内容)的 frame
async function findDetailContext(
  page: Page
): Promise<{ ctx: Page | Frame; container: Locator; containerSel: string; where: string } | null> {
  const contexts: Array<{ ctx: Page | Frame; where: string }> = [{ ctx: page, where: 'page' }]
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue
    contexts.push({ ctx: f, where: `frame:${f.name() || f.url().slice(0, 40)}` })
  }
  for (const { ctx, where } of contexts) {
    for (const sel of DETAIL_CONTAINER_SELECTORS) {
      try {
        const all = ctx.locator(sel)
        const n = await all.count().catch(() => 0)
        for (let i = 0; i < n; i++) {
          const el = all.nth(i)
          const visible = await el.isVisible().catch(() => false)
          if (!visible) continue
          const box = await el.boundingBox().catch(() => null)
          if (!box || box.width < 200 || box.height < 200) continue
          return { ctx, container: el, containerSel: sel, where }
        }
      } catch {
        // 试下一个
      }
    }
  }
  return null
}

async function clickInDetail(
  page: Page,
  selectors: string[],
  label: string
): Promise<boolean> {
  const detail = await findDetailContext(page)
  if (!detail) {
    log.warn(`${label}失败:未找到详情容器`)
    return false
  }
  for (const sel of selectors) {
    try {
      const all = detail.container.locator(sel)
      const n = await all.count().catch(() => 0)
      for (let i = 0; i < n; i++) {
        const el = all.nth(i)
        const visible = await el.isVisible().catch(() => false)
        if (!visible) continue
        const box = await el.boundingBox().catch(() => null)
        if (!box || box.width <= 0 || box.height <= 0) continue
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {})
          await el.click({ timeout: 2500 })
          log.info(`${label}成功:selector=${sel} container=${detail.containerSel} where=${detail.where}`)
          return true
        } catch (e) {
          log.warn(`${label}点击失败:${(e as Error).message.slice(0, 60)}`)
          // 试同 selector 下一个或下一个 selector
        }
      }
    } catch {
      // 试下一个
    }
  }
  log.warn(`${label}失败:详情容器内未命中按钮`)
  return false
}

export async function collectCurrent(page: Page): Promise<boolean> {
  const ok = await clickInDetail(page, COLLECT_SELECTORS, '点收藏')
  if (ok) await humanPause(700, 200)
  return ok
}

function hasContactedSignal(text: string): boolean {
  return /已沟通|沟通记录|继续沟通|已打招呼|已联系|已交换|聊过/.test(text)
}

export async function greetCurrent(page: Page): Promise<boolean> {
  const detail = await findDetailContext(page)
  if (!detail) {
    log.warn('打招呼前未找到详情容器,跳过')
    return false
  }
  // 只看详情容器内的文本,避免列表里其他候选人显示"已沟通"误伤当前
  const detailText = await detail.container.innerText().catch(() => '')
  if (hasContactedSignal(detailText)) {
    log.info('跳过打招呼:详情显示已沟通')
    return false
  }
  const ok = await clickInDetail(page, GREET_SELECTORS, '点打招呼')
  if (!ok) return false
  await sleep(800)
  // 注:招呼语弹窗的二次确认还未做;若 BOSS 弹窗等待发送,此处会留空,后续观察日志决定是否补
  return true
}
