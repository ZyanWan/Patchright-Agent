import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { IPC, type LogEntry } from '../../shared/ipc'

let target: BrowserWindow | null = null
let logFile: string | null = null

export function getLogFilePath(): string {
  return getLogFile()
}

function getLogFile(): string {
  if (logFile) return logFile
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'runtime.log')
  } catch {
    logFile = ''
  }
  return logFile
}

export function bindLogger(win: BrowserWindow) {
  target = win
}

function emit(level: LogEntry['level'], msg: string) {
  const entry: LogEntry = { ts: Date.now(), level, msg }
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  // 同步写到 userData/runtime.log,方便外部 tail
  const f = getLogFile()
  if (f) {
    try {
      appendFileSync(f, line + '\n', 'utf8')
    } catch {
      // ignore
    }
  }
  if (target && !target.isDestroyed()) {
    target.webContents.send(IPC.LOG_APPEND, entry)
  }
}

export const log = {
  info: (m: string) => emit('info', m),
  warn: (m: string) => emit('warn', m),
  error: (m: string) => emit('error', m),
  debug: (m: string) => emit('debug', m)
}
