/**
 * 画像ターゲットの「追跡しやすさ」を測る。
 *
 * @8thwall/image-target-cli は特徴点を一切計算しない（生成JSONの metadata が null で、
 * 抽出はランタイム側）。そのため「特徴点が足りているか」「全体に散っているか」を
 * 事前に確認する手段が無い。ここを埋めるためのツール。
 *
 * 実装は FAST-9 コーナー検出 + 非最大抑制。ORB など実際の追跡器が使う特徴と同系統。
 *
 * 測るもの:
 *   1. 特徴点の総数（多いほどよい）
 *   2. 分布の偏り  — 8x8 グリッドで、特徴が存在するセルの割合と変動係数
 *                    偏っていると、その部分が隠れた瞬間に追跡が飛ぶ
 *   3. 縮小耐性    — 遠くから写したときに何割の特徴が残るか
 *                    「認識できる距離」を左右する
 *   4. 識別性      — 特徴同士が似すぎていないか（★最重要）
 *                    木目のハッチングのような反復パターンは、点の数が多くても
 *                    どれも似ていて対応が取れず、追跡器は失敗する。
 *                    Lowe の比率テストと同じ考え方で「紛らわしい特徴」の割合を出す。
 *
 * 使い方:
 *   node scripts/analyze-target.mjs work/test-target.png
 *   node scripts/analyze-target.mjs public/image-targets/box_luminance.png
 */
import sharp from 'sharp'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const input = process.argv[2]
if (!input || !existsSync(path.resolve(input))) {
  console.error('使い方: node scripts/analyze-target.mjs <画像パス>')
  process.exit(1)
}
const absInput = path.resolve(input)

// FAST-9 の 16 近傍（半径3のブレゼンハム円）
const CIRCLE = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
]
const CONTIGUOUS = 9
const THRESHOLD = 20

/** @returns {{x:number,y:number,score:number}[]} */
function detectFast(gray, width, height) {
  const corners = []
  const at = (x, y) => gray[y * width + x]

  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const p = at(x, y)
      const hi = p + THRESHOLD
      const lo = p - THRESHOLD

      // 高速棄却: 上下左右の4点のうち3点以上が同方向でなければコーナーではない
      const c0 = at(x, y - 3)
      const c4 = at(x + 3, y)
      const c8 = at(x, y + 3)
      const c12 = at(x - 3, y)
      const brightCount = (c0 > hi ? 1 : 0) + (c4 > hi ? 1 : 0) + (c8 > hi ? 1 : 0) + (c12 > hi ? 1 : 0)
      const darkCount = (c0 < lo ? 1 : 0) + (c4 < lo ? 1 : 0) + (c8 < lo ? 1 : 0) + (c12 < lo ? 1 : 0)
      if (brightCount < 3 && darkCount < 3) continue

      const vals = new Array(16)
      for (let k = 0; k < 16; k++) vals[k] = at(x + CIRCLE[k][0], y + CIRCLE[k][1])

      let isCorner = false
      for (const dir of [1, -1]) {
        let run = 0
        // 円は閉じているので 16+CONTIGUOUS-1 まで回して連続を判定する
        for (let k = 0; k < 16 + CONTIGUOUS - 1; k++) {
          const v = vals[k % 16]
          const ok = dir === 1 ? v > hi : v < lo
          run = ok ? run + 1 : 0
          if (run >= CONTIGUOUS) {
            isCorner = true
            break
          }
        }
        if (isCorner) break
      }
      if (!isCorner) continue

      let score = 0
      for (let k = 0; k < 16; k++) score += Math.abs(vals[k] - p)
      corners.push({x, y, score})
    }
  }
  return corners
}

/** 3x3 非最大抑制 */
function suppress(corners, width) {
  const byPos = new Map()
  for (const c of corners) byPos.set(c.y * width + c.x, c.score)
  return corners.filter((c) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const s = byPos.get((c.y + dy) * width + (c.x + dx))
        if (s !== undefined && s > c.score) return false
      }
    }
    return true
  })
}

async function grayscaleAt(height) {
  const img = sharp(absInput).grayscale().resize({height, fit: 'inside'})
  const {data, info} = await img.raw().toBuffer({resolveWithObject: true})
  return {gray: data, width: info.width, height: info.height}
}

function gridReport(corners, width, height, cells = 8) {
  const counts = new Array(cells * cells).fill(0)
  for (const c of corners) {
    const cx = Math.min(cells - 1, Math.floor((c.x / width) * cells))
    const cy = Math.min(cells - 1, Math.floor((c.y / height) * cells))
    counts[cy * cells + cx]++
  }
  const occupied = counts.filter((n) => n > 0).length
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length)
  return {counts, cells, occupied, coverage: occupied / counts.length, cv: mean > 0 ? sd / mean : 0}
}

function renderGrid(report) {
  const {counts, cells} = report
  const max = Math.max(...counts, 1)
  const ramp = ' .:-=+*#%@'
  const lines = []
  for (let y = 0; y < cells; y++) {
    let line = '  '
    for (let x = 0; x < cells; x++) {
      const n = counts[y * cells + x]
      const idx = n === 0 ? 0 : Math.min(ramp.length - 1, 1 + Math.floor((n / max) * (ramp.length - 2)))
      line += ramp[idx] + ramp[idx]
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/**
 * 特徴の識別性を測る。
 *
 * 各特徴点まわりの小パッチを取り、他の特徴のパッチと総当たりで比べる。
 * 最良一致と次点が近い（比率が 1 に近い）特徴は「紛らわしい」= 対応が取れない。
 * 反復パターンではこの割合が跳ね上がる。
 */
function measureDistinctiveness(gray, width, height, corners, patch = 7, maxN = 260) {
  const top = [...corners].sort((a, b) => b.score - a.score).slice(0, maxN)
  const half = Math.floor(patch / 2)
  const descs = []
  for (const c of top) {
    if (c.x < half || c.y < half || c.x >= width - half || c.y >= height - half) continue
    const v = []
    let sum = 0
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const g = gray[(c.y + dy) * width + (c.x + dx)]
        v.push(g)
        sum += g
      }
    }
    // 明るさ・コントラストの影響を除くため正規化する
    const mean = sum / v.length
    let ss = 0
    for (let i = 0; i < v.length; i++) {
      v[i] -= mean
      ss += v[i] * v[i]
    }
    const norm = Math.sqrt(ss) || 1
    for (let i = 0; i < v.length; i++) v[i] /= norm
    descs.push({x: c.x, y: c.y, v})
  }

  let ambiguous = 0
  const ratios = []
  for (let i = 0; i < descs.length; i++) {
    let best = Infinity
    let second = Infinity
    for (let j = 0; j < descs.length; j++) {
      if (i === j) continue
      // 近傍の点は同じ構造なので除外する（自己相関を誤検出しないため）
      const dx = descs[i].x - descs[j].x
      const dy = descs[i].y - descs[j].y
      if (dx * dx + dy * dy < 400) continue
      let d = 0
      const a = descs[i].v
      const b = descs[j].v
      for (let k = 0; k < a.length; k++) {
        const t = a[k] - b[k]
        d += t * t
      }
      if (d < best) {
        second = best
        best = d
      } else if (d < second) {
        second = d
      }
    }
    if (!isFinite(second) || second === 0) continue
    const r = Math.sqrt(best / second)
    ratios.push(r)
    if (r > 0.8) ambiguous++   // Lowe の閾値
  }
  ratios.sort((a, b) => a - b)
  return {
    checked: ratios.length,
    ambiguousPct: ratios.length ? (ambiguous / ratios.length) * 100 : 0,
    medianRatio: ratios.length ? ratios[ratios.length >> 1] : 0,
  }
}

// ---------------------------------------------------------------- 実行

// 8th Wall は luminance 画像を高さ640で扱う（image-target-cli の constants.json）
const BASE_HEIGHT = 640
const base = await grayscaleAt(BASE_HEIGHT)
const baseCorners = suppress(detectFast(base.gray, base.width, base.height), base.width)
const report = gridReport(baseCorners, base.width, base.height)

console.log('')
console.log(`入力: ${path.relative(root, absInput)}`)
console.log(`解析解像度: ${base.width} x ${base.height}（8th Wall の luminance と同じ高さ640）`)
console.log('')
console.log('── 1. 特徴点の量 ──')
console.log(`  特徴点数: ${baseCorners.length}`)
const amount =
  baseCorners.length >= 800 ? '十分' : baseCorners.length >= 300 ? 'やや少ない' : '不足'
console.log(`  判定: ${amount}`)
console.log('')
console.log('── 2. 分布 ──')
console.log(`  8x8セルの被覆率: ${(report.coverage * 100).toFixed(1)}%（100%が理想）`)
console.log(`  変動係数(CV): ${report.cv.toFixed(2)}（小さいほど均一。1.0超は偏りが大きい）`)
console.log('')
console.log(renderGrid(report))
console.log('')
console.log('── 3. 縮小耐性（＝どれだけ離れて認識できるか）──')
console.log('  カメラ内でターゲットが小さく写るほど、実効解像度は下がる。')
console.log('')
for (const h of [640, 480, 320, 240, 160]) {
  const s = await grayscaleAt(h)
  const c = suppress(detectFast(s.gray, s.width, s.height), s.width)
  const pct = ((c.length / baseCorners.length) * 100).toFixed(0)
  const bar = '#'.repeat(Math.max(0, Math.round(c.length / Math.max(1, baseCorners.length) * 40)))
  console.log(`  高さ${String(h).padStart(4)}px: ${String(c.length).padStart(5)} 点 (${pct.padStart(3)}%) ${bar}`)
}
console.log('')
console.log('  目安: 高さ240pxで200点以上残れば、自然な距離で認識しやすい。')
console.log('')

// 特徴点を重ねた画像を出力
const outDir = path.join(root, 'work')
await mkdir(outDir, {recursive: true})
const rgb = Buffer.alloc(base.width * base.height * 3)
for (let i = 0; i < base.width * base.height; i++) {
  const v = Math.round(base.gray[i] * 0.45 + 140 * 0.55)
  rgb[i * 3] = v
  rgb[i * 3 + 1] = v
  rgb[i * 3 + 2] = v
}
for (const c of baseCorners) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx
      const y = c.y + dy
      if (x < 0 || y < 0 || x >= base.width || y >= base.height) continue
      const i = (y * base.width + x) * 3
      rgb[i] = 255
      rgb[i + 1] = 40
      rgb[i + 2] = 40
    }
  }
}
// --- 4. 識別性 ---
const dist = measureDistinctiveness(base.gray, base.width, base.height, baseCorners)
console.log('── 4. 識別性（★最重要）──')
console.log(`  検査した特徴: ${dist.checked}`)
console.log(`  紛らわしい特徴の割合: ${dist.ambiguousPct.toFixed(1)}%`)
console.log(`  最良/次点 比率の中央値: ${dist.medianRatio.toFixed(3)}（小さいほど識別しやすい）`)
console.log(
  `  判定: ${dist.ambiguousPct < 30 ? '良好' : dist.ambiguousPct < 55 ? '注意' : '不良（反復パターンの疑い）'}`
)
console.log('')
console.log('  反復パターン（木目のハッチング、規則的な縞）は特徴点の数が多くても')
console.log('  互いに似すぎて対応が取れず、追跡器は失敗する。')
console.log('')

const outPath = path.join(outDir, `${path.parse(absInput).name}-features.png`)
await sharp(rgb, {raw: {width: base.width, height: base.height, channels: 3}})
  .png()
  .toFile(outPath)
console.log(`特徴点マップ: ${path.relative(root, outPath)}`)
console.log('')
