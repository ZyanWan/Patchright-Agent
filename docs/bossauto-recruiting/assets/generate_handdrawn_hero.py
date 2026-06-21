from __future__ import annotations

import math
import random
import subprocess
from pathlib import Path


OUT_DIR = Path(__file__).resolve().parent
SVG_PATH = OUT_DIR / "bossauto-handdrawn-hero.svg"
PNG_PATH = OUT_DIR / "bossauto-handdrawn-hero.png"

W = 1600
H = 960
random.seed(42)


def jitter(value: float, amount: float = 1.5) -> float:
    return value + random.uniform(-amount, amount)


def hand_line(x1: float, y1: float, x2: float, y2: float, color: str = "#37322b", width: float = 2.2, dash: str = "") -> str:
    midx = (x1 + x2) / 2 + random.uniform(-8, 8)
    midy = (y1 + y2) / 2 + random.uniform(-5, 5)
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<path d="M {jitter(x1):.1f} {jitter(y1):.1f} Q {midx:.1f} {midy:.1f} {jitter(x2):.1f} {jitter(y2):.1f}" '
        f'fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dash_attr}/>'
    )


def hand_rect(x: float, y: float, w: float, h: float, fill: str = "none", color: str = "#37322b", width: float = 2.2, rx: float = 8, klass: str = "") -> str:
    points = [
        (x + rx, y),
        (x + w - rx, y),
        (x + w, y + rx),
        (x + w, y + h - rx),
        (x + w - rx, y + h),
        (x + rx, y + h),
        (x, y + h - rx),
        (x, y + rx),
    ]
    d = [f"M {jitter(points[0][0]):.1f} {jitter(points[0][1]):.1f}"]
    for px, py in points[1:]:
        d.append(f"L {jitter(px):.1f} {jitter(py):.1f}")
    d.append("Z")
    class_attr = f' class="{klass}"' if klass else ""
    return f'<path{class_attr} d="{" ".join(d)}" fill="{fill}" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>'


def marker_rect(x: float, y: float, w: float, h: float, fill: str, opacity: float = 0.45, rx: float = 4) -> str:
    return hand_rect(x, y, w, h, fill=fill, color=fill, width=1.0, rx=rx, klass=f"marker-{fill.strip('#')}")


def text(x: float, y: float, content: str, size: int = 26, color: str = "#28241f", weight: int = 500, anchor: str = "start", family: str = "hand") -> str:
    fam = "var(--display-font)" if family == "hand" else "var(--mono-font)"
    return (
        f'<text x="{x}" y="{y}" fill="{color}" font-family="{fam}" font-size="{size}" '
        f'font-weight="{weight}" text-anchor="{anchor}" letter-spacing="0">{content}</text>'
    )


def small_label(x: float, y: float, content: str, color: str = "#585045") -> str:
    return text(x, y, content, 18, color, 500, family="mono")


def grid() -> str:
    lines: list[str] = []
    for x in range(0, W + 1, 32):
        lines.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="#d7cbb2" stroke-width="1" opacity="0.42"/>')
    for y in range(0, H + 1, 32):
        lines.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#d7cbb2" stroke-width="1" opacity="0.42"/>')
    for y in range(12, H, 64):
        lines.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="#e3b66f" stroke-width="1.2" opacity="0.18"/>')
    return "\n".join(lines)


def chart(x: float, y: float, w: float, h: float) -> str:
    pts = [
        (x + 18, y + h - 34),
        (x + 88, y + h - 42),
        (x + 164, y + h - 58),
        (x + 246, y + h - 76),
        (x + 326, y + h - 94),
        (x + 410, y + h - 116),
    ]
    d = "M " + " L ".join(f"{px:.1f} {py:.1f}" for px, py in pts)
    dots = "\n".join(f'<circle cx="{px}" cy="{py}" r="4.2" fill="#e45d37"/>' for px, py in pts)
    bars = []
    bx = x + w - 150
    for i, bh in enumerate([78, 128, 102, 156, 88]):
        bars.append(hand_rect(bx + i * 28, y + h - 28 - bh, 18, bh, fill="#d8d2c2", color="#37322b", width=1.4, rx=2))
    return "\n".join(
        [
            hand_rect(x, y, w, h, fill="#fffaf0", color="#37322b", width=2.0, rx=10),
            small_label(x + 22, y + 32, "SCREENING FUNNEL"),
            hand_line(x + 24, y + h - 28, x + w - 24, y + h - 28, "#6f6659", 1.3),
            hand_line(x + 24, y + 46, x + 24, y + h - 28, "#6f6659", 1.3),
            f'<path d="{d}" fill="none" stroke="#e45d37" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
            dots,
            *bars,
        ]
    )


def sticky(x: float, y: float, w: float, h: float, title: str, body: list[str], fill: str = "#fff0ad") -> str:
    lines = [
        hand_rect(x + 6, y + 8, w, h, fill="#000000", color="#000000", width=0, rx=6),
        f'<path d="M {x:.1f} {y:.1f} L {x + w - 14:.1f} {y + 4:.1f} L {x + w:.1f} {y + h - 12:.1f} L {x + 6:.1f} {y + h:.1f} Z" fill="{fill}" stroke="#37322b" stroke-width="2" opacity="0.96"/>',
        text(x + 18, y + 34, title, 21, "#302b25", 700),
    ]
    for i, row in enumerate(body):
        lines.append(small_label(x + 18, y + 64 + i * 24, row, "#4c463d"))
    return "\n".join(lines)


def tab(x: float, y: float, w: float, label: str, active: bool = False) -> str:
    fill = "#f7e7b2" if active else "#f8f1e3"
    return "\n".join(
        [
            hand_rect(x, y, w, 42, fill=fill, color="#37322b", width=1.8, rx=9),
            small_label(x + 20, y + 27, label, "#33302b" if active else "#72685d"),
        ]
    )


def svg() -> str:
    items: list[str] = []
    items.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    items.append(
        """
<defs>
  <style>
    :root {
      --display-font: "Noto Sans SC", "Microsoft YaHei", "SimHei", "Segoe Print", "Comic Sans MS", cursive;
      --mono-font: "Cascadia Mono", "Noto Sans SC", "Microsoft YaHei", Consolas, monospace;
    }
    text { paint-order: stroke; stroke: rgba(255, 250, 240, 0.55); stroke-width: 1.2px; }
  </style>
  <filter id="paperNoise" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="19" result="noise"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer>
      <feFuncA type="table" tableValues="0 0.08"/>
    </feComponentTransfer>
    <feBlend mode="multiply" in2="SourceGraphic"/>
  </filter>
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="5" dy="7" stdDeviation="0.9" flood-color="#3d3428" flood-opacity="0.18"/>
  </filter>
</defs>
"""
    )
    items.append('<rect width="1600" height="960" fill="#f5ecd8"/>')
    items.append(grid())
    items.append('<g filter="url(#paperNoise)">')

    items.append(small_label(76, 74, "BOSSAUTO RECRUITING / LANDING HERO SKETCH", "#6b5d4b"))
    items.append(text(76, 126, "Bossauto Recruiting", 58, "#27231f", 800))
    items.append(text(80, 174, "可审计的 BOSS 招聘自动化工作流", 30, "#53483c", 650))
    items.append(small_label(82, 214, "scan candidates  ·  capture evidence  ·  dry-run decisions  ·  approved actions only"))
    items.append(marker_rect(82, 244, 192, 42, "#f0cb65", 0.5))
    items.append(small_label(104, 271, "read-only first"))
    items.append(marker_rect(300, 244, 210, 42, "#9cc7b0", 0.5))
    items.append(small_label(321, 271, "action log required"))
    items.append(marker_rect(536, 244, 180, 42, "#f0a786", 0.45))
    items.append(small_label(558, 271, "human review"))

    panel_x, panel_y, panel_w, panel_h = 84, 318, 1172, 540
    items.append(f'<g filter="url(#softShadow)">')
    items.append(hand_rect(panel_x, panel_y, panel_w, panel_h, fill="#fffaf0", color="#302b25", width=2.5, rx=14))
    items.append("</g>")
    items.append(hand_line(panel_x + 4, panel_y + 58, panel_x + panel_w - 6, panel_y + 58, "#37322b", 2.0))
    items.append(tab(panel_x + 24, panel_y - 34, 184, "recommend", True))
    items.append(tab(panel_x + 220, panel_y - 34, 144, "search", False))
    items.append(tab(panel_x + 374, panel_y - 34, 168, "favorites", False))
    items.append(tab(panel_x + 556, panel_y - 34, 170, "action log", False))
    items.append(small_label(panel_x + 26, panel_y + 37, "https://www.zhipin.com/web/chat/recommend"))
    items.append(hand_rect(panel_x + 24, panel_y + 86, 248, 418, fill="#f6edd9", color="#37322b", width=1.8, rx=8))
    items.append(small_label(panel_x + 48, panel_y + 118, "VISIBLE CANDIDATES"))

    card_y = panel_y + 144
    cards = [
        ("id:geek-1392", "AI Product Ops", "review", "#f7e7b2"),
        ("id:geek-2077", "HR SaaS PM", "pass", "#d9eadf"),
        ("id:geek-2218", "Already contacted", "skip", "#ead7cf"),
        ("id:geek-3024", "Need detail", "review", "#f7e7b2"),
    ]
    for idx, (cid, role, state, fill) in enumerate(cards):
        y = card_y + idx * 86
        items.append(hand_rect(panel_x + 44, y, 204, 66, fill=fill, color="#37322b", width=1.5, rx=8))
        items.append(small_label(panel_x + 62, y + 24, cid, "#40382f"))
        items.append(small_label(panel_x + 62, y + 48, f"{role} / {state}", "#6e5d4c"))

    detail_x = panel_x + 302
    items.append(hand_rect(detail_x, panel_y + 86, 520, 418, fill="#fffdf7", color="#37322b", width=1.8, rx=8))
    items.append(text(detail_x + 24, panel_y + 122, "候选人证据面板", 28, "#302b25", 700))
    items.append(small_label(detail_x + 28, panel_y + 154, "stableId + card text + detail screenshot"))
    items.append(hand_rect(detail_x + 28, panel_y + 182, 186, 78, fill="#f8f1e3", color="#37322b", width=1.5, rx=8))
    items.append(text(detail_x + 46, panel_y + 226, "39", 44, "#246e5a", 800))
    items.append(small_label(detail_x + 98, panel_y + 228, "fresh cards"))
    items.append(hand_rect(detail_x + 238, panel_y + 182, 238, 78, fill="#f8f1e3", color="#37322b", width=1.5, rx=8))
    items.append(text(detail_x + 258, panel_y + 226, "1", 44, "#d55535", 800))
    items.append(small_label(detail_x + 304, panel_y + 228, "needs approval"))
    items.append(chart(detail_x + 28, panel_y + 286, 464, 190))

    log_x = detail_x + 548
    items.append(hand_rect(log_x, panel_y + 86, 286, 418, fill="#f7f0df", color="#37322b", width=1.8, rx=8))
    items.append(text(log_x + 24, panel_y + 122, "审计日志", 27, "#302b25", 700))
    log_rows = [
        ("09:42", "scan_candidates", "done"),
        ("09:45", "extract_detail", "review"),
        ("09:47", "dry_run", "pass 6"),
        ("09:49", "contact_init", "waiting"),
        ("09:50", "action-log", "append"),
    ]
    for i, (tm, act, st) in enumerate(log_rows):
        y = panel_y + 160 + i * 56
        items.append(marker_rect(log_x + 22, y - 21, 230, 34, "#ffffff", 0.35))
        items.append(small_label(log_x + 30, y, tm, "#8a7258"))
        items.append(small_label(log_x + 84, y, act, "#332d27"))
        items.append(small_label(log_x + 218, y, st, "#6b5d4b"))

    items.append(sticky(1300, 142, 214, 154, "安全边界", ["不绕过登录/验证码", "不自动发送消息", "动作必须授权"], "#fff0ad"))
    items.append(sticky(1320, 354, 218, 172, "页面产物", ["candidates.json", "detail screenshot", "decisions.json", "action-log.jsonl"], "#dcedd8"))
    items.append(sticky(1296, 604, 226, 160, "落地提示", ["首屏左侧留文案", "右侧展示工作流", "移动端裁成界面局部"], "#f6c7ad"))
    items.append(hand_line(1288, 402, panel_x + panel_w - 230, panel_y + 170, "#d55535", 2.1, "8 8"))
    items.append(hand_line(1290, 672, detail_x + 292, panel_y + 375, "#246e5a", 2.1, "8 8"))

    for i in range(14):
        x = 86 + i * 86
        y = 888 + math.sin(i) * 5
        items.append(hand_line(x, y, x + 46, y + random.uniform(-6, 6), "#b98755", 1.4))
    items.append(small_label(80, 920, "handdrawn wireframe style / grid paper / marker shadows / sticky notes / multi-tab variants", "#8b7459"))

    items.append("</g>")
    items.append("</svg>")
    return "\n".join(items)


def render_png() -> bool:
    if render_with_browser():
        return True
    try:
        import cairosvg  # type: ignore
    except Exception:
        return False
    cairosvg.svg2png(url=str(SVG_PATH), write_to=str(PNG_PATH), output_width=W, output_height=H)
    return True


def render_with_browser() -> bool:
    html_path = OUT_DIR / ".bossauto-handdrawn-render.html"
    html_path.write_text(
        f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {{
      width: {W}px;
      height: {H}px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #f5ecd8;
    }}
    img {{
      width: {W}px;
      height: {H}px;
      display: block;
    }}
  </style>
</head>
<body>
  <img src="{SVG_PATH.name}" alt="">
</body>
</html>
""",
        encoding="utf-8",
    )
    browsers = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "msedge",
        "chrome",
    ]
    for browser in browsers:
        try:
            subprocess.run(
                [
                    browser,
                    "--headless",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    f"--screenshot={PNG_PATH}",
                    f"--window-size={W},{H}",
                    html_path.as_uri(),
                ],
                check=True,
                timeout=20,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            ok = PNG_PATH.exists()
            try:
                html_path.unlink(missing_ok=True)
            except Exception:
                pass
            return ok
        except Exception:
            continue
    try:
        html_path.unlink(missing_ok=True)
    except Exception:
        pass
    return False


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SVG_PATH.write_text(svg(), encoding="utf-8")
    if not render_png():
        render_with_browser()
    print(SVG_PATH)
    print(PNG_PATH if PNG_PATH.exists() else "PNG render unavailable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
