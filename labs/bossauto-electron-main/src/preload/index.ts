import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type BrowserStatus,
  type ChatMessage,
  type CriteriaData,
  type FilterSection,
  type FilterSettings,
  type LogEntry,
  type ProbeResult,
  type ProjectFilters,
  type ProjectsState,
  type RunSettings,
  type RunStats
} from '../shared/ipc'

const api = {
  launchBrowser: (): Promise<BrowserStatus> => ipcRenderer.invoke(IPC.BROWSER_LAUNCH),
  closeBrowser: (): Promise<void> => ipcRenderer.invoke(IPC.BROWSER_CLOSE),
  getStatus: (): Promise<BrowserStatus> => ipcRenderer.invoke(IPC.BROWSER_STATUS),
  probeDomRead: (): Promise<ProbeResult> => ipcRenderer.invoke(IPC.PROBE_DOM_READ),
  startRun: (): Promise<RunStats> => ipcRenderer.invoke(IPC.RUN_START),
  pauseRun: (): Promise<RunStats> => ipcRenderer.invoke(IPC.RUN_PAUSE),
  stopRun: (): Promise<RunStats> => ipcRenderer.invoke(IPC.RUN_STOP),
  getRunStats: (): Promise<RunStats> => ipcRenderer.invoke(IPC.RUN_STATS),
  getSettings: (): Promise<RunSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: Partial<RunSettings>): Promise<RunSettings> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  getFilters: (): Promise<ProjectFilters> => ipcRenderer.invoke(IPC.FILTERS_GET),
  setFilters: (section: FilterSection, patch: Partial<FilterSettings>): Promise<ProjectFilters> =>
    ipcRenderer.invoke(IPC.FILTERS_SET, section, patch),
  setSearchKeywords: (kws: string[]): Promise<ProjectFilters> =>
    ipcRenderer.invoke(IPC.FILTERS_KEYWORD, kws),
  applyFilters: (section: FilterSection): Promise<{ ok: boolean; desc: string }> =>
    ipcRenderer.invoke(IPC.FILTERS_APPLY, section),
  getCriteria: (): Promise<CriteriaData> => ipcRenderer.invoke(IPC.CRITERIA_GET),
  setCriteria: (data: CriteriaData): Promise<CriteriaData> =>
    ipcRenderer.invoke(IPC.CRITERIA_SET, data),
  getCriteriaRaw: (): Promise<string> => ipcRenderer.invoke(IPC.CRITERIA_RAW),
  probeBossFilters: (): Promise<{ savedTo: string; url: string }> =>
    ipcRenderer.invoke(IPC.BOSS_FILTER_PROBE),
  syncChromeLogin: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.CHROME_SYNC_LOGIN),
  listProjects: (): Promise<ProjectsState> => ipcRenderer.invoke(IPC.PROJECTS_LIST),
  setActiveProject: (id: string): Promise<ProjectsState> =>
    ipcRenderer.invoke(IPC.PROJECTS_SET_ACTIVE, id),
  createProject: (name: string): Promise<ProjectsState> =>
    ipcRenderer.invoke(IPC.PROJECTS_CREATE, name),
  duplicateProject: (srcId: string, name: string): Promise<ProjectsState> =>
    ipcRenderer.invoke(IPC.PROJECTS_DUPLICATE, srcId, name),
  renameProject: (id: string, name: string): Promise<ProjectsState> =>
    ipcRenderer.invoke(IPC.PROJECTS_RENAME, id, name),
  archiveProject: (id: string): Promise<ProjectsState> =>
    ipcRenderer.invoke(IPC.PROJECTS_ARCHIVE, id),
  chatHistory: (): Promise<ChatMessage[]> => ipcRenderer.invoke(IPC.CHAT_HISTORY),
  chatSend: (text: string): Promise<ChatMessage> => ipcRenderer.invoke(IPC.CHAT_SEND, text),
  chatClear: (): Promise<ChatMessage[]> => ipcRenderer.invoke(IPC.CHAT_CLEAR),
  onChatAppend: (cb: (msg: ChatMessage) => void) => {
    const listener = (_: unknown, msg: ChatMessage) => cb(msg)
    ipcRenderer.on(IPC.CHAT_APPEND, listener)
    return () => ipcRenderer.off(IPC.CHAT_APPEND, listener)
  },
  onLog: (cb: (entry: LogEntry) => void) => {
    const listener = (_: unknown, entry: LogEntry) => cb(entry)
    ipcRenderer.on(IPC.LOG_APPEND, listener)
    return () => ipcRenderer.off(IPC.LOG_APPEND, listener)
  },
  onStatus: (cb: (status: BrowserStatus) => void) => {
    const listener = (_: unknown, status: BrowserStatus) => cb(status)
    ipcRenderer.on(IPC.STATUS_UPDATE, listener)
    return () => ipcRenderer.off(IPC.STATUS_UPDATE, listener)
  },
  onRunStats: (cb: (stats: RunStats) => void) => {
    const listener = (_: unknown, stats: RunStats) => cb(stats)
    ipcRenderer.on(IPC.RUN_STATS_UPDATE, listener)
    return () => ipcRenderer.off(IPC.RUN_STATS_UPDATE, listener)
  }
}

contextBridge.exposeInMainWorld('bsa', api)

export type BsaApi = typeof api
