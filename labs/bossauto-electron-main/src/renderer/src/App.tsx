import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_CRITERIA,
  DEFAULT_PROJECT_FILTERS,
  type BrowserStatus,
  type ChatMessage,
  type CriteriaData,
  type FilterSettings,
  type LogEntry,
  type ProbeResult,
  type ProjectFilters,
  type ProjectMeta,
  type ProjectsState,
  type RunSettings,
  type RunStats
} from '../../shared/ipc'
import { Chat } from './Chat'
import { Criteria } from './Criteria'
import { Filters } from './Filters'

declare global {
  interface Window {
    bsa: {
      launchBrowser: () => Promise<BrowserStatus>
      closeBrowser: () => Promise<void>
      getStatus: () => Promise<BrowserStatus>
      probeDomRead: () => Promise<ProbeResult>
      startRun: () => Promise<RunStats>
      pauseRun: () => Promise<RunStats>
      stopRun: () => Promise<RunStats>
      getRunStats: () => Promise<RunStats>
      getSettings: () => Promise<RunSettings>
      setSettings: (patch: Partial<RunSettings>) => Promise<RunSettings>
      getFilters: () => Promise<ProjectFilters>
      setFilters: (
        section: 'recommend' | 'search',
        patch: Partial<FilterSettings>
      ) => Promise<ProjectFilters>
      setSearchKeywords: (kws: string[]) => Promise<ProjectFilters>
      applyFilters: (section: 'recommend' | 'search') => Promise<{ ok: boolean; desc: string }>
      getCriteria: () => Promise<CriteriaData>
      setCriteria: (data: CriteriaData) => Promise<CriteriaData>
      getCriteriaRaw: () => Promise<string>
      chatHistory: () => Promise<ChatMessage[]>
      chatSend: (text: string) => Promise<ChatMessage>
      chatClear: () => Promise<ChatMessage[]>
      onChatAppend: (cb: (msg: ChatMessage) => void) => () => void
      probeBossFilters: () => Promise<{
        savedTo: string
        savedHtml: string
        url: string
        hitCount: number
        htmlSize: number
      }>
      syncChromeLogin: () => Promise<{ ok: boolean; message: string }>
      listProjects: () => Promise<ProjectsState>
      setActiveProject: (id: string) => Promise<ProjectsState>
      createProject: (name: string) => Promise<ProjectsState>
      duplicateProject: (srcId: string, name: string) => Promise<ProjectsState>
      renameProject: (id: string, name: string) => Promise<ProjectsState>
      archiveProject: (id: string) => Promise<ProjectsState>
      onLog: (cb: (e: LogEntry) => void) => () => void
      onStatus: (cb: (s: BrowserStatus) => void) => () => void
      onRunStats: (cb: (s: RunStats) => void) => () => void
    }
  }
}

const DEFAULT_RUN: RunStats = {
  mode: 'idle',
  scanned: 0,
  flushed: 0,
  checked: 0,
  collected: 0,
  rejected: 0,
  errors: 0,
  seenSize: 0,
  llmReady: false,
  llmModel: '',
  lastNote: '',
  planSummary: ''
}

const DEFAULT_SETTINGS: RunSettings = { dryRun: false, doCollect: true, doGreet: true }

export function App() {
  const [status, setStatus] = useState<BrowserStatus>({
    launched: false,
    url: '',
    loggedIn: false,
    cardCount: 0
  })
  const [run, setRun] = useState<RunStats>(DEFAULT_RUN)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_SETTINGS)
  const [projectFilters, setProjectFilters] = useState<ProjectFilters>(DEFAULT_PROJECT_FILTERS)
  const [criteria, setCriteria] = useState<CriteriaData>(DEFAULT_CRITERIA)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [nameDraft, setNameDraft] = useState<string>('')
  const [probeModal, setProbeModal] = useState<{
    hitCount: number
    htmlSize: number
    savedTo: string
    savedHtml: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const off1 = window.bsa.onLog((e) => setLogs((xs) => [...xs.slice(-499), e]))
    const off2 = window.bsa.onStatus(setStatus)
    const off3 = window.bsa.onRunStats(setRun)
    window.bsa.getStatus().then(setStatus)
    window.bsa.getRunStats().then(setRun)
    window.bsa.getSettings().then(setSettings)
    window.bsa.getFilters().then(setProjectFilters)
    window.bsa.getCriteria().then(setCriteria)
    window.bsa.listProjects().then((s) => {
      setProjects(s.projects)
      setActiveId(s.activeId)
      setNameDraft(s.projects.find((p) => p.id === s.activeId)?.name || '')
    })
    return () => {
      off1()
      off2()
      off3()
    }
  }, [])

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    // 用同步 ref 守卫,避免 busy(state)异步更新导致连点/失焦+点击并发进入
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      return await fn()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function patchSetting(p: Partial<RunSettings>) {
    const next = await window.bsa.setSettings(p)
    setSettings(next)
  }

  // ===== 项目管理 =====
  function applyProjects(s: ProjectsState) {
    setProjects(s.projects)
    setActiveId(s.activeId)
    setNameDraft(s.projects.find((p) => p.id === s.activeId)?.name || '')
  }
  // 切项目后,配置缓存按项目失效,前端重新拉一遍
  async function reloadConfigForProject() {
    const [c, f, st] = await Promise.all([
      window.bsa.getCriteria(),
      window.bsa.getFilters(),
      window.bsa.getSettings()
    ])
    setCriteria(c)
    setProjectFilters(f)
    setSettings(st)
  }
  async function switchProject(id: string) {
    if (id === activeId) return
    await withBusy(async () => {
      applyProjects(await window.bsa.setActiveProject(id))
      await reloadConfigForProject()
    })
  }
  async function newProject() {
    await withBusy(async () => {
      applyProjects(await window.bsa.createProject('新项目'))
      await reloadConfigForProject()
    })
  }
  async function copyProject() {
    await withBusy(async () => {
      const cur = projects.find((p) => p.id === activeId)
      applyProjects(await window.bsa.duplicateProject(activeId, `${cur?.name || '项目'} 副本`))
      await reloadConfigForProject()
    })
  }
  async function saveProjectName() {
    const name = nameDraft.trim()
    if (!name || name === projects.find((p) => p.id === activeId)?.name) return
    await withBusy(async () => {
      applyProjects(await window.bsa.renameProject(activeId, name))
    })
  }
  async function archiveCurrent() {
    await withBusy(async () => {
      applyProjects(await window.bsa.archiveProject(activeId))
      await reloadConfigForProject()
    })
  }

  const statusBadge = !status.launched
    ? { cls: 'warn', text: '未启动' }
    : !status.loggedIn
      ? { cls: 'warn', text: '需扫码' }
      : { cls: 'ok', text: '在线' }

  const runBadge =
    run.mode === 'running'
      ? { cls: 'ok', text: '运行中' }
      : run.mode === 'paused'
        ? { cls: 'warn', text: '已暂停' }
        : run.mode === 'stopping'
          ? { cls: 'warn', text: '停止中' }
          : { cls: '', text: '空闲' }

  const canStart = status.launched && status.loggedIn && run.mode === 'idle'
  const canPauseResume = run.mode === 'running' || run.mode === 'paused'
  const canStop = run.mode !== 'idle'

  return (
    <div className="app">
      <div className="bar">
        <h1>BOSS 自动筛简历</h1>
        <span className={`badge ${statusBadge.cls}`}>{statusBadge.text}</span>
        <span className={`badge ${runBadge.cls}`}>{runBadge.text}</span>
        {status.url && <span className="badge">{status.url.slice(0, 60)}</span>}
        {status.cardCount > 0 && <span className="badge">列表 {status.cardCount}</span>}
        <span className="spacer" />
        <button
          disabled={busy || status.launched}
          onClick={() => withBusy(() => window.bsa.launchBrowser().then(setStatus))}
        >
          启动 Chromium
        </button>
        <button
          className="ghost"
          disabled={busy || !status.launched}
          onClick={() => withBusy(() => window.bsa.probeDomRead().then(setProbe))}
        >
          验证 DOM 直读
        </button>
        <button
          className="ghost"
          disabled={busy || !status.launched}
          onClick={() =>
            withBusy(async () => {
              const r = await window.bsa.probeBossFilters()
              setProbeModal(r)
              setCopied(false)
            })
          }
        >
          探测筛选 DOM
        </button>
        <button
          disabled={busy || !canStart}
          onClick={() => withBusy(() => window.bsa.startRun().then(setRun))}
        >
          开始
        </button>
        <button
          className="ghost"
          disabled={busy || !canPauseResume}
          onClick={() => withBusy(() => window.bsa.pauseRun().then(setRun))}
        >
          {run.mode === 'paused' ? '继续' : '暂停'}
        </button>
        <button
          className="ghost"
          disabled={busy || !canStop}
          onClick={() => withBusy(() => window.bsa.stopRun().then(setRun))}
        >
          停止
        </button>
        <button
          className="ghost"
          disabled={busy || !status.launched}
          onClick={() => withBusy(() => window.bsa.closeBrowser())}
        >
          关闭
        </button>
      </div>

      <div className="projects-bar">
        <span className="label">项目</span>
        <select
          value={activeId}
          disabled={busy || run.mode !== 'idle'}
          onChange={(e) => switchProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={nameDraft}
          disabled={busy || run.mode !== 'idle'}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveProjectName}
          onKeyDown={(e) => e.key === 'Enter' && saveProjectName()}
          placeholder="项目名"
        />
        <button className="ghost" disabled={busy || run.mode !== 'idle'} onClick={newProject}>
          新建
        </button>
        <button className="ghost" disabled={busy || run.mode !== 'idle'} onClick={copyProject}>
          复制
        </button>
        <button
          className="ghost"
          disabled={busy || run.mode !== 'idle' || projects.length <= 1}
          onClick={archiveCurrent}
        >
          归档
        </button>
        {run.mode !== 'idle' && <span className="note">运行中不可切换项目</span>}
      </div>

      <div className="stats">
        <span>已扫 {run.scanned}</span>
        <span>已刷 {run.flushed}</span>
        <span className="ok-text">收藏 {run.collected}</span>
        <span>不要 {run.rejected}</span>
        <span>跳过 {run.checked}</span>
        <span>错误 {run.errors}</span>
        <span>seen库 {run.seenSize}</span>
        <span className={run.llmReady ? 'ok-text' : 'warn-text'}>
          LLM {run.llmReady ? `${run.llmModel} 就绪` : '未配置'}
        </span>
        {run.lastNote && <span className="note">{run.lastNote}</span>}
      </div>

      <div className="settings-bar">
        {run.planSummary && <span className="note">当前计划:{run.planSummary}</span>}
        <label>
          <input
            type="checkbox"
            checked={settings.doCollect}
            onChange={(e) => patchSetting({ doCollect: e.target.checked })}
          />
          自动收藏
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.doGreet}
            onChange={(e) => patchSetting({ doGreet: e.target.checked })}
          />
          自动打招呼
        </label>
        {run.planSummary.includes('真做') && (
          <span className="warn-text">⚠ 真做模式:通过分数复核的候选会被真点收藏/打招呼</span>
        )}
      </div>

      <Filters
        title="推荐筛选项"
        initial={projectFilters.recommend}
        onPatch={async (p) => {
          const next = await window.bsa.setFilters('recommend', p)
          setProjectFilters(next)
          return next.recommend
        }}
        onApply={async () => {
          await window.bsa.applyFilters('recommend')
        }}
      />

      <div className="search-keyword-bar">
        <label>搜索词(一行一个)</label>
        <textarea
          value={projectFilters.searchKeywords.join('\n')}
          placeholder="BOSS 搜索页关键词,一行一个"
          onChange={(e) => {
            // textarea 原文逐字符即时回填,保证多行输入(含空行)流畅
            const raw = e.target.value
            setProjectFilters((pf) => ({ ...pf, searchKeywords: raw.split('\n') }))
            // 落盘前规整:按行拆分、去首尾空格、丢掉空行,得到干净的搜索词数组
            const kws = raw
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
            window.bsa.setSearchKeywords(kws).then(setProjectFilters)
          }}
        />
      </div>

      <Filters
        title="搜索筛选项"
        initial={projectFilters.search}
        onPatch={async (p) => {
          const next = await window.bsa.setFilters('search', p)
          setProjectFilters(next)
          return next.search
        }}
        onApply={async () => {
          await window.bsa.applyFilters('search')
        }}
      />

      <Criteria
        initial={criteria}
        onSave={async (data) => {
          const next = await window.bsa.setCriteria(data)
          setCriteria(next)
          return next
        }}
      />

      <div className="main">
        <div className="panel panel-log">
          <div className="panel-title">日志</div>
          <div className="log">
            {logs.map((e, i) => (
              <div key={i} className={`row ${e.level}`}>
                <span className="ts">{new Date(e.ts).toLocaleTimeString()}</span>
                {e.msg}
              </div>
            ))}
          </div>
        </div>
        <div className="panel panel-chat">
          <Chat />
        </div>
        {probeModal && (
          <div className="modal-backdrop" onClick={() => setProbeModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">筛选 DOM 探测完成</div>
              <div className="modal-body">
                命中关键词 <b>{probeModal.hitCount}</b> 处,页面 HTML{' '}
                <b>{probeModal.htmlSize.toLocaleString()}</b> 字节
                <div className="modal-paths">
                  <div>json 摘要:</div>
                  <code>{probeModal.savedTo}</code>
                  <div style={{ marginTop: 6 }}>全量 html:</div>
                  <code>{probeModal.savedHtml}</code>
                </div>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={async () => {
                    const text = `${probeModal.savedTo}\n${probeModal.savedHtml}`
                    try {
                      await navigator.clipboard.writeText(text)
                      setCopied(true)
                    } catch {
                      // 兜底:用 textarea + execCommand
                      const ta = document.createElement('textarea')
                      ta.value = text
                      document.body.appendChild(ta)
                      ta.select()
                      document.execCommand('copy')
                      document.body.removeChild(ta)
                      setCopied(true)
                    }
                  }}
                >
                  {copied ? '已复制 ✓' : '复制路径'}
                </button>
                <button type="button" className="ghost" onClick={() => setProbeModal(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}
        {probe && (
          <div className="panel panel-probe">
            <div className="panel-title">
              DOM 直读
              <button type="button" className="link-btn" onClick={() => setProbe(null)}>
                关闭
              </button>
            </div>
            <div className="probe">{JSON.stringify(probe, null, 2)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
