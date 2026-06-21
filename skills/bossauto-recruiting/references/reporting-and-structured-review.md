# Reporting And Structured Review

Use this reference only when the user asks to aggregate BOSS recruiting data, generate a report or table, batch-screen candidates, or evaluate candidates against a JD or recruiter-provided requirements. Do not run this workflow by default for ordinary page inspection, login troubleshooting, filter checks, or one-candidate evidence capture.

## Inputs

Use only these input sources:

- **BOSS evidence captured by automation**: candidate-card JSON, detail text, screenshots, page URL, frame/page type, stable candidate identifiers, collection time, and artifact paths.
- **Recruiter input**: JD, role requirements, hard constraints, preferred traits, exclusion rules, target city, salary range, project notes, and the requested output format.

Do not hardcode role-specific fields, companies, schools, skills, paths, or local application choices into the skill. If the user has not provided a requirement, leave the matching field empty or mark it as unknown.

For batch runs, preserve a criteria snapshot with the report so the recruiter can see what was actually used. Criteria snapshots should come from the user prompt, a criteria file, or explicit recruiter notes, not from role-specific defaults inside scripts.

## Activation Rules

Start structured review only for requests such as:

- "汇总这些候选人"
- "生成表格/Excel/报告"
- "按这个 JD 帮我筛一下"
- "批量评估 BOSS 候选人"
- "把扫描结果整理成快筛清单"

For other tasks, continue with the normal inspect, scan, evidence, dry-run, or decision-record workflow.

## Evidence Rules

- Every candidate fact must trace to BOSS card text, BOSS detail text, a BOSS detail screenshot, or a recruiter-provided requirement.
- Treat recruiter-provided JD/requirements as criteria, not as evidence about a candidate.
- If a detail screenshot is available and the current agent can inspect images, use it as visual evidence. If the agent cannot inspect images, run OCR only if an approved OCR path is available; otherwise mark visual-only content for human review.
- Use `unknown`, `null`, or `insufficient_evidence` instead of guessing missing company, title, education, skill, salary, location, or availability information.
- Keep "consider contact" as a recommendation only. Do not click contact, greet, favorite, send, or exchange actions without explicit approval in the current task.

## Structured Output Shape

Use stable internal JSON field names. Localized column names can be added when exporting a spreadsheet.

```json
{
  "run": {
    "project": "user-provided project or role name",
    "source": "boss",
    "mode": "summary | quick_screen | report",
    "criteriaSource": "jd | recruiter_requirements | criteria_file",
    "generatedAt": "ISO-8601 timestamp",
    "notes": []
  },
  "criteriaSnapshot": {
    "roleTitle": null,
    "mustHave": [],
    "niceToHave": [],
    "exclusions": [],
    "unknownPolicy": "insufficient_evidence"
  },
  "candidates": [
    {
      "candidateKey": "stable BOSS id or generated local key",
      "bossSnapshot": {
        "name": null,
        "currentOrRecentCompany": null,
        "currentOrRecentTitle": null,
        "education": null,
        "experience": null,
        "location": null,
        "bossStatus": null,
        "contactedLikely": null
      },
      "evidenceCoverage": {
        "cardText": false,
        "detailText": false,
        "detailScreenshot": false,
        "sourceArtifacts": []
      },
      "fastScreen": {
        "decision": "consider | review | skip | insufficient_evidence",
        "priority": "high | medium | low | unknown",
        "matchedMustHave": [],
        "missingMustHave": [],
        "matchedNiceToHave": [],
        "riskPoints": [],
        "openQuestions": [],
        "recommendedNextStep": "human_review | consider_contact | skip | collect_more_evidence"
      },
      "evidence": [
        {
          "claim": "short fact or judgment supported by evidence",
          "source": "boss_card | boss_detail_text | boss_detail_screenshot | recruiter_criteria",
          "artifact": "path or identifier when available",
          "quoteOrObservation": "exact text when available, otherwise concise visual observation"
        }
      ],
      "reviewFlags": []
    }
  ],
  "summary": {
    "totalCandidates": 0,
    "considerCount": 0,
    "reviewCount": 0,
    "skipCount": 0,
    "insufficientEvidenceCount": 0
  }
}
```

## Fast-Screen Columns

When the user asks for a table or spreadsheet, prefer columns that match HR quick-screening:

- 候选人
- 当前/最近公司
- 当前/最近岗位
- 年限/经验
- 学历
- 地点/期望城市
- BOSS状态/活跃信息
- 是否疑似已沟通
- 快筛结论
- 优先级
- 命中硬性条件
- 缺失或未知硬性条件
- 加分项
- 风险点
- 建议下一步
- 证据来源
- 详情/截图路径
- 人工复核备注

Only include score columns when the user asks for scoring or provides a scoring rubric. If scoring is used, define the scale and keep the raw evidence beside the score.

When a website-changing action was authorized, add action columns rather than mixing action status into the screening decision:

- Approved action
- Action status
- Action timestamp
- Action log reference
- Already done / skipped / failed reason

For spreadsheets, prefer at least two views when the run is large: a shortlist/action sheet and a full inspected-candidate sheet.

## Review Semantics

- `consider`: evidence satisfies the known hard requirements and has useful positive signals.
- `review`: evidence is mixed, incomplete, or requires recruiter judgment.
- `skip`: observable evidence conflicts with hard requirements or exclusion rules.
- `insufficient_evidence`: available BOSS evidence is too thin to support a hiring-screen decision.

Prefer `review` or `insufficient_evidence` when identity matching is uncertain, detail evidence belongs to another candidate, screenshots are unreadable, or required fields are missing.

## Delivery Checks

Before final handoff:

- Verify reported counts match the structured data.
- Verify output files can be parsed or opened by the available toolchain.
- Verify non-ASCII text is saved in a readable encoding.
- Verify sensitive candidate data is stored under workspace-local runtime artifacts or a user-approved project data directory.
- If actions were performed, verify the action log contains only approved action types.
