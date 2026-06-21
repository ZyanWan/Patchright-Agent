// 助手对话面板:每跑完一屏 assistant 主动汇总,用户可追问/反馈
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChatMessage } from '../../shared/ipc'

export function Chat() {
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.bsa.chatHistory().then(setMsgs)
    const off = window.bsa.onChatAppend((m) => setMsgs((xs) => [...xs, m]))
    return off
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length])

  async function send() {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    try {
      await window.bsa.chatSend(t)
    } finally {
      setBusy(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function clearChat() {
    if (!confirm('清空对话?')) return
    const next = await window.bsa.chatClear()
    setMsgs(next)
  }

  return (
    <div className="chat">
      <div className="panel-title">
        助手对话
        <button type="button" className="link-btn" onClick={clearChat}>
          清空
        </button>
      </div>
      <div className="chat-msgs" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="chat-empty">
            还没有对话。<br />
            点"开始"跑一批后,助手会主动汇总结果,问你要不要调规则。<br />
            你也可以直接在下面提问。
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-meta">
              {m.role === 'user' ? '我' : m.role === 'assistant' ? '助手' : '系统'} ·{' '}
              {new Date(m.ts).toLocaleTimeString()}
              {m.meta?.kind === 'batch_summary' && m.meta.batchNo && (
                <span className="badge">第 {m.meta.batchNo} 批</span>
              )}
            </div>
            <div className="chat-body">{m.content}</div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={busy ? '助手思考中…' : '输入意见(Enter 发送,Shift+Enter 换行)'}
          rows={2}
          disabled={busy}
        />
        <button type="button" disabled={busy || !text.trim()} onClick={send}>
          发送
        </button>
      </div>
    </div>
  )
}
