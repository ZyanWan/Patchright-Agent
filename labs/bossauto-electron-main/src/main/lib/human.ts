// 真人化操作层:正态分布延时 + 走神
// 用法:
//   await sleep(humanDelay(120, 40))   // 均值 120ms,标准差 40ms
//   await maybeDistracted()             // 3% 概率额外停 0.5~2.5s

// Box-Muller:从 (mean, std) 正态分布采一个,clamp 到非负
export function humanDelay(meanMs: number, stdMs: number): number {
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const v = meanMs + z * stdMs
  // 截断到 [mean/4, mean*4],防止极端尾巴
  const lo = Math.max(10, meanMs / 4)
  const hi = meanMs * 4
  return Math.max(lo, Math.min(hi, v))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// 3% 概率走神 0.5~2.5s
export async function maybeDistracted(probability = 0.03) {
  if (Math.random() < probability) {
    const ms = 500 + Math.random() * 2000
    await sleep(ms)
  }
}

// 综合点击间延时:基础正态 + 可能走神
export async function humanPause(meanMs = 600, stdMs = 180) {
  await sleep(humanDelay(meanMs, stdMs))
  await maybeDistracted()
}

// 鼠标移动到点击点的多段路径(简单二段抖动,后期可换贝塞尔)
export function humanMousePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 14
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    // 缓动 + 小幅抖动
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    const jitterX = (Math.random() - 0.5) * 2.5
    const jitterY = (Math.random() - 0.5) * 2.5
    pts.push({
      x: from.x + dx * ease + jitterX,
      y: from.y + dy * ease + jitterY
    })
  }
  return pts
}
