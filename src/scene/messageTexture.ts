/**
 * 紙メッシュに貼る日本語メッセージを Canvas で描く。
 *
 * GLB へ焼き込まない理由（計画の要件8）:
 *   - 文面をコード側で差し替えられる
 *   - 読みやすさ（文字サイズ・行間）を実機を見ながら調整できる
 *   - 日本語フォントをテクスチャに含めなくて済む
 *
 * 紙の UV は平らな長方形に張ってあるので、この Canvas がそのまま紙面になる。
 * Blender 側の紙は 52 x 38mm（横長 1.37:1）。
 */
import {CanvasTexture, LinearFilter, SRGBColorSpace} from 'three'

export interface MessageOptions {
  lines: string[]
  /** 見出しの上に小さく置くラベル（「〇〇のテーマ」など） */
  label?: string
  /** 見出し。いちばん大きく出る */
  heading?: string
  /** 解像度。iOS のメモリを考えて 1024 以下に抑える */
  width?: number
  /** 左右反転 */
  flipX?: boolean
  /** 上下反転 */
  flipY?: boolean
}

export function createMessageTexture(opts: MessageOptions): CanvasTexture {
  const W = opts.width ?? 1024
  const H = Math.round(W * (38 / 52)) // 紙の縦横比に合わせる

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D コンテキストを取得できません')

  // 反転は Canvas に描く時点で行う。テクスチャの repeat を負にすると
  // 端でフィルタリングの滲みが出ることがあるため。
  if (opts.flipX || opts.flipY) {
    ctx.translate(opts.flipX ? W : 0, opts.flipY ? H : 0)
    ctx.scale(opts.flipX ? -1 : 1, opts.flipY ? -1 : 1)
  }

  // --- 紙の地色 ---
  ctx.fillStyle = '#fbf7ee'
  ctx.fillRect(0, 0, W, H)

  // ほんのり和紙らしい斑を入れる（真っ白だと安っぽく見える）
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 240; i++) {
    const r = 6 + Math.random() * 26
    ctx.fillStyle = Math.random() < 0.5 ? '#c9bfa8' : '#ffffff'
    ctx.beginPath()
    ctx.arc(Math.random() * W, Math.random() * H, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // --- 縁の罫線 ---
  ctx.strokeStyle = '#d8cdb5'
  ctx.lineWidth = Math.max(2, W * 0.004)
  const m = W * 0.045
  ctx.strokeRect(m, m, W - m * 2, H - m * 2)

  // --- 本文 ---
  const font = `'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif`
  ctx.fillStyle = '#2e2a24'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lines = opts.lines.filter((l) => l.length > 0)

  // 行ごとに重みを付けて縦位置を割り振る。
  // ラベルは小さく、見出しは大きく見せたいので、占める高さも変える。
  type Row = {text: string; weight: number; scale: number; weightFont: number}
  const rows: Row[] = []
  if (opts.label) rows.push({text: opts.label, weight: 0.7, scale: 0.062, weightFont: 400})
  if (opts.heading) rows.push({text: opts.heading, weight: 1.6, scale: 0.20, weightFont: 700})
  for (const l of lines) rows.push({text: l, weight: 1.0, scale: 0.105, weightFont: 400})

  const totalWeight = rows.reduce((a, r) => a + r.weight, 0) || 1
  const areaTop = H * 0.16
  const areaH = H * 0.68

  let cursor = areaTop
  for (const r of rows) {
    const slot = (areaH * r.weight) / totalWeight
    // 長い行ほど小さくして、横にはみ出さないようにする
    const byLen = (W * 0.84) / Math.max(3, r.text.length) * 1.08
    const size = Math.min(H * r.scale, byLen)
    ctx.font = `${r.weightFont} ${size}px ${font}`
    ctx.fillText(r.text, W / 2, cursor + slot / 2)
    cursor += slot
  }

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}
