import type {ArState} from '../xr/trackingState'

/**
 * 画面上のUI。Three.js のシーンではなく素の DOM で作る。
 * 要件11の文言をそのまま使う。
 */

export interface OverlayCallbacks {
  onStart: () => void
  onRescan: () => void
  onRecenter: () => void
  onReplayIntro?: () => void
}

export class Overlay {
  private readonly root: HTMLElement
  private readonly launch: HTMLElement
  private readonly guide: HTMLElement
  private readonly guideText: HTMLElement
  private readonly hint: HTMLElement
  private readonly recovery: HTMLElement
  private readonly loading: HTMLElement
  private readonly loadingText: HTMLElement
  private readonly error: HTMLElement
  private readonly errorText: HTMLElement
  private readonly controls: HTMLElement

  private guideMessageIndex = 0
  private guideTimer = 0

  private static readonly GUIDE_MESSAGES = [
    'もう少し近づけてください',
    'ゆっくり動かしてください',
    '光が反射しない角度で映してください',
  ]

  constructor(callbacks: OverlayCallbacks) {
    this.root = must('ui-root')
    this.launch = must('ui-launch')
    this.guide = must('ui-guide')
    this.guideText = must('ui-guide-text')
    this.hint = must('ui-hint')
    this.recovery = must('ui-recovery')
    this.loading = must('ui-loading')
    this.loadingText = must('ui-loading-text')
    this.error = must('ui-error')
    this.errorText = must('ui-error-text')
    this.controls = must('ui-controls')

    must('btn-start').addEventListener('click', callbacks.onStart)
    must('btn-rescan').addEventListener('click', callbacks.onRescan)
    must('btn-recenter').addEventListener('click', callbacks.onRecenter)
    const replay = document.getElementById('btn-replay')
    if (replay && callbacks.onReplayIntro) {
      replay.addEventListener('click', callbacks.onReplayIntro)
    }
    this.root.hidden = false
  }

  setProgress(text: string): void {
    this.loadingText.textContent = text
  }

  showError(message: string): void {
    this.hideAll()
    this.errorText.textContent = message
    this.error.hidden = false
  }

  /** 認識中のガイド文を数秒おきに入れ替える */
  tick(dtSec: number, state: ArState): void {
    if (state !== 'SCANNING' && state !== 'LOCKING') return
    this.guideTimer += dtSec
    if (this.guideTimer < 3.5) return
    this.guideTimer = 0
    this.guideMessageIndex = (this.guideMessageIndex + 1) % Overlay.GUIDE_MESSAGES.length
    this.guideText.textContent = Overlay.GUIDE_MESSAGES[this.guideMessageIndex]
  }

  render(state: ArState): void {
    this.hideAll()
    switch (state) {
      case 'BOOT':
        this.launch.hidden = false
        break
      case 'PERMISSION':
      case 'LOADING':
        // PERMISSION で起動パネルへ戻すと、押したボタンが再び出て混乱する。
        // 進捗パネルのまま文言だけ変える。
        this.loading.hidden = false
        break
      case 'SCANNING':
      case 'LOCKING':
        this.guide.hidden = false
        this.guideText.textContent = Overlay.GUIDE_MESSAGES[this.guideMessageIndex]
        break
      case 'ANCHORED':
        // ガイドUIを消す。コントロールだけ小さく残す。
        this.controls.hidden = false
        break
      case 'DEGRADED':
      case 'RELOCALIZING':
        // 画面全体を覆わない。小さいヒントだけ。モデルは消さない。
        this.controls.hidden = false
        this.hint.hidden = false
        break
      case 'FAILED':
        this.controls.hidden = false
        this.recovery.hidden = false
        break
    }
  }

  /** アンカー確定時のフィードバック（短い振動＋視覚） */
  anchorFeedback(): void {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(35)
    }
    const flash = must('ui-flash')
    flash.classList.remove('flash-run')
    // reflow を挟んでアニメーションを再起動する
    void flash.offsetWidth
    flash.classList.add('flash-run')
  }

  private hideAll(): void {
    this.launch.hidden = true
    this.guide.hidden = true
    this.hint.hidden = true
    this.recovery.hidden = true
    this.loading.hidden = true
    this.error.hidden = true
    this.controls.hidden = true
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`UI 要素が見つかりません: #${id}`)
  return el
}
