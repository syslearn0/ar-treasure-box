/**
 * ハガキ本体（100 x 148mm）の印刷データを作る。
 *
 * 【設計の根拠 — すべて実機の実測から】
 *   - 画像ターゲットは縦3:4しか使えない。
 *     `--landscape`（isRotated: True）で作ったものは一度も認識されなかった。
 *   - 実寸48mmでは極端に近づかないと認識できず、iPad がピントを合わせられない。
 *     実寸83mmにしたら即座に認識した。**面積が認識距離を決める。**
 *   - よってターゲット領域はハガキに収まる最大の縦3:4を取る。
 *
 * レイアウト:
 *   ┌─────────────┐ 100 x 148mm
 *   │ ┌─────────┐ │
 *   │ │ 追跡領域 │ │  88 x 117.3mm（縦3:4）
 *   │ │  枠+箱   │ │  枠は白地を埋めて特徴を稼ぐためのもの
 *   │ └─────────┘ │
 *   │    [QR]     │  22mm
 *   └─────────────┘
 *
 * ハガキには文章を書かない（要件通り）。枠は装飾であって文字ではない。
 *
 * 使い方:
 *   node scripts/make-postcard.mjs "https://example.com/ar/"
 */
import sharp from 'sharp'
import QRCode from 'qrcode'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const url = process.argv[2]
if (!url) {
  console.error('使い方: node scripts/make-postcard.mjs <QRに入れるURL>')
  process.exit(1)
}

const DPI = 300
const MM = DPI / 25.4
const mm = (v) => Math.round(v * MM)

const CARD_W = mm(100)
const CARD_H = mm(148)

// 追跡領域（縦3:4）。ハガキ幅100mmに左右6mmの余白を残す。
const T_W_MM = 88
const T_H_MM = (T_W_MM * 4) / 3 // 117.3
const T_W = mm(T_W_MM)
const T_H = mm(T_H_MM)
const T_LEFT = Math.round((CARD_W - T_W) / 2)
const T_TOP = mm(5)

// QR
const QR_MM = 22
const QR = mm(QR_MM)
const QR_TOP = T_TOP + T_H + mm(3)

// 箱は追跡領域の中央やや上に、幅いっぱい近くまで
const BOX_W_MM = 78
const BOX_W = mm(BOX_W_MM)
const BOX_H = Math.round((BOX_W * 3) / 4)
const BOX_LEFT = T_LEFT + Math.round((T_W - BOX_W) / 2)
const BOX_TOP = T_TOP + Math.round(T_H * 0.30 - BOX_H / 2) + mm(8)

const srcBox = path.join(root, 'work', 'art', 'box.png')
if (!existsSync(srcBox)) {
  console.error(`箱の絵が見つかりません: ${srcBox}`)
  process.exit(1)
}

// ---------------------------------------------------------------- 装飾枠
// 白地は特徴ゼロで追跡の死に領域になる。手描き風の枠と細かい印で埋めて、
// 「文章を載せない」という要件を守りつつ特徴量を稼ぐ。

let seed = 20260828
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296)

const jitter = (x, y, a) => `${(x + (rnd() - 0.5) * a).toFixed(1)},${(y + (rnd() - 0.5) * a).toFixed(1)}`

function wobblyRect(x, y, w, h, amp, steps = 30) {
  const pts = []
  for (let i = 0; i < steps; i++) pts.push(jitter(x + (w * i) / steps, y, amp))
  for (let i = 0; i < steps; i++) pts.push(jitter(x + w, y + (h * i) / steps, amp))
  for (let i = steps; i > 0; i--) pts.push(jitter(x + (w * i) / steps, y + h, amp))
  for (let i = steps; i > 0; i--) pts.push(jitter(x, y + (h * i) / steps, amp))
  return `<polygon points="${pts.join(' ')}" fill="none" stroke="#1a1a1a" stroke-width="${amp * 0.9}" stroke-linejoin="round"/>`
}

const deco = []
const inset = mm(3)
deco.push(wobblyRect(T_LEFT + inset, T_TOP + inset, T_W - inset * 2, T_H - inset * 2, mm(0.9)))
deco.push(wobblyRect(T_LEFT + inset * 2.1, T_TOP + inset * 2.1, T_W - inset * 4.2, T_H - inset * 4.2, mm(0.4)))

// 四隅の飾り（非対称にして、どの角かを識別できるようにする）
const corners = [
  [T_LEFT + inset * 3, T_TOP + inset * 3, 1, 1, 5],
  [T_LEFT + T_W - inset * 3, T_TOP + inset * 3, -1, 1, 3],
  [T_LEFT + inset * 3, T_TOP + T_H - inset * 3, 1, -1, 4],
  [T_LEFT + T_W - inset * 3, T_TOP + T_H - inset * 3, -1, -1, 6],
]
for (const [cx, cy, sx, sy, n] of corners) {
  for (let i = 0; i < n; i++) {
    const r = mm(1.2 + i * 1.15)
    deco.push(
      `<path d="M ${cx + sx * r} ${cy} A ${r} ${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${cx} ${cy + sy * r}" fill="none" stroke="#1a1a1a" stroke-width="${mm(0.35)}"/>`
    )
  }
}

// 箱の下の余白を埋める。白地は特徴ゼロで追跡の死に領域になるが、
// ただの散らしだとゴミに見えるので、宝箱から溢れる「きらめき」として描く。
// 大小の四芒星は角が立つので特徴点としても優秀。
function sparkle(cx, cy, r, w) {
  const t = r * 0.22
  return `<path d="M ${cx} ${cy - r} Q ${cx + t} ${cy - t} ${cx + r} ${cy} Q ${cx + t} ${cy + t} ${cx} ${cy + r} Q ${cx - t} ${cy + t} ${cx - r} ${cy} Q ${cx - t} ${cy - t} ${cx} ${cy - r} Z" fill="#1a1a1a" opacity="${w}"/>`
}

const bandTop = BOX_TOP + BOX_H + mm(6)
const bandBottom = T_TOP + T_H - inset * 3.4
const bandH = Math.max(1, bandBottom - bandTop)
for (let i = 0; i < 46; i++) {
  const x = T_LEFT + inset * 3.4 + rnd() * (T_W - inset * 6.8)
  const y = bandTop + rnd() * bandH
  // 箱に近いほど大きく、離れるほど小さく散る
  const near = 1 - (y - bandTop) / bandH
  const r = mm(1.0) + rnd() * mm(3.4) * (0.35 + near * 0.65)
  deco.push(sparkle(x, y, r, (0.55 + rnd() * 0.45).toFixed(2)))
}
// 小さな粒を少しだけ 混ぜて、密度に階調をつける
for (let i = 0; i < 34; i++) {
  const x = T_LEFT + inset * 3.4 + rnd() * (T_W - inset * 6.8)
  const y = bandTop + rnd() * bandH
  deco.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(mm(0.3) + rnd() * mm(0.7)).toFixed(1)}" fill="#1a1a1a" opacity="0.75"/>`)
}

// 箱の足元の影
deco.push(
  `<ellipse cx="${BOX_LEFT + BOX_W / 2}" cy="${BOX_TOP + BOX_H + mm(1.5)}" rx="${BOX_W * 0.46}" ry="${mm(2.6)}" fill="#1a1a1a" opacity="0.16"/>`
)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#ffffff"/>
  ${deco.join('\n  ')}
</svg>`

// ---------------------------------------------------------------- 合成

const outDir = path.join(root, 'work')
await mkdir(outDir, {recursive: true})

const boxBuf = await sharp(srcBox).resize({width: BOX_W, height: BOX_H, fit: 'fill'}).png().toBuffer()

const qrPng = await QRCode.toBuffer(url, {
  type: 'png',
  width: QR,
  margin: 1,
  errorCorrectionLevel: 'M',
  color: {dark: '#000000', light: '#ffffff'},
})

const outPath = path.join(outDir, 'postcard.png')
await sharp(Buffer.from(svg))
  .composite([
    {input: boxBuf, left: BOX_LEFT, top: BOX_TOP},
    {input: qrPng, left: Math.round((CARD_W - QR) / 2), top: QR_TOP},
  ])
  .withMetadata({density: DPI})
  .png()
  .toFile(outPath)

// 追跡領域だけを切り出したもの（ターゲット生成の下見用）
await sharp(outPath)
  .extract({left: T_LEFT, top: T_TOP, width: T_W, height: T_H})
  .png()
  .toFile(path.join(outDir, 'postcard-target-region.png'))

console.log(`[postcard] ${path.relative(root, outPath)}`)
console.log(`  ハガキ  : 100 x 148 mm / ${DPI}dpi`)
console.log(`  追跡領域: ${T_W_MM} x ${T_H_MM.toFixed(1)} mm（縦3:4）`)
console.log(`  箱      : ${BOX_W_MM} x ${(BOX_W_MM * 3 / 4).toFixed(1)} mm`)
console.log(`  QR      : ${QR_MM} mm / ${url}`)
console.log('')
console.log('  src/config.ts の TARGETS に入れる値:')
console.log(`    physicalWidthM: ${(T_W_MM / 1000).toFixed(4)}`)
console.log(`    physicalHeightM: ${(T_H_MM / 1000).toFixed(4)}`)
