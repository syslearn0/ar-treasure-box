/**
 * AR 体験の状態機械。
 *
 * BOOT → PERMISSION → LOADING → SCANNING → LOCKING → ANCHORED
 *                                             ↑         ↓
 *                                             └── DEGRADED ⇄ RELOCALIZING → FAILED
 *
 * SLAM 収束待ちの専用状態は置かない。収束前の誤確定は
 * ImageAnchor の isScaleConverged() が防ぐので、利用者を待たせる必要がない。
 *
 * 重要: DEGRADED / RELOCALIZING でもコンテンツは *絶対に消さない*。
 * 消してよいのは FAILED（ワールドトラッキング自体が失われた）だけ。
 */
export type ArState =
  | 'BOOT'
  | 'PERMISSION'
  | 'LOADING'
  | 'SCANNING'
  | 'LOCKING'
  | 'ANCHORED'
  | 'DEGRADED'
  | 'RELOCALIZING'
  | 'FAILED'

type Listener = (next: ArState, prev: ArState) => void

export class TrackingState {
  private state: ArState = 'BOOT'
  private listeners = new Set<Listener>()
  private enteredAt = performance.now()

  get current(): ArState {
    return this.state
  }

  /** 現在の状態に入ってからの経過秒 */
  get elapsedSec(): number {
    return (performance.now() - this.enteredAt) / 1000
  }

  /** アンカーが確定済みか（DEGRADED / RELOCALIZING でも確定済み扱い） */
  get isAnchored(): boolean {
    return this.state === 'ANCHORED' || this.state === 'DEGRADED' || this.state === 'RELOCALIZING'
  }

  set(next: ArState): void {
    if (next === this.state) return
    const prev = this.state
    this.state = next
    this.enteredAt = performance.now()
    for (const l of this.listeners) l(next, prev)
  }

  /** 今アンカー済みか（GLB の遅延読み込み後に Intro を出すかの判定用） */
  get isAnchoredNow(): boolean {
    return this.isAnchored
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
