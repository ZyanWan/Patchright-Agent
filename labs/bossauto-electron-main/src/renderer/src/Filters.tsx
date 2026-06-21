// 筛选条件面板,跟 BOSS 实际可选项一致:
// 学历:可多选 chip(等级:初中~博士),也可切换"按上下限"用滑块
// 院校:多选 chip + 只看第一学历
// 经验:多选 chip
// 年龄:双数字+滑块上下限(18~60)
// 性别/活跃度/跳槽频率/求职状态/薪资:辅助项
import { useEffect, useState } from 'react'
import {
  BOSS_ACTIVENESS_OPTIONS,
  BOSS_DEGREE_LEVELS,
  BOSS_EXPERIENCE_OPTIONS,
  BOSS_GENDER_OPTIONS,
  BOSS_JOB_HOP_OPTIONS,
  BOSS_JOB_STATUS_OPTIONS,
  BOSS_SCHOOL_OPTIONS,
  type FilterSettings
} from '../../shared/ipc'

type Props = {
  title: string
  initial: FilterSettings
  onPatch: (patch: Partial<FilterSettings>) => Promise<FilterSettings>
  onApply: () => Promise<void>
}

function toggleInArray(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export function Filters({ title, initial, onPatch, onApply }: Props) {
  const [f, setF] = useState<FilterSettings>(initial)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setF(initial)
  }, [initial])

  async function patch(p: Partial<FilterSettings>) {
    const next = await onPatch(p)
    setF(next)
  }

  function chip(active: boolean, label: string, onClick: () => void) {
    return (
      <button
        key={label}
        type="button"
        className={`chip ${active ? 'on' : ''}`}
        onClick={onClick}
      >
        {label}
      </button>
    )
  }

  const degreeSummary = f.useDegreeRange
    ? `${BOSS_DEGREE_LEVELS[f.degreeMin - 1]}~${BOSS_DEGREE_LEVELS[f.degreeMax - 1]}`
    : f.degrees.join('/') || '不限'

  return (
    <div className="filters">
      <div className="filters-head" onClick={() => setOpen((x) => !x)}>
        <span>{open ? '▾' : '▸'} {title}</span>
        <span className="filters-summary">
          学历 {degreeSummary} · 院校 {f.schools.join('/') || '不限'} · 经验{' '}
          {f.experiences.join('/') || '不限'} · 年龄 {f.ageMin}-{f.ageMax}
          {f.gender !== '不限' && ` · 性别 ${f.gender}`}
        </span>
        <span className="spacer" />
        <button
          type="button"
          disabled={busy}
          onClick={async (e) => {
            e.stopPropagation()
            setBusy(true)
            try {
              await onApply()
            } finally {
              setBusy(false)
            }
          }}
        >
          应用到 BOSS
        </button>
      </div>
      {open && (
        <div className="filters-body">
          {/* 学历:多选 chip + 切换"按上下限滑块"模式 */}
          <div className="fld" style={{ gridColumn: 'span 2' }}>
            <div className="lbl">
              学历要求 (多选)
              <label className="toggle-inline" style={{ marginLeft: 12 }}>
                <input
                  type="checkbox"
                  checked={f.useDegreeRange}
                  onChange={(e) => patch({ useDegreeRange: e.target.checked })}
                />
                按上下限范围
              </label>
            </div>
            {!f.useDegreeRange ? (
              <div className="chips">
                {chip(f.degrees.length === 0, '不限', () => patch({ degrees: [] }))}
                {BOSS_DEGREE_LEVELS.map((o) =>
                  chip(f.degrees.includes(o), o, () =>
                    patch({ degrees: toggleInArray(f.degrees, o) })
                  )
                )}
              </div>
            ) : (
              <div className="slider-row">
                <span style={{ minWidth: 70 }}>
                  {BOSS_DEGREE_LEVELS[f.degreeMin - 1]}
                </span>
                <input
                  type="range"
                  min={1}
                  max={7}
                  value={f.degreeMin}
                  onChange={(e) => {
                    const v = Math.min(parseInt(e.target.value, 10), f.degreeMax)
                    patch({ degreeMin: v })
                  }}
                />
                <input
                  type="range"
                  min={1}
                  max={7}
                  value={f.degreeMax}
                  onChange={(e) => {
                    const v = Math.max(parseInt(e.target.value, 10), f.degreeMin)
                    patch({ degreeMax: v })
                  }}
                />
                <span style={{ minWidth: 70 }}>
                  {BOSS_DEGREE_LEVELS[f.degreeMax - 1]}
                </span>
              </div>
            )}
          </div>

          {/* 院校:多选 */}
          <div className="fld">
            <div className="lbl">院校要求 (多选)</div>
            <div className="chips">
              {chip(f.schools.length === 0, '不限', () => patch({ schools: [] }))}
              {BOSS_SCHOOL_OPTIONS.map((o) =>
                chip(f.schools.includes(o), o, () =>
                  patch({ schools: toggleInArray(f.schools, o) })
                )
              )}
            </div>
            <label className="toggle-inline">
              <input
                type="checkbox"
                checked={f.onlyFirstDegree}
                onChange={(e) => patch({ onlyFirstDegree: e.target.checked })}
              />
              只看第一学历(全日制本科)
            </label>
          </div>

          {/* 经验:多选 */}
          <div className="fld">
            <div className="lbl">工作经验 (多选)</div>
            <div className="chips">
              {chip(f.experiences.length === 0, '不限', () => patch({ experiences: [] }))}
              {BOSS_EXPERIENCE_OPTIONS.map((o) =>
                chip(f.experiences.includes(o), o, () =>
                  patch({ experiences: toggleInArray(f.experiences, o) })
                )
              )}
            </div>
          </div>

          {/* 年龄:上下限滑块 */}
          <div className="fld">
            <div className="lbl">
              年龄 {f.ageMin}-{f.ageMax}
            </div>
            <div className="slider-row">
              <input
                type="range"
                min={18}
                max={60}
                value={f.ageMin}
                onChange={(e) => {
                  const v = Math.min(parseInt(e.target.value, 10), f.ageMax)
                  patch({ ageMin: v })
                }}
              />
              <input
                type="range"
                min={18}
                max={60}
                value={f.ageMax}
                onChange={(e) => {
                  const v = Math.max(parseInt(e.target.value, 10), f.ageMin)
                  patch({ ageMax: v })
                }}
              />
              <input
                type="number"
                min={18}
                max={60}
                value={f.ageMin}
                onChange={(e) => patch({ ageMin: parseInt(e.target.value || '18', 10) })}
              />
              <span>-</span>
              <input
                type="number"
                min={18}
                max={60}
                value={f.ageMax}
                onChange={(e) => patch({ ageMax: parseInt(e.target.value || '60', 10) })}
              />
            </div>
          </div>

          {/* 性别 */}
          <div className="fld">
            <div className="lbl">性别</div>
            <select value={f.gender} onChange={(e) => patch({ gender: e.target.value })}>
              {BOSS_GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* 目标城市(仅搜索页生效) */}
          <div className="fld">
            <div className="lbl">目标城市(搜索页生效)</div>
            <input
              type="text"
              value={f.city ?? ''}
              placeholder="如:北京"
              onChange={(e) => patch({ city: e.target.value })}
            />
          </div>

          {/* 薪资 */}
          <div className="fld">
            <div className="lbl">
              薪资区间{' '}
              {f.salaryMinK === 0 && f.salaryMaxK === 0
                ? '不限'
                : `${f.salaryMinK}-${f.salaryMaxK}K`}
            </div>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                value={f.salaryMinK}
                onChange={(e) => {
                  const v = Math.min(parseInt(e.target.value, 10), f.salaryMaxK || 100)
                  patch({ salaryMinK: v })
                }}
              />
              <input
                type="range"
                min={0}
                max={100}
                value={f.salaryMaxK}
                onChange={(e) => {
                  const v = Math.max(parseInt(e.target.value, 10), f.salaryMinK)
                  patch({ salaryMaxK: v })
                }}
              />
              <input
                type="number"
                value={f.salaryMinK}
                onChange={(e) => patch({ salaryMinK: parseInt(e.target.value || '0', 10) })}
              />
              <span>-</span>
              <input
                type="number"
                value={f.salaryMaxK}
                onChange={(e) => patch({ salaryMaxK: parseInt(e.target.value || '0', 10) })}
              />
            </div>
          </div>

          {/* 牛人活跃度 */}
          <div className="fld">
            <div className="lbl">牛人活跃度</div>
            <select
              value={f.activeness}
              onChange={(e) => patch({ activeness: e.target.value })}
            >
              {BOSS_ACTIVENESS_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* 跳槽频率 */}
          <div className="fld">
            <div className="lbl">跳槽频率</div>
            <select
              value={f.jobHopFrequency}
              onChange={(e) => patch({ jobHopFrequency: e.target.value })}
            >
              {BOSS_JOB_HOP_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* 求职状态:多选 */}
          <div className="fld" style={{ gridColumn: 'span 2' }}>
            <div className="lbl">求职状态 (多选)</div>
            <div className="chips">
              {chip(f.jobStatuses.length === 0, '不限', () => patch({ jobStatuses: [] }))}
              {BOSS_JOB_STATUS_OPTIONS.map((o) =>
                chip(f.jobStatuses.includes(o), o, () =>
                  patch({ jobStatuses: toggleInArray(f.jobStatuses, o) })
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
