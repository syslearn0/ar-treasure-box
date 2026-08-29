/**
 * 実寸を保証する印刷用シートを作る。
 *
 * L判印刷で「プリンタが勝手に拡縮・トリミングし、原画とも紙とも違う比率になる」
 * 問題が起きたため、A4 に実寸配置して 100% 印刷する方式へ切り替える。
 *
 * シートには検証用の要素を入れる:
 *   - トンボ（箱の四隅）      … 切り出し位置
 *   - 100mm の実寸定規         … 定規を当てて 100mm ちょうどか確認する
 *   - サイズ表記               … 何mmで刷ったつもりかを紙に残す
 *
 * 使い方:
 *   node scripts/make-print-sheet.mjs [箱の幅mm]
 *   node scripts/make-print-sheet.mjs 86
 *
 * 印刷設定:
 *   用紙A4 / 倍率は「実際のサイズ」または100%（「用紙に合わせる」は絶対に使わない）
 */
import sharp from 'sharp'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const DPI = 300
const MM = DPI / 25.4 // 1mm あたりのピクセル数
const mm = (v) => Math.round(v * MM)

const A4_W = mm(210)
const A4_H = mm(297)

const boxWidthMm = Number(process.argv[2] ?? 86)
if (!Number.isFinite(boxWidthMm) || boxWidthMm <= 0 || boxWidthMm > 190) {
  console.error('箱の幅は 1〜190mm で指定してください')
  process.exit(1)
}
const boxHeightMm = (boxWidthMm * 3) / 4 // 4:3 固定

const srcPath = path.join(root, 'work', 'art', 'box.png')
if (!existsSync(srcPath)) {
  console.error(`元画像が見つかりません: ${srcPath}`)
  console.error('先にタイト切り抜き画像を用意してください。')
  process.exit(1)
}

const boxW = mm(boxWidthMm)
const boxH = mm(boxHeightMm)
const boxLeft = Math.round((A4_W - boxW) / 2)
const boxTop = mm(40)

// --- トンボ・定規・注記 ---
const markLen = mm(5)
const gap = mm(2)
const rulerTop = boxTop + boxH + mm(25)
const rulerLeft = Math.round((A4_W - mm(100)) / 2)

const ticks = []
for (let i = 0; i <= 100; i += 10) {
  const x = rulerLeft + mm(i)
  const h = i % 50 === 0 ? mm(5) : mm(3)
  ticks.push(`<line x1="${x}" y1="${rulerTop}" x2="${x}" y2="${rulerTop + h}" stroke="#000" stroke-width="2"/>`)
  ticks.push(
    `<text x="${x}" y="${rulerTop + h + mm(4)}" font-family="sans-serif" font-size="${mm(3)}" text-anchor="middle" fill="#000">${i}</text>`
  )
}

const corner = (cx, cy, dx, dy) => `
  <line x1="${cx + dx * gap}" y1="${cy}" x2="${cx + dx * (gap + markLen)}" y2="${cy}" stroke="#000" stroke-width="2"/>
  <line x1="${cx}" y1="${cy + dy * gap}" x2="${cx}" y2="${cy + dy * (gap + markLen)}" stroke="#000" stroke-width="2"/>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${A4_W}" height="${A4_H}">
  <rect width="${A4_W}" height="${A4_H}" fill="#fff"/>

  ${corner(boxLeft, boxTop, -1, -1)}
  ${corner(boxLeft + boxW, boxTop, 1, -1)}
  ${corner(boxLeft, boxTop + boxH, -1, 1)}
  ${corner(boxLeft + boxW, boxTop + boxH, 1, 1)}

  <text x="${A4_W / 2}" y="${mm(25)}" font-family="sans-serif" font-size="${mm(5)}" text-anchor="middle" fill="#000">
    箱 ${boxWidthMm} x ${boxHeightMm.toFixed(1)} mm （4:3）
  </text>
  <text x="${A4_W / 2}" y="${mm(32)}" font-family="sans-serif" font-size="${mm(3.5)}" text-anchor="middle" fill="#555">
    印刷倍率は「実際のサイズ / 100%」。「用紙に合わせる」は使わないこと。
  </text>

  <line x1="${rulerLeft}" y1="${rulerTop}" x2="${rulerLeft + mm(100)}" y2="${rulerTop}" stroke="#000" stroke-width="2"/>
  ${ticks.join('\n  ')}
  <text x="${A4_W / 2}" y="${rulerTop + mm(14)}" font-family="sans-serif" font-size="${mm(3.5)}" text-anchor="middle" fill="#000">
    ↑ この線が定規でちょうど 100mm なら、箱も正しい実寸で刷れています
  </text>
</svg>`

const boxBuf = await sharp(srcPath)
  .resize({width: boxW, height: boxH, fit: 'fill'})
  .png()
  .toBuffer()

const outDir = path.join(root, 'work')
await mkdir(outDir, {recursive: true})
const outPath = path.join(outDir, `print-sheet-${boxWidthMm}mm.png`)

await sharp(Buffer.from(svg))
  .composite([{input: boxBuf, left: boxLeft, top: boxTop}])
  .withMetadata({density: DPI})
  .png()
  .toFile(outPath)

console.log(`[print-sheet] ${path.relative(root, outPath)}`)
console.log(`  A4 / ${DPI}dpi / 箱 ${boxWidthMm} x ${boxHeightMm.toFixed(1)} mm`)
console.log('  印刷後、定規で 100mm の線を測って倍率を確認してください。')
