// 助手对话:每跑完一屏自动推送批次汇总,用户可追问/反馈
// 历史只在内存,关掉 app 即清(后续需要持久化再说)
import { readFileSync, statSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import OpenAI from 'openai'
import { IPC, type ChatMessage } from '../../shared/ipc'
import { loadCriteria } from './criteria'
import { getLogFilePath, log } from './logger'
import { getRunStats } from './runner'

export type BatchItem = {
  key: string
  name: string
  decision: '收藏' | '不要' | '跳过'
  score: number
  reason: string
}

export type BatchSummary = {
  batchNo: number
  total: number
  flushed: number
  items: BatchItem[]
}

const history: ChatMessage[] = []
let target: BrowserWindow | null = null
let batchCounter = 0

let client: OpenAI | null = null
function getClient(): OpenAI | null {
  if (client) return client
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return null
  client = new OpenAI({
    apiKey: key,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
  })
  return client
}
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

export function bindChatTarget(win: BrowserWindow): void {
  target = win
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function emit(msg: ChatMessage): void {
  history.push(msg)
  if (history.length > 200) history.splice(0, history.length - 200)
  if (target && !target.isDestroyed()) {
    target.webContents.send(IPC.CHAT_APPEND, msg)
  }
}

export function chatHistory(): ChatMessage[] {
  return [...history]
}

export function clearChat(): void {
  history.length = 0
  batchCounter = 0
}

export function nextBatchNo(): number {
  return ++batchCounter
}

// runner 每屏结束时调
export function pushBatchSummary(s: BatchSummary): void {
  const lines: string[] = []
  lines.push(`【第 ${s.batchNo} 批】共 ${s.total} 张卡,硬规则刷掉 ${s.flushed} 张,详情判定 ${s.items.length} 张:`)
  const collected = s.items.filter((i) => i.decision === '收藏')
  const rejected = s.items.filter((i) => i.decision === '不要')
  const pending = s.items.filter((i) => i.decision === '跳过')
  if (collected.length) {
    lines.push(`\n收藏 ${collected.length}:`)
    for (const i of collected) lines.push(`  ✓ ${i.name || i.key} (${i.score}分) — ${i.reason}`)
  }
  if (rejected.length) {
    lines.push(`\n不要 ${rejected.length}:`)
    for (const i of rejected) lines.push(`  ✗ ${i.name || i.key} (${i.score}分) — ${i.reason}`)
  }
  if (pending.length) {
    lines.push(`\n跳过 ${pending.length}:`)
    for (const i of pending) lines.push(`  ? ${i.name || i.key} (${i.score}分) — ${i.reason}`)
  }
  lines.push(
    `\n如果有要调整的(放宽/收紧/换偏好/某条规则不准),直接说。我会建议怎么改 criteria。也可以就回"继续"。`
  )
  emit({
    id: genId(),
    role: 'assistant',
    content: lines.join('\n'),
    ts: Date.now(),
    meta: { kind: 'batch_summary', batchNo: s.batchNo }
  })
}

// 用户发一条消息,助手回复
export async function sendUserMessage(text: string): Promise<ChatMessage> {
  const userMsg: ChatMessage = {
    id: genId(),
    role: 'user',
    content: text,
    ts: Date.now()
  }
  emit(userMsg)

  const c = getClient()
  if (!c) {
    const a: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '未配置 DEEPSEEK_API_KEY,无法对话。请在 .env 里配好后重启应用。',
      ts: Date.now(),
      meta: { kind: 'reply' }
    }
    emit(a)
    return a
  }

  const criteria = await loadCriteria()
  // 用近 30 条历史(避免过长)
  const recent = history.slice(-30)

  // 读最近一段 runtime.log 给助手看(只取最后 ~10KB)
  let recentLog = ''
  try {
    const f = getLogFilePath()
    if (f) {
      const st = statSync(f)
      const max = 10 * 1024
      const start = st.size > max ? st.size - max : 0
      const buf = readFileSync(f, 'utf8')
      recentLog = buf.slice(start)
      // 过滤明显噪声(renderer console 转发、CSP 警告等)
      recentLog = recentLog
        .split('\n')
        .filter(
          (l) =>
            l &&
            !/\[renderer:debug\]/.test(l) &&
            !/Electron Security Warning/.test(l) &&
            !/vite\]/.test(l) &&
            !/Content-Security-Policy/.test(l)
        )
        .slice(-120) // 最多 120 行
        .join('\n')
    }
  } catch {
    // ignore
  }

  // 当前 runner 状态
  let stats = ''
  try {
    const s = await getRunStats()
    stats = `运行状态: ${s.mode} | 扫卡 ${s.scanned} | 列表刷 ${s.flushed} | 收藏 ${s.collected} | 不要 ${s.rejected} | 跳过 ${s.checked} | 错误 ${s.errors} | seen 库 ${s.seenSize}`
  } catch {
    // ignore
  }

  const sysMsg = `你是 BOSS 直聘招聘端的"筛简历助手"。
用户刚跑了一批简历,现在可能要:
- 看你解释某个判断("为什么把张三刷了?")
- 让你看日志找问题("刚才报错了吗?")
- 调整偏好("行业里加一个 SaaS","年龄上限放到 40")
- 直接说"继续"表示满意

你能看到的上下文:
1) 招聘者的 criteria.yaml(筛选标准)
2) 主循环最近的 runtime.log(包含报错、扫卡、判定、点击等真实记录)
3) 当前主循环状态摘要

回答时**必须**:
- 先去 runtime.log 里找证据,不要凭空猜
- 如果日志显示有报错/卡住,如实指出在哪一步、原因是什么
- 如果建议改 criteria,说改哪段+字段名+新值,不贴完整 yaml
- 中文,简短,1-5 句

<criteria>
${criteria}
</criteria>

<run_stats>
${stats}
</run_stats>

<runtime_log_tail>
${recentLog || '(暂无日志或读取失败)'}
</runtime_log_tail>`

  const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: sysMsg }
  ]
  for (const m of recent) {
    if (m.role === 'system') continue
    msgs.push({ role: m.role as 'user' | 'assistant', content: m.content })
  }

  try {
    const resp = await c.chat.completions.create({
      model: MODEL,
      messages: msgs,
      temperature: 0.5,
      max_tokens: 500
    })
    const reply = resp.choices?.[0]?.message?.content?.trim() || '(空回复)'
    const a: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: reply,
      ts: Date.now(),
      meta: { kind: 'reply' }
    }
    emit(a)
    return a
  } catch (e) {
    const a: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: `调用 LLM 失败:${(e as Error).message}`,
      ts: Date.now(),
      meta: { kind: 'reply' }
    }
    log.warn(a.content)
    emit(a)
    return a
  }
}
