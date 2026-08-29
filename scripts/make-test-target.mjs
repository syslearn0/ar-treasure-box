/**
 * Phase 2a 用の「仮ターゲット」画像を生成する。
 *
 * 本番の箱が描き上がるまでの間、空間固定の検証を止めないための使い捨て画像。
 * 追跡しやすい条件を意図的に満たすように作る:
 *   - 3:4 縦（CLI が強制するアスペクト比）
 *   - 左右非対称・回転対称なし
 *   - グレースケール上でコントラストが立つ
 *   - 特徴が画面全体へ散る（一箇所に固まらせない）
 *   - 規則的な繰り返し模様を避ける（反復はマッチングを壊す）
 *
 * 出力: work/test-target.png （A6 くらいに印刷するか、別の画面に表示して使う）
 */
import sharp from 'sharp'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'work')
const outPath = path.join(outDir, 'test-target-v2.png')

const W = 1200
const H = 1600

// 決定論的な擬似乱数（毎回同じ画像が出るように）
let seed = 20260828
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const shapes = []

// 太い不規則な多角形（大きな明暗の塊）
for (let i = 0; i < 18; i++) {
  const cx = rnd() * W
  const cy = rnd() * H
  const r = 60 + rnd() * 160
  const n = 3 + Math.floor(rnd() * 5)
  const pts = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.9
    const rr = r * (0.5 + rnd() * 0.8)
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`)
  }
  const gray = rnd() < 0.55 ? 20 + rnd() * 45 : 190 + rnd() * 55
  shapes.push(`<polygon points="${pts.join(' ')}" fill="rgb(${gray},${gray},${gray})"/>`)
}

// 角の立つ矩形（コーナー特徴を増やす）
for (let i = 0; i < 60; i++) {
  const w = 18 + rnd() * 80
  const h = 18 + rnd() * 80
  const x = rnd() * (W - w)
  const y = rnd() * (H - h)
  const gray = rnd() < 0.5 ? 10 + rnd() * 40 : 205 + rnd() * 50
  const rot = (rnd() * 60 - 30).toFixed(1)
  shapes.push(
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgb(${gray},${gray},${gray})" transform="rotate(${rot} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})"/>`
  )
}

// 不規則な太線（エッジ特徴）
for (let i = 0; i < 34; i++) {
  const x1 = rnd() * W
  const y1 = rnd() * H
  const x2 = x1 + (rnd() - 0.5) * 520
  const y2 = y1 + (rnd() - 0.5) * 520
  const gray = rnd() < 0.5 ? 15 : 235
  shapes.push(
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgb(${gray},${gray},${gray})" stroke-width="${(4 + rnd() * 12).toFixed(1)}" stroke-linecap="round"/>`
  )
}

// 小さな点（細かい特徴を全体へ散らす）
for (let i = 0; i < 150; i++) {
  const cx = rnd() * W
  const cy = rnd() * H
  const r = 4 + rnd() * 14
  const gray = rnd() < 0.5 ? 0 : 255
  shapes.push(
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="rgb(${gray},${gray},${gray})"/>`
  )
}

// 向きが一目で分かる非対称マーク（左上だけ大きな三角）
shapes.push(`<polygon points="70,70 300,110 110,320" fill="rgb(5,5,5)"/>`)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="rgb(128,128,128)"/>
  ${shapes.join('\n  ')}
</svg>`

await mkdir(outDir, {recursive: true})
await sharp(Buffer.from(svg)).png().toFile(outPath)
console.log(`[make-test-target] ${outPath} (${W}x${H}, 3:4)`)
