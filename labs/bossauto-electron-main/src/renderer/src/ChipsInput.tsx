// 标签输入:已选 chips 横排,后面跟一个输入框,回车 add,点 × 删
import { useState, type KeyboardEvent } from 'react'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

export function ChipsInput({ value, onChange, placeholder }: Props) {
  const [text, setText] = useState('')

  function add() {
    const v = text.trim()
    if (!v) return
    if (value.includes(v)) {
      setText('')
      return
    }
    onChange([...value, v])
    setText('')
  }

  function remove(v: string) {
    onChange(value.filter((x) => x !== v))
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="chips-input">
      {value.map((v) => (
        <span key={v} className="chip on">
          {v}
          <button type="button" className="chip-x" onClick={() => remove(v)}>
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={placeholder || '输入后回车'}
      />
    </div>
  )
}
