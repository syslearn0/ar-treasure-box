import type {AnchorStats} from '../xr/imageAnchor'
import type {ArState} from '../xr/trackingState'
import type {TrackingStatusDetail} from '../xr/types'

/**
 * Phase 2 の判定に必要な数値を画面に出す。
 * 「安定した」を主観で言わないための計測面。
 * 本番ビルドでは config.DEBUG=false により生成されない。
 */
export class DebugHud {
  private readonly el: HTMLElement
  private frames = 0
  private fpsAccum = 0
  private fps = 0

  constructor() {
    const el = document.createElement('div')
    el.id = 'debug-hud'
    document.body.appendChild(el)
    this.el = el
  }

  update(
    dtSec: number,
    state: ArState,
    tracking: TrackingStatusDetail | null,
    stats: Readonly<AnchorStats>,
    extra: {device: string; targetsLoaded: boolean; engineVersion: string; canvas: string}
  ): void {
    this.frames++
    this.fpsAccum += dtSec
    if (this.fpsAccum >= 0.5) {
      this.fps = this.frames / this.fpsAccum
      this.frames = 0
      this.fpsAccum = 0
    }

    const pos = stats.anchorPosition
    const rot = stats.anchorEulerDeg
    const n = (v: number | null | undefined, digits = 3): string =>
      v === null || v === undefined ? '—' : v.toFixed(digits)

    this.el.innerHTML = [
      row('STATE', state, stateColor(state)),
      row('当たったﾀｰｹﾞｯﾄ', stats.matchedTarget, '#7CFC98'),
      row('画像', `${stats.lastImageEvent} (${stats.secSinceImageEvent.toFixed(1)}s前)`),
      row('ワールド追跡', tracking ? `${tracking.status}${tracking.reason ? ` / ${tracking.reason}` : ''}` : '—'),
      row('サンプル数', String(stats.sampleCount)),
      row('アンカー座標', pos ? `${n(pos.x)}, ${n(pos.y)}, ${n(pos.z)}` : '未確定'),
      row('アンカー角度', rot ? `${n(rot.x, 1)}°, ${n(rot.y, 1)}°, ${n(rot.z, 1)}°` : '未確定'),
      row('再認識ズレ', `${n(stats.lastDeltaPosCm, 2)} cm / ${n(stats.lastDeltaAngDeg, 2)}°`),
      row('補正 / 再アンカー', `${stats.correctionCount} / ${stats.reanchorCount}`),
      row('target scale', `${n(stats.lastTargetScale, 4)} / w=${n(stats.lastScaledWidth, 4)}`),
      row('適用スケール', n(stats.appliedScale, 3)),
      row('scale収束', stats.scaleSpread),
      row('枠の実寸', stats.outlineSizeCm, '#ffd54f'),
      row('FPS', this.fps.toFixed(1), this.fps < 25 ? '#ff6b6b' : '#7CFC98'),
      row('canvas', extra.canvas),
      row('ターゲット読込', extra.targetsLoaded ? 'OK' : '未'),
      row('端末', extra.device),
      row('engine', extra.engineVersion),
    ].join('')
  }
}

function row(label: string, value: string, color?: string): string {
  const style = color ? ` style="color:${color}"` : ''
  return `<div class="hud-row"><span class="hud-k">${label}</span><span class="hud-v"${style}>${escapeHtml(value)}</span></div>`
}

function stateColor(state: ArState): string {
  switch (state) {
    case 'ANCHORED':
      return '#7CFC98'
    case 'DEGRADED':
    case 'RELOCALIZING':
      return '#FFD54F'
    case 'FAILED':
      return '#ff6b6b'
    default:
      return '#8ecbff'
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
