import {Object3D, Quaternion, Vector3, Mesh, Material} from 'three'
import type {ImageTargetDetail, TrackingStatusDetail} from './types'
import type {TrackingState} from './trackingState'

/**
 * ★本プロジェクトの中核★
 *
 * 画像ターゲットは「初期姿勢を決める」ためだけに使い、以後の追従は
 * 8th Wall の SLAM ワールドトラッキングに完全に任せる。
 *
 *   scene
 *    ├ camera      ← SLAM が毎フレーム更新（8th Wall が担当）
 *    └ anchorRoot  ← scene 直下。姿勢を一度だけ決めて以後は動かさない
 *         └ content
 *
 * anchorRoot は画像ターゲットの子ではない。したがって画像を見失っても
 * コンテンツは実空間のその場所に残り続ける（＝本当の空間アンカー）。
 * imagelost で visible を false にすることは *絶対にしない*。
 */

export interface AnchorConfig {
  /** 初期姿勢を決めるためにサンプルを溜める時間 */
  lockDurationMs: number
  /** 姿勢確定に必要な最小サンプル数 */
  minSamples: number
  /** サンプルのばらつき上限（これを超えたら溜め直す） */
  maxPositionSpreadM: number
  maxAngleSpreadDeg: number
  /** この範囲内のズレなら lerp / slerp で滑らかに補正する */
  smallPosDeltaM: number
  smallAngDeltaDeg: number
  /** この範囲を超えたらスライドさせず、フェードして再アンカーする */
  bigPosDeltaM: number
  bigAngDeltaDeg: number
  /** 補正の1フレームあたりの係数（60fps基準） */
  correctionLerp: number
  /** 再アンカー時のフェード時間（片道） */
  fadeDurationSec: number
  /**
   * 実物のターゲットの横幅(m)。コンテンツは実寸(メートル)で作り、
   * ここを基準に anchorRoot をスケールして印刷物と一致させる。
   */
  physicalWidthM: number
  /** 実物のターゲットの高さ(m)。枠の縦横比はここで決まる。 */
  physicalHeightM: number
  /**
   * スケール推定の安定判定。LOCKING 中に集めた detail.scale の
   * 最大/最小がこの比を超えていたら「まだ収束していない」とみなして確定しない。
   *
   * 実機で detail.scale が 0.327 〜 3.92（約12倍）まで振れることを確認しており、
   * 揺れている最中に確定するとアンカーもスケールも壊れる。
   */
  scaleStabilityRatio: number
}

export const DEFAULT_ANCHOR_CONFIG: AnchorConfig = {
  lockDurationMs: 400,
  minSamples: 6,
  maxPositionSpreadM: 0.02,
  maxAngleSpreadDeg: 6,
  smallPosDeltaM: 0.03,
  smallAngDeltaDeg: 8,
  bigPosDeltaM: 0.1,
  bigAngDeltaDeg: 20,
  correctionLerp: 0.05,
  fadeDurationSec: 0.25,
  physicalWidthM: 0.089,
  physicalHeightM: 0.089 * (4 / 3),
  scaleStabilityRatio: 1.25,
}

interface Sample {
  position: Vector3
  quaternion: Quaternion
}

export interface AnchorStats {
  matchedTarget: string
  lastImageEvent: 'NONE' | 'FOUND' | 'UPDATED' | 'LOST'
  secSinceImageEvent: number
  sampleCount: number
  anchorPosition: Vector3 | null
  anchorEulerDeg: {x: number; y: number; z: number} | null
  lastDeltaPosCm: number | null
  lastDeltaAngDeg: number | null
  lastTargetScale: number | null
  lastScaledWidth: number | null
  appliedScale: number | null
  /** 枠がワールド上で何cmになっているか（定規で実測して突き合わせる） */
  outlineSizeCm: string
  scaleSpread: string
  reanchorCount: number
  correctionCount: number
}

type FadePhase = 'none' | 'out' | 'in'

export class ImageAnchor {
  private readonly cfg: AnchorConfig  // physicalWidthM は setPhysicalSize で差し替わる
  private samples: Sample[] = []
  private lockStartedAt = 0

  /** 確定済みアンカー姿勢（ワールド座標）。null なら未確定。 */
  private anchorPos: Vector3 | null = null
  private anchorQuat: Quaternion | null = null

  /** 滑らかな補正の目標姿勢 */
  private correctionPos: Vector3 | null = null
  private correctionQuat: Quaternion | null = null

  /** 再アンカー（大きくズレた時）用のフェード */
  private fadePhase: FadePhase = 'none'
  private fadeElapsed = 0
  private pendingReanchor: Sample | null = null

  /** LOCKING 中に集めた detail.scale。中央値を採用し、ばらつきで収束を判定する。 */
  private scaleSamples: number[] = []
  /** 直近の観測から算出したスケール候補。確定時に frozenScale へ移す。 */
  private pendingScale: number | null = null
  /** 確定済みスケール。以後 SLAM が揺れても動かさない。 */
  private frozenScale: number | null = null

  private trackingStatus: TrackingStatusDetail['status'] = 'LIMITED'
  private lastImageEventAt = 0
  private stats: AnchorStats = {
    matchedTarget: '—',
    lastImageEvent: 'NONE',
    secSinceImageEvent: 0,
    sampleCount: 0,
    anchorPosition: null,
    anchorEulerDeg: null,
    lastDeltaPosCm: null,
    lastDeltaAngDeg: null,
    lastTargetScale: null,
    lastScaledWidth: null,
    appliedScale: null,
    outlineSizeCm: '—',
    scaleSpread: '—',
    reanchorCount: 0,
    correctionCount: 0,
  }

  private fadeTargets: Array<{material: Material; baseOpacity: number; baseTransparent: boolean}> = []

  constructor(
    private readonly anchorRoot: Object3D,
    private readonly content: Object3D,
    private readonly state: TrackingState,
    config: Partial<AnchorConfig> = {}
  ) {
    this.cfg = {...DEFAULT_ANCHOR_CONFIG, ...config}
    this.content.visible = false
    this.collectFadeTargets()
  }

  // ---------------------------------------------------------------- 8th Wall events

  onImageFound(detail: ImageTargetDetail): void {
    this.noteImageEvent('FOUND', detail)
    this.ingest(detail)
  }

  onImageUpdated(detail: ImageTargetDetail): void {
    this.noteImageEvent('UPDATED', detail)
    this.ingest(detail)
  }

  /**
   * 画像を見失った。**何もしない。**
   * visible を触らないことがこの実装の要点。
   */
  onImageLost(_detail: ImageTargetDetail): void {
    this.noteImageEvent('LOST', null)
    this.samples.length = 0
    if (!this.state.isAnchored && this.state.current === 'LOCKING') {
      this.state.set('SCANNING')
    }
  }

  onTrackingStatus(detail: TrackingStatusDetail): void {
    const {status, reason} = detail
    this.trackingStatus = status
    if (status === 'NORMAL') {
      if (this.state.current === 'DEGRADED' || this.state.current === 'RELOCALIZING') {
        this.state.set('ANCHORED')
      }
      return
    }
    if (status === 'LIMITED') {
      // モデルは消さない。UI を控えめに変えるだけ。
      if (this.state.isAnchored) {
        this.state.set(reason === 'RELOCALIZING' ? 'RELOCALIZING' : 'DEGRADED')
      }
      return
    }
    if (status === 'NOT_AVAILABLE') {
      // ワールドトラッキング自体が失われた場合のみ FAILED
      this.state.set('FAILED')
    }
  }

  // ---------------------------------------------------------------- per-frame

  update(dtSec: number): void {
    this.stats.secSinceImageEvent =
      this.lastImageEventAt === 0 ? 0 : (performance.now() - this.lastImageEventAt) / 1000

    this.updateFade(dtSec)
    this.updateCorrection(dtSec)
  }

  // ---------------------------------------------------------------- user actions

  /** 再スキャン: アンカーを破棄して SCANNING に戻す */
  rescan(): void {
    this.anchorPos = null
    this.anchorQuat = null
    this.correctionPos = null
    this.correctionQuat = null
    this.samples.length = 0
    this.scaleSamples.length = 0
    this.pendingReanchor = null
    this.fadePhase = 'none'
    this.frozenScale = null
    this.pendingScale = null
    this.content.visible = false
    this.setOpacity(1)
    this.stats.anchorPosition = null
    this.stats.anchorEulerDeg = null
    this.state.set('SCANNING')
  }

  /**
   * 再センター: 今見えている画像の姿勢へ即座に貼り直す。
   *
   * 注意: XR8.XrController.recenter() は *カメラ* を原点へ戻す API であり、
   * 呼ぶと anchorRoot のワールド座標が意味を失う。よってここでは使わない。
   */
  recenterToImage(): boolean {
    if (this.samples.length === 0) return false
    const pose = this.averageSamples(this.samples)
    this.freezeScale()
    this.commitAnchor(pose)
    this.correctionPos = null
    this.correctionQuat = null
    return true
  }

  getStats(): Readonly<AnchorStats> {
    return this.stats
  }

  /** 認識されたターゲットに応じて実寸を切り替える（複数ターゲット診断用） */
  setPhysicalSize(widthM: number, heightM: number): void {
    if (widthM > 0) this.cfg.physicalWidthM = widthM
    if (heightM > 0) this.cfg.physicalHeightM = heightM
  }

  // ---------------------------------------------------------------- internals

  private noteImageEvent(kind: AnchorStats['lastImageEvent'], detail: ImageTargetDetail | null): void {
    this.stats.lastImageEvent = kind
    this.lastImageEventAt = performance.now()
    if (detail) {
      this.stats.matchedTarget = detail.name
      this.stats.lastTargetScale = detail.scale ?? null
      this.stats.lastScaledWidth = detail.scaledWidth ?? null
    }
  }

  private ingest(detail: ImageTargetDetail): void {
    const sample: Sample = {
      position: new Vector3(detail.position.x, detail.position.y, detail.position.z),
      quaternion: new Quaternion(
        detail.rotation.x,
        detail.rotation.y,
        detail.rotation.z,
        detail.rotation.w
      ).normalize(),
    }

    if (this.state.isAnchored) {
      this.handleReobservation(sample)
      // 再アンカー候補として直近サンプルも保持しておく（再センター用）
      this.pushSample(sample, 12)
      return
    }

    // ワールド追跡が LIMITED でもサンプリングは進める。
    // 「NORMAL になるまで一切受け付けない」にしていたら初期化待ちが長すぎた（実機の指摘）。
    // 収束前の誤確定は下の isScaleConverged() が防ぐので、ここで止める必要はない。

    // --- LOCKING: 0.3〜0.5 秒ぶんのサンプルから安定した初期姿勢を決める ---
    if (this.state.current !== 'LOCKING') {
      this.samples.length = 0
      this.scaleSamples.length = 0
      this.lockStartedAt = performance.now()
      this.state.set('LOCKING')
    }
    this.pushSample(sample, 60)
    if (typeof detail.scale === 'number' && detail.scale > 0) {
      this.scaleSamples.push(detail.scale)
      if (this.scaleSamples.length > 60) this.scaleSamples.shift()
    }
    // 今フレームぶんを入れてから中央値を取り直す（measureSpread の単位換算にも使う）
    this.updateScaleEstimate(detail)

    const elapsed = performance.now() - this.lockStartedAt
    if (elapsed < this.cfg.lockDurationMs || this.samples.length < this.cfg.minSamples) return


    const pose = this.averageSamples(this.samples)
    const spread = this.measureSpread(this.samples, pose)
    if (spread.posM > this.cfg.maxPositionSpreadM || spread.angDeg > this.cfg.maxAngleSpreadDeg) {
      // まだ揺れている。溜め直す。
      this.samples.length = 0
      this.scaleSamples.length = 0
      this.lockStartedAt = performance.now()
      return
    }

    // スケール推定が収束していなければ確定しない。
    // ここを見ないと、揺れている最中の値で固定してアンカーが壊れる。
    if (!this.isScaleConverged()) {
      this.samples.length = 0
      this.scaleSamples.length = 0
      this.lockStartedAt = performance.now()
      return
    }

    this.freezeScale()
    this.commitAnchor(pose)
    this.content.visible = true
    this.setOpacity(1)
    this.state.set('ANCHORED')
  }

  /** 既にアンカー済みの状態で再び画像が見えたときの処理 */
  private handleReobservation(sample: Sample): void {
    if (!this.anchorPos || !this.anchorQuat) return
    if (this.fadePhase !== 'none') return

    const posDelta = this.worldToMeters(this.anchorPos.distanceTo(sample.position))
    const angDelta = (this.anchorQuat.angleTo(sample.quaternion) * 180) / Math.PI
    this.stats.lastDeltaPosCm = posDelta * 100
    this.stats.lastDeltaAngDeg = angDelta

    if (posDelta <= this.cfg.smallPosDeltaM && angDelta <= this.cfg.smallAngDeltaDeg) {
      // 小さいズレ → じわじわ補正
      this.correctionPos = sample.position.clone()
      this.correctionQuat = sample.quaternion.clone()
      this.stats.correctionCount++
      return
    }

    if (posDelta >= this.cfg.bigPosDeltaM || angDelta >= this.cfg.bigAngDeltaDeg) {
      // SLAM 初期化中の大きなズレは「ハガキが動かされた」ではなく
      // ワールド座標そのものが動いているだけ。ここで再アンカーすると
      // フェードが連発して見苦しい（実機で 10 回発生）。NORMAL のときだけ扱う。
      if (this.trackingStatus !== 'NORMAL') return

      // ハガキ自体が動かされた → スライドさせず、フェードして貼り直す
      this.pendingReanchor = sample
      this.fadePhase = 'out'
      this.fadeElapsed = 0
      this.correctionPos = null
      this.correctionQuat = null
      this.stats.reanchorCount++
    }
    // 中間帯（small超・big未満）は何もしない = チャタリング防止のデッドゾーン
  }

  private updateCorrection(dtSec: number): void {
    if (!this.correctionPos || !this.correctionQuat || !this.anchorPos || !this.anchorQuat) return
    if (this.fadePhase !== 'none') return

    // 60fps 基準の係数をフレームレート非依存にする
    const t = 1 - Math.pow(1 - this.cfg.correctionLerp, dtSec * 60)
    this.anchorPos.lerp(this.correctionPos, t)
    this.anchorQuat.slerp(this.correctionQuat, t)
    this.applyAnchorToRoot()

    if (
      this.worldToMeters(this.anchorPos.distanceTo(this.correctionPos)) < 0.0005 &&
      this.anchorQuat.angleTo(this.correctionQuat) < 0.001
    ) {
      this.correctionPos = null
      this.correctionQuat = null
    }
  }

  private updateFade(dtSec: number): void {
    if (this.fadePhase === 'none') return
    this.fadeElapsed += dtSec
    const t = Math.min(1, this.fadeElapsed / this.cfg.fadeDurationSec)

    if (this.fadePhase === 'out') {
      this.setOpacity(1 - t)
      if (t >= 1) {
        if (this.pendingReanchor) {
          this.commitAnchor(this.pendingReanchor)
          this.pendingReanchor = null
        }
        this.fadePhase = 'in'
        this.fadeElapsed = 0
      }
      return
    }

    this.setOpacity(t)
    if (t >= 1) {
      this.fadePhase = 'none'
      this.setOpacity(1)
    }
  }

  private commitAnchor(pose: Sample): void {
    this.anchorPos = pose.position.clone()
    this.anchorQuat = pose.quaternion.clone()
    this.applyAnchorToRoot()
  }

  /** ここが唯一 anchorRoot の transform を書き換える場所 */
  private applyAnchorToRoot(): void {
    if (!this.anchorPos || !this.anchorQuat) return
    this.anchorRoot.position.copy(this.anchorPos)
    this.anchorRoot.quaternion.copy(this.anchorQuat)
    this.anchorRoot.updateMatrixWorld(true)

    this.stats.anchorPosition = this.anchorRoot.position.clone()
    const e = this.anchorRoot.rotation
    this.stats.anchorEulerDeg = {
      x: (e.x * 180) / Math.PI,
      y: (e.y * 180) / Math.PI,
      z: (e.z * 180) / Math.PI,
    }
  }

  /**
   * 印刷物と 3D コンテンツの大きさを一致させる。
   *
   * 【実測で判明したこと】
   * image-target-cli が生成する JSON には物理サイズが一切入らない。
   * そのため:
   *   - `scaledWidth` は「高さを 1.0 に正規化したときの幅」= 3:4 なら常に 0.7500（定数）
   *   - `scale`       は SLAM が推定する実寸係数。**0.37 〜 1.04 と 2.8 倍も振れる**
   *
   * ターゲットのワールド上の幅 = scaledWidth × scale。
   * よってメートルで作ったコンテンツをターゲットに合わせる係数は
   *
   *     s = scale × scaledWidth / physicalWidthM
   *
   * `scale` を毎フレーム反映すると SLAM の揺れがそのままコンテンツの脈動と
   * アンカーのズレになるため、**姿勢を確定した瞬間の値で固定し、以後は動かさない**。
   * これは「一度決めたら動かさない」というこの設計全体の方針と一致する。
   */
  private updateScaleEstimate(detail: ImageTargetDetail): void {
    const sw = detail.scaledWidth
    if (typeof sw !== 'number' || !Number.isFinite(sw) || sw <= 0) return
    if (this.cfg.physicalWidthM <= 0) return
    // 単発の値ではなく、LOCKING 中に集めた中央値を使う（外れ値に強い）
    const sc = this.medianScale()
    if (sc === null) return
    this.pendingScale = (sc * sw) / this.cfg.physicalWidthM
  }

  private medianScale(): number | null {
    if (this.scaleSamples.length === 0) return null
    const sorted = [...this.scaleSamples].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  /**
   * SLAM のスケール推定が収束したか。
   * 収束前に確定すると、アンカー座標もコンテンツの大きさも壊れる
   * （実機実測: LIMITED/INITIALIZING 中に scale=3.92 で固定してしまい、
   *   適用スケール 33.056、再認識ズレ 14.89cm / 22.65° まで悪化した）。
   */
  private isScaleConverged(): boolean {
    if (this.scaleSamples.length < this.cfg.minSamples) {
      this.stats.scaleSpread = `n=${this.scaleSamples.length}`
      return false
    }
    const min = Math.min(...this.scaleSamples)
    const max = Math.max(...this.scaleSamples)
    if (min <= 0) return false
    const ratio = max / min
    this.stats.scaleSpread = `${ratio.toFixed(2)}x (<=${this.cfg.scaleStabilityRatio})`
    return ratio <= this.cfg.scaleStabilityRatio
  }

  /** 姿勢確定時に一度だけ呼ぶ。以後スケールは固定。 */
  private freezeScale(): void {
    if (this.pendingScale === null || !Number.isFinite(this.pendingScale)) return
    if (this.pendingScale <= 0) return
    this.frozenScale = this.pendingScale
    this.stats.appliedScale = this.frozenScale
    this.anchorRoot.scale.setScalar(this.frozenScale)

    // 枠がワールド上で何cmになっているかを出す。
    // scale:'absolute' ならこれが実寸のはず。定規で測った印刷物と突き合わせて検証する。
    const wCm = this.cfg.physicalWidthM * this.frozenScale * 100
    const hCm = this.cfg.physicalHeightM * this.frozenScale * 100
    this.stats.outlineSizeCm = `${wCm.toFixed(1)} x ${hCm.toFixed(1)} cm`
  }

  /**
   * ワールド単位の距離を実メートルへ戻す。
   *
   * anchorRoot.scale は「実メートル → ワールド単位」の変換係数なので、
   * 逆に割れば実寸に戻る。閾値を cm 感覚で書けるようにするために必要。
   * （これを忘れていたため、実質 1.2cm のズレで再アンカーが発動していた）
   */
  private worldToMeters(worldDistance: number): number {
    // LOCKING 中はまだ freeze していないので pendingScale を使う
    const s = this.frozenScale ?? this.pendingScale ?? this.anchorRoot.scale.x
    return s && s > 0 ? worldDistance / s : worldDistance
  }

  private pushSample(sample: Sample, max: number): void {
    this.samples.push(sample)
    if (this.samples.length > max) this.samples.shift()
    this.stats.sampleCount = this.samples.length
  }

  /** 位置は軸ごとの中央値、回転はクォータニオン平均（半球を揃えてから正規化） */
  private averageSamples(samples: Sample[]): Sample {
    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = sorted.length >> 1
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    const position = new Vector3(
      median(samples.map((s) => s.position.x)),
      median(samples.map((s) => s.position.y)),
      median(samples.map((s) => s.position.z))
    )

    const ref = samples[0].quaternion
    let x = 0
    let y = 0
    let z = 0
    let w = 0
    for (const s of samples) {
      const q = s.quaternion
      const sign = q.dot(ref) < 0 ? -1 : 1
      x += q.x * sign
      y += q.y * sign
      z += q.z * sign
      w += q.w * sign
    }
    const quaternion = new Quaternion(x, y, z, w).normalize()
    return {position, quaternion}
  }

  private measureSpread(samples: Sample[], center: Sample): {posM: number; angDeg: number} {
    let posWorld = 0
    let angRad = 0
    for (const s of samples) {
      posWorld = Math.max(posWorld, s.position.distanceTo(center.position))
      angRad = Math.max(angRad, s.quaternion.angleTo(center.quaternion))
    }
    // 閾値は実メートルで書いてあるので、ワールド単位から戻してから比較する
    return {posM: this.worldToMeters(posWorld), angDeg: (angRad * 180) / Math.PI}
  }

  // ---------------------------------------------------------------- fade helpers

  private collectFadeTargets(): void {
    this.fadeTargets = []
    this.content.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        this.fadeTargets.push({
          material,
          baseOpacity: (material as Material & {opacity: number}).opacity ?? 1,
          baseTransparent: material.transparent ?? false,
        })
      }
    })
  }

  /** content を再構成した場合に呼ぶ */
  refreshFadeTargets(): void {
    this.collectFadeTargets()
  }

  private setOpacity(alpha: number): void {
    const clamped = Math.max(0, Math.min(1, alpha))
    for (const target of this.fadeTargets) {
      const m = target.material as Material & {opacity: number}
      m.transparent = clamped < 1 ? true : target.baseTransparent
      m.opacity = target.baseOpacity * clamped
      m.needsUpdate = true
    }
  }
}
