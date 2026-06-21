import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '../shared/ipc'
import { bindLogger, log } from './lib/logger'
import { autoSearch, closeBrowser, getStatus, launchBrowser } from './lib/browser'
import { probeDomRead } from './lib/probe'
import { getRunStats, pauseRun, startRun, stopRun } from './lib/runner'
import { loadDotEnvs } from './lib/env'
import { getSettings, updateSettings } from './lib/settings'
import {
  describeForApply,
  getProjectFilters,
  getSectionFilters,
  setSearchKeywords,
  setSectionFilters
} from './lib/filters'
import { applyFiltersToBoss } from './lib/boss-filter-apply'
import { loadCriteria, readCriteriaData, writeCriteriaData } from './lib/criteria'
import { bindChatTarget, chatHistory, clearChat, sendUserMessage } from './lib/chat'
import { probeBossFilters } from './lib/boss-filter'
import { syncChromeLogin } from './lib/chrome-sync'
import {
  archiveProject,
  createProject,
  duplicateProject,
  getActiveProjectId,
  listProjects,
  renameProject,
  setActiveProject
} from './lib/projects'
import type { CriteriaData, FilterSection, FilterSettings, RunSettings } from '../shared/ipc'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 关键:禁用 GPU 硬件加速。Windows 上同时跑 Electron + patchright Chromium 两个
// Chromium 实例时,GPU 进程容易冲突导致 renderer crash(exitCode -1)。
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let rendererCrashCount = 0

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'BOSS 自动筛简历',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  bindLogger(mainWindow)
  bindChatTarget(mainWindow)

  // 把 renderer 的 console 错误/警告全部转到主进程 stdout 和 logger
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const lvl = level >= 3 ? 'error' : level === 2 ? 'warn' : 'info'
    const tag = `[renderer:${lvl}]`
    const tail = source ? ` (${source}:${line})` : ''
    if (lvl === 'error') log.error(`${tag} ${message}${tail}`)
    else if (lvl === 'warn') log.warn(`${tag} ${message}${tail}`)
    else log.debug(`${tag} ${message}${tail}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error(`renderer 进程崩溃:${JSON.stringify(details)}`)
    rendererCrashCount++
    // renderer 崩溃时只重载 UI 页面,不让窗口关闭(否则 window-all-closed → app.quit
    // 会连带关掉 BOSS 浏览器并触发 dev 重启死循环)。连续崩 5 次才放弃。
    if (rendererCrashCount <= 5 && mainWindow && !mainWindow.isDestroyed()) {
      log.warn(`第 ${rendererCrashCount} 次崩溃,2s 后重载 UI(不关浏览器)`)
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload()
      }, 2000)
    }
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`renderer 加载失败 code=${code} desc=${desc} url=${url}`)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // 按 F12 / Ctrl+Shift+I 自行打开 DevTools
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc() {
  ipcMain.handle(IPC.BROWSER_LAUNCH, async () => {
    try {
      await launchBrowser()
    } catch (e) {
      log.error(`启动失败:${(e as Error).message}`)
    }
    return getStatus()
  })

  ipcMain.handle(IPC.BROWSER_CLOSE, async () => {
    await closeBrowser()
  })

  ipcMain.handle(IPC.BROWSER_STATUS, async () => {
    return getStatus()
  })

  ipcMain.handle(IPC.PROBE_DOM_READ, async () => {
    return probeDomRead()
  })

  ipcMain.handle(IPC.RUN_START, async () => {
    startRun()
    return getRunStats()
  })
  ipcMain.handle(IPC.RUN_PAUSE, async () => {
    pauseRun()
    return getRunStats()
  })
  ipcMain.handle(IPC.RUN_STOP, async () => {
    stopRun()
    return getRunStats()
  })
  ipcMain.handle(IPC.RUN_STATS, async () => getRunStats())
  ipcMain.handle(IPC.SETTINGS_GET, async () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, async (_e, patch: Partial<RunSettings>) =>
    updateSettings(patch)
  )
  ipcMain.handle(IPC.FILTERS_GET, async () => getProjectFilters())
  ipcMain.handle(IPC.FILTERS_SET, async (_e, section: FilterSection, patch: Partial<FilterSettings>) =>
    setSectionFilters(section, patch)
  )
  ipcMain.handle(IPC.FILTERS_KEYWORD, async (_e, kws: string[]) => setSearchKeywords(kws))
  ipcMain.handle(IPC.CRITERIA_GET, async () => readCriteriaData())
  ipcMain.handle(IPC.CRITERIA_SET, async (_e, data: CriteriaData) => {
    await writeCriteriaData(data)
    return readCriteriaData()
  })
  ipcMain.handle(IPC.CRITERIA_RAW, async () => loadCriteria())
  ipcMain.handle(IPC.CHAT_HISTORY, async () => chatHistory())
  ipcMain.handle(IPC.CHAT_SEND, async (_e, text: string) => sendUserMessage(text))
  ipcMain.handle(IPC.CHAT_CLEAR, async () => {
    clearChat()
    return []
  })
  ipcMain.handle(IPC.BOSS_FILTER_PROBE, async () => probeBossFilters())
  ipcMain.handle(IPC.CHROME_SYNC_LOGIN, async () => syncChromeLogin())
  ipcMain.handle(IPC.FILTERS_APPLY, async (_e, section: FilterSection) => {
    const desc = await describeForApply(section)
    log.info(`[BOSS]准备应用筛选(${section}):${desc}`)
    const f = await getSectionFilters(section)
    const r = await applyFiltersToBoss(f, section)
    return { ok: r.ok, desc: `${desc} — ${r.message}` }
  })

  // 多项目:任何增删改后统一返回最新 {projects, activeId}
  const projectsState = async () => ({
    projects: await listProjects(),
    activeId: await getActiveProjectId()
  })
  ipcMain.handle(IPC.PROJECTS_LIST, projectsState)
  ipcMain.handle(IPC.PROJECTS_SET_ACTIVE, async (_e, id: string) => {
    await setActiveProject(id)
    return projectsState()
  })
  ipcMain.handle(IPC.PROJECTS_CREATE, async (_e, name: string) => {
    const meta = await createProject(name)
    await setActiveProject(meta.id) // 新建后切到新项目
    return projectsState()
  })
  ipcMain.handle(IPC.PROJECTS_DUPLICATE, async (_e, srcId: string, name: string) => {
    const meta = await duplicateProject(srcId, name)
    await setActiveProject(meta.id)
    return projectsState()
  })
  ipcMain.handle(IPC.PROJECTS_RENAME, async (_e, id: string, name: string) => {
    await renameProject(id, name)
    return projectsState()
  })
  ipcMain.handle(IPC.PROJECTS_ARCHIVE, async (_e, id: string) => {
    await archiveProject(id)
    return projectsState()
  })

  // 周期性把 status + run stats 推到 renderer
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const s = await getStatus()
      mainWindow.webContents.send(IPC.STATUS_UPDATE, s)
    } catch {
      // 浏览器可能正在 navigate
    }
    try {
      const r = await getRunStats()
      mainWindow.webContents.send(IPC.RUN_STATS_UPDATE, r)
    } catch {
      // ignore
    }
  }, 1500)
}

app.whenReady().then(() => {
  createMainWindow()
  loadDotEnvs()
  registerIpc()
  log.info('Electron 主进程就绪')
  // BSA_AUTO=1 时主进程就绪后自动启动 Chromium,方便我自测
  if (process.env.BSA_AUTO === '1') {
    log.info('[autostart]BSA_AUTO=1,2s 后自动启动 Chromium')
    setTimeout(async () => {
      try {
        await launchBrowser()
        // 等 BOSS 加载,然后 dump 状态
        // 轮询:等登录 + 搜索页有候选人卡片(用户需先在搜索框输词搜一次),再启动 runner
        let waited = 0
        let searchTried = false
        const keyword = process.env.BSA_KEYWORD || '短视频运营'
        const timer = setInterval(async () => {
          waited += 3
          const s = await getStatus()
          log.info(
            `[autostart]等待中(${waited}s):loggedIn=${s.loggedIn} cards=${s.cardCount} url=${s.url}`
          )
          // 登录后若搜索页无卡,自动搜词一次
          if (s.loggedIn && s.cardCount === 0 && !searchTried && waited >= 6) {
            searchTried = true
            log.info(`[autostart]搜索页无卡,自动搜词:${keyword}`)
            await autoSearch(keyword).catch(() => {})
          }
          if (process.env.BSA_AUTO_RUN === '1' && s.loggedIn && s.cardCount > 0) {
            clearInterval(timer)
            log.info(`[autostart]列表有 ${s.cardCount} 张卡,启动 runner`)
            startRun()
          } else if (waited >= 600) {
            clearInterval(timer)
            log.warn('[autostart]10 分钟没等到候选人卡片,放弃(请手动点开始)')
          }
        }, 3000)
      } catch (e) {
        log.error(`autostart launchBrowser 失败:${(e as Error).message}`)
      }
    }, 2000)
  }
})

app.on('window-all-closed', async () => {
  await closeBrowser()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})
