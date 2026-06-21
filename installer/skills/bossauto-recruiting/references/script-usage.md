# Script Usage

Use this reference after `SKILL.md` identifies which script fits the task. Do not load it just to decide the task mode.

Resolve `<skill-dir>` to the folder containing `SKILL.md`. Run commands from the target workspace, or pass absolute workspace paths for output, profile, and record files. Treat URLs below as examples; prefer the current approved BOSS page or target source.

## Read-Only And Evidence Scripts

Open a visible recruiting page and keep the browser available for manual login or inspection:

```bash
python <skill-dir>/scripts/open_recruiting_page.py --profile runtime/profiles/bossauto-profile --url https://www.zhipin.com/web/chat/recommend
```

Inspect the current BOSS page and save diagnostics:

```bash
python <skill-dir>/scripts/boss_probe.py --profile runtime/profiles/bossauto-profile --json runtime/artifacts/bossauto/probe.json --screenshot runtime/artifacts/bossauto/probe.png
```

Diagnose login/loading/network symptoms without clicking recruiting actions:

```bash
python <skill-dir>/scripts/diagnose_login.py --profile runtime/profiles/bossauto-profile --url https://www.zhipin.com/web/chat/recommend --json runtime/artifacts/bossauto/login-diagnostics.json --screenshot runtime/artifacts/bossauto/login-diagnostics.png
```

When a site works in the user's installed browser but not in the default runtime browser, retry diagnostics with an explicit browser supplied by the current environment:

```bash
python <skill-dir>/scripts/diagnose_login.py --profile runtime/profiles/bossauto-profile --url https://www.zhipin.com/web/chat/recommend --executable "<chrome-or-edge-executable>"
```

Scan visible candidate cards and save structured JSON:

```bash
python <skill-dir>/scripts/scan_candidates.py --profile runtime/profiles/bossauto-profile --json runtime/artifacts/bossauto/candidates.json
```

Apply deterministic local criteria to scanned candidates without touching the website:

```bash
python <skill-dir>/scripts/dry_run_screening.py --candidates runtime/artifacts/bossauto/candidates.json --criteria runtime/artifacts/bossauto/criteria.json --json runtime/artifacts/bossauto/dry-run-decisions.json
```

Extract detail evidence for one visible candidate and save text, screenshot, frame, and canvas diagnostics:

```bash
python <skill-dir>/scripts/extract_detail.py --profile runtime/profiles/bossauto-profile --stable-id "<candidate-stable-id>" --candidate-name "<visible-name>" --out-dir runtime/artifacts/bossauto/detail-evidence
```

## Filter Scripts

Inspect BOSS page filters against a criteria file. This is read-only unless `--apply` is supplied. Use read-only inspection first to capture the page's exact filter labels and option text:

```bash
python <skill-dir>/scripts/sync_filters.py --profile runtime/profiles/bossauto-profile --criteria runtime/artifacts/bossauto/criteria.json --json runtime/artifacts/bossauto/filter-state.json
```

Criteria filter targets should use exact page text, not business synonyms:

```json
{
  "filters": {
    "recommend": {
      "<filter-label>": ["<exact-option>"]
    }
  }
}
```

Before using `--apply`, verify that the user explicitly approved filter changes for the current page and that the script supports the page type. `--apply` is refused unless the active page is a BOSS recruiting page. For recommendation pages, applying filters must find and click the confirm control, verify the filter panel is closed, then re-inspect the after-state:

```bash
python <skill-dir>/scripts/sync_filters.py --profile runtime/profiles/bossauto-profile --criteria runtime/artifacts/bossauto/criteria.json --json runtime/artifacts/bossauto/filter-state.json --apply
```

If the output reports a missing confirm control or an unclosed filter panel, stop downstream candidate scanning or detail reads until the page state is resolved.

## Controlled Action Scripts

Favorite one explicitly approved candidate. It defaults to dry-run; use `--apply` only after the current user prompt has approved the exact target/action:

```bash
python <skill-dir>/scripts/favorite_candidate.py --profile runtime/profiles/bossauto-profile --stable-id "<candidate-stable-id>" --candidate-name "<visible-name>" --json runtime/artifacts/bossauto/favorite-result.json
```

After user confirmation, apply the approved favorite action with audit paths:

```bash
python <skill-dir>/scripts/favorite_candidate.py --profile runtime/profiles/bossauto-profile --stable-id "<candidate-stable-id>" --candidate-name "<visible-name>" --apply --authorization "user approved favorite for this candidate" --json runtime/artifacts/bossauto/favorite-result.json --action-log runtime/artifacts/bossauto/action-log.jsonl --decisions runtime/artifacts/bossauto/decisions.json
```

Batch-initiate contact for an approved shortlist by clicking only candidate-scoped `沟通` / `打招呼` / `立即沟通` buttons. This is the preferred contact-initiation path for multiple saved, recommended, searched, or shortlisted candidates. It defaults to dry-run planning:

```bash
python <skill-dir>/scripts/batch_contact_candidates.py --profile runtime/profiles/bossauto-profile --url "<current-approved-source-url>" --candidates runtime/artifacts/bossauto/candidates.json --json runtime/artifacts/bossauto/batch-contact/summary.json
```

After user confirmation, apply the approved batch scope. The authorization text should describe the current approval:

```bash
python <skill-dir>/scripts/batch_contact_candidates.py --profile runtime/profiles/bossauto-profile --url "<current-approved-source-url>" --candidates runtime/artifacts/bossauto/candidates.json --apply --authorization "user approved contact_init for the current approved shortlist" --json runtime/artifacts/bossauto/batch-contact/summary.json
```

For an explicitly approved shortlist file, use `--targets-json` instead of `--candidates`:

```bash
python <skill-dir>/scripts/batch_contact_candidates.py --profile runtime/profiles/bossauto-profile --url "<current-approved-source-url>" --targets-json runtime/artifacts/bossauto/approved-targets.json --apply --authorization "user approved contact_init for the explicit target list"
```

Initiate contact with one explicitly approved candidate. Use this for a test, retry, or one-off review target. It defaults to dry-run; use `--apply` only after the current user prompt has approved the exact target/action:

```bash
python <skill-dir>/scripts/contact_candidate.py --profile runtime/profiles/bossauto-profile --stable-id "<candidate-stable-id>" --candidate-name "<visible-name>" --json runtime/artifacts/bossauto/contact-result.json
```

After user confirmation, apply the approved contact initiation with audit paths:

```bash
python <skill-dir>/scripts/contact_candidate.py --profile runtime/profiles/bossauto-profile --stable-id "<candidate-stable-id>" --candidate-name "<visible-name>" --apply --authorization "user approved contact_init for this candidate" --json runtime/artifacts/bossauto/contact-result.json --action-log runtime/artifacts/bossauto/action-log.jsonl --decisions runtime/artifacts/bossauto/decisions.json
```

Contact-initiation scripts do not type, edit, or manually click `发送`. BOSS may automatically send the recruiter's preconfigured greeting after the approved contact button is clicked; record that as `contact_init`, not `send_message`.

## Local Record Scripts

Record a human or agent-reviewed decision without touching the website:

```bash
python <skill-dir>/scripts/record_decision.py --key "candidate-key" --decision review --reason "needs manual verification" --records runtime/artifacts/bossauto/decisions.json
```

Record an approved website-changing action after it has been performed or skipped. This script only writes a local log; it does not click the website and does not grant permission to act:

```bash
python <skill-dir>/scripts/record_action_log.py --key "candidate-key" --action favorite --status performed --reason "approved by user after review" --log runtime/artifacts/bossauto/action-log.jsonl
```
