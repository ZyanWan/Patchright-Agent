// 判定标准编辑面板:对应 criteria.yaml 的 6 个 section
// 改完任何字段都本地更新,点"保存"才覆写 yaml(保存前自动备份)
import { useEffect, useState } from 'react'
import type { CriteriaData } from '../../shared/ipc'
import { ChipsInput } from './ChipsInput'

type Props = {
  initial: CriteriaData
  onSave: (data: CriteriaData) => Promise<CriteriaData>
}

export function Criteria({ initial, onSave }: Props) {
  const [c, setC] = useState<CriteriaData>(initial)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setC(initial)
    setDirty(false)
  }, [initial])

  function patch<K extends keyof CriteriaData>(section: K, p: Partial<CriteriaData[K]>) {
    setC((prev) => ({ ...prev, [section]: { ...prev[section], ...p } }))
    setDirty(true)
  }

  async function save() {
    setBusy(true)
    try {
      const next = await onSave(c)
      setC(next)
      setDirty(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="criteria">
      <div className="filters-head" onClick={() => setOpen((x) => !x)}>
        <span>{open ? '▾' : '▸'} 判定标准 (criteria.yaml)</span>
        <span className="filters-summary">
          二选一判定(拿不准就过) · 硬过滤年龄≤{c.hard.age_max} · 经验{' '}
          {c.hard.exp_years_min}-{c.hard.exp_years_max} 年
        </span>
        <span className="spacer" />
        {dirty && <span className="warn-text">未保存</span>}
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={(e) => {
            e.stopPropagation()
            save()
          }}
        >
          保存到 yaml
        </button>
      </div>
      {open && (
        <div className="criteria-body">
          {/* hard */}
          <div className="sec">
            <div className="sec-title">硬规则 (不满足直接刷,不送 LLM)</div>
            <div className="sec-grid">
              <Field label="允许学历">
                <ChipsInput
                  value={c.hard.edu_levels_allowed}
                  onChange={(v) => patch('hard', { edu_levels_allowed: v })}
                  placeholder="本科 / 硕士"
                />
              </Field>
              <Field label="年龄上限">
                <input
                  type="number"
                  value={c.hard.age_max}
                  onChange={(e) =>
                    patch('hard', { age_max: parseInt(e.target.value || '35', 10) })
                  }
                />
              </Field>
              <Field label="经验下限(年)">
                <input
                  type="number"
                  value={c.hard.exp_years_min}
                  onChange={(e) =>
                    patch('hard', { exp_years_min: parseInt(e.target.value || '0', 10) })
                  }
                />
              </Field>
              <Field label="经验上限(年)">
                <input
                  type="number"
                  value={c.hard.exp_years_max}
                  onChange={(e) =>
                    patch('hard', { exp_years_max: parseInt(e.target.value || '4', 10) })
                  }
                />
              </Field>
              <Field label="允许城市">
                <ChipsInput
                  value={c.hard.city_in}
                  onChange={(v) => patch('hard', { city_in: v })}
                  placeholder="北京"
                />
              </Field>
              <Field label="必须 985 或 211">
                <Toggle
                  value={c.hard.require_985_or_211}
                  onChange={(v) => patch('hard', { require_985_or_211: v })}
                />
              </Field>
              <Field label="禁止海外学历">
                <Toggle
                  value={c.hard.forbid_overseas_edu}
                  onChange={(v) => patch('hard', { forbid_overseas_edu: v })}
                />
              </Field>
              <Field label="禁止标签">
                <ChipsInput
                  value={c.hard.forbid_tags}
                  onChange={(v) => patch('hard', { forbid_tags: v })}
                  placeholder="行政 / HR助理"
                />
              </Field>
              <Field label="禁止公司(仅当前在职)" span={2}>
                <ChipsInput
                  value={c.hard.forbid_companies_current_only}
                  onChange={(v) => patch('hard', { forbid_companies_current_only: v })}
                  placeholder="字节跳动 / 美团"
                />
              </Field>
              <Field label="禁止公司类型" span={2}>
                <ChipsInput
                  value={c.hard.forbid_company_types}
                  onChange={(v) => patch('hard', { forbid_company_types: v })}
                  placeholder="国企/央企"
                />
              </Field>
            </div>
          </div>

          {/* education_preference */}
          <div className="sec">
            <div className="sec-title">教育偏好 (送 LLM 综合判断)</div>
            <div className="sec-grid">
              <Field label="偏好 985">
                <Toggle
                  value={c.education_preference.prefer_985}
                  onChange={(v) => patch('education_preference', { prefer_985: v })}
                />
              </Field>
              <Field label="偏好 211">
                <Toggle
                  value={c.education_preference.prefer_211}
                  onChange={(v) => patch('education_preference', { prefer_211: v })}
                />
              </Field>
              <Field label="偏好 QS500">
                <Toggle
                  value={c.education_preference.prefer_qs500}
                  onChange={(v) => patch('education_preference', { prefer_qs500: v })}
                />
              </Field>
              <Field label="偏好海外">
                <Toggle
                  value={c.education_preference.prefer_overseas}
                  onChange={(v) => patch('education_preference', { prefer_overseas: v })}
                />
              </Field>
              <Field label="偏好专业" span={2}>
                <ChipsInput
                  value={c.education_preference.prefer_majors}
                  onChange={(v) => patch('education_preference', { prefer_majors: v })}
                  placeholder="新闻传播 / 计算机"
                />
              </Field>
              <Field label="避免专业" span={2}>
                <ChipsInput
                  value={c.education_preference.avoid_majors}
                  onChange={(v) => patch('education_preference', { avoid_majors: v })}
                />
              </Field>
              <Field label="备注" span={4}>
                <textarea
                  value={c.education_preference.notes}
                  rows={2}
                  onChange={(e) => patch('education_preference', { notes: e.target.value })}
                />
              </Field>
            </div>
          </div>

          {/* company_preference */}
          <div className="sec">
            <div className="sec-title">公司偏好</div>
            <div className="sec-grid">
              <Field label="是否要求大厂">
                <Toggle
                  value={c.company_preference.big_company_required}
                  onChange={(v) => patch('company_preference', { big_company_required: v })}
                />
              </Field>
              <Field label="偏好公司类型" span={3}>
                <ChipsInput
                  value={c.company_preference.preferred_company_types}
                  onChange={(v) => patch('company_preference', { preferred_company_types: v })}
                  placeholder="自媒体/MCN / 教育 / 内容电商"
                />
              </Field>
              <Field label="偏好行业" span={4}>
                <ChipsInput
                  value={c.company_preference.preferred_industries}
                  onChange={(v) => patch('company_preference', { preferred_industries: v })}
                  placeholder="自媒体 / MCN / 教育"
                />
              </Field>
              <Field label="备注" span={4}>
                <textarea
                  value={c.company_preference.notes}
                  rows={2}
                  onChange={(e) => patch('company_preference', { notes: e.target.value })}
                />
              </Field>
            </div>
          </div>

          {/* job_content_preference */}
          <div className="sec">
            <div className="sec-title">工作内容偏好 (核心维度)</div>
            <div className="sec-grid">
              <Field label="岗位画像" span={4}>
                <textarea
                  value={c.job_content_preference.role_summary}
                  rows={2}
                  onChange={(e) =>
                    patch('job_content_preference', { role_summary: e.target.value })
                  }
                  placeholder="短视频内容操盘(自己出脚本、拍、剪),抖音+小红书"
                />
              </Field>
              <Field label="判断规则 (逐条)" span={4}>
                <ChipsInput
                  value={c.job_content_preference.evaluation_rules}
                  onChange={(v) => patch('job_content_preference', { evaluation_rules: v })}
                  placeholder="一条规则一行 chip"
                />
              </Field>
              <Field label="必须满足 (must_be)" span={2}>
                <ChipsInput
                  value={c.job_content_preference.must_be}
                  onChange={(v) => patch('job_content_preference', { must_be: v })}
                />
              </Field>
              <Field label="不允许 (must_not_be)" span={2}>
                <ChipsInput
                  value={c.job_content_preference.must_not_be}
                  onChange={(v) => patch('job_content_preference', { must_not_be: v })}
                />
              </Field>
              <Field label="强加分 (strong_plus)" span={2}>
                <ChipsInput
                  value={c.job_content_preference.strong_plus}
                  onChange={(v) => patch('job_content_preference', { strong_plus: v })}
                />
              </Field>
              <Field label="扣分 (minus)" span={2}>
                <ChipsInput
                  value={c.job_content_preference.minus}
                  onChange={(v) => patch('job_content_preference', { minus: v })}
                />
              </Field>
              <Field label="备注" span={4}>
                <textarea
                  value={c.job_content_preference.notes}
                  rows={2}
                  onChange={(e) => patch('job_content_preference', { notes: e.target.value })}
                />
              </Field>
            </div>
          </div>

          {/* talent_analyzer_preference */}
          <div className="sec">
            <div className="sec-title">牛人分析器 (VIP)</div>
            <div className="sec-grid">
              <Field label="偏好公司规模(null=不限)" span={2}>
                <input
                  type="text"
                  value={c.talent_analyzer_preference.preferred_company_size || ''}
                  onChange={(e) =>
                    patch('talent_analyzer_preference', {
                      preferred_company_size: e.target.value || null
                    })
                  }
                />
              </Field>
              <Field label="要求强求职意向">
                <Toggle
                  value={c.talent_analyzer_preference.require_strong_intent}
                  onChange={(v) =>
                    patch('talent_analyzer_preference', { require_strong_intent: v })
                  }
                />
              </Field>
              <Field label="备注" span={4}>
                <textarea
                  value={c.talent_analyzer_preference.notes}
                  rows={2}
                  onChange={(e) =>
                    patch('talent_analyzer_preference', { notes: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>

          {/* decision */}
          <div className="sec">
            <div className="sec-title">综合决策</div>
            <div className="sec-grid">
              <Field label="判定方式" span={4}>
                <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.6 }}>
                  详情判定为二选一(收藏 / 不要):拿不准、信息不全的一律放过,交人工复核。
                  业绩达标线在上面「岗位内容偏好」里配置;不再用"通过分数线 / 不确定区间"做硬阈值。
                </div>
              </Field>
              <Field label="倾向">
                <select
                  value={c.decision.bias}
                  onChange={(e) => patch('decision', { bias: e.target.value })}
                >
                  <option value="strict">严格</option>
                  <option value="balanced">平衡</option>
                  <option value="loose">宽松</option>
                </select>
              </Field>
              <Field label="通过动作">
                <input
                  type="text"
                  value={c.decision.action_on_pass}
                  onChange={(e) => patch('decision', { action_on_pass: e.target.value })}
                />
              </Field>
              <Field label="未通过动作">
                <input
                  type="text"
                  value={c.decision.action_on_fail}
                  onChange={(e) => patch('decision', { action_on_fail: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  children,
  span = 1
}: {
  label: string
  children: React.ReactNode
  span?: number
}) {
  return (
    <div className="cfld" style={{ gridColumn: `span ${span}` }}>
      <div className="lbl">{label}</div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{value ? '是' : '否'}</span>
    </label>
  )
}
