/**
 * GLB（箱＋キャラクター＋紙）を読み込み、Intro を1回・Idle をループ再生する。
 *
 * Blender 側は1本のタイムラインに Intro と Idle を並べてあり、
 * glTF はオブジェクトごとに別クリップとして出る（実測: 7本）。
 * よって AnimationUtils.subclip でフレーム範囲を切り出し、
 * すべて同じ AnimationMixer で同時に再生する。
 */
import {
  AnimationMixer,
  AnimationUtils,
  Group,
  LoopOnce,
  LoopRepeat,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type AnimationAction,
  type Object3D,
} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Blender のフレーム範囲（work/blender/07_idle_animation.py と一致させること） */
const FPS = 30
const INTRO = {start: 1, end: 195}
const IDLE = {start: 196, end: 315}

export interface AvatarOptions {
  url: string
  /** 画像ターゲットの中心から見た、箱の中心のオフセット（メートル） */
  offset: {x: number; y: number; z: number}
  /** 印刷された箱とモデルの箱の大きさを合わせる倍率 */
  scale?: number
  /** カード法線まわりの向き（ラジアン）。0 か Math.PI で表裏が入れ替わる。 */
  spinRad?: number
  /** 紙メッシュに貼るテクスチャ（Web側で生成した日本語メッセージ） */
  paperTexture?: import('three').Texture
  onProgress?: (ratio: number) => void
}

export class Avatar {
  readonly root = new Group()
  private mixer: AnimationMixer | null = null
  private introActions: AnimationAction[] = []
  private idleActions: AnimationAction[] = []
  private switched = false
  private started = false

  constructor() {
    this.root.name = 'avatarRoot'
    this.root.visible = false
  }

  async load(opts: AvatarOptions): Promise<void> {
    const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
      (resolve, reject) => {
        new GLTFLoader().load(
          opts.url,
          resolve,
          (e) => {
            if (e.total > 0) opts.onProgress?.(e.loaded / e.total)
          },
          reject
        )
      }
    )

    const model = gltf.scene

    // 向きの合わせ方は入れ子のグループで表現する。
    // Euler の適用順で悩まないようにするため、1グループ1回転にしている。
    //
    //   pivot : 位置合わせ（追跡領域の中心 → 箱の中心）
    //     spin: カードの法線(Z)まわりの向き。カードのどちら側から見るかで決まる。
    //           QRのある側（手前）から見るのが自然なので、そちらを正面にする。
    //       stand: X軸まわり +90°。モデルの上(+Y)を紙から立ち上げる
    //         model
    //
    // glTF は Y-up（Blender の (X,Y,Z) → glTF の (X,Z,-Y)）。
    // 画像ターゲットのローカル系は「紙面 = XY、+Z が紙から手前」（Phase 2a で実測）。
    const stand = new Group()
    stand.name = 'avatarStand'
    stand.rotation.x = Math.PI / 2
    stand.add(model)

    const spin = new Group()
    spin.name = 'avatarSpin'
    spin.rotation.z = opts.spinRad ?? 0
    spin.add(stand)

    const pivot = new Group()
    pivot.name = 'avatarPivot'
    pivot.position.set(opts.offset.x, opts.offset.y, opts.offset.z)
    // 印刷された箱とモデルの箱の大きさを合わせる
    pivot.scale.setScalar(opts.scale ?? 1)
    pivot.add(spin)

    this.root.add(pivot)

    if (opts.paperTexture) this.applyPaperTexture(model, opts.paperTexture)
    this.setupInterior(model)
    this.setupAnimation(gltf.animations, model)
  }

  /**
   * 紙メッシュに日本語メッセージのテクスチャを貼る。
   *
   * 紙は1枚のポリゴンなので、裏から見ると文字は必ず鏡像になる。
   * 向きは spin グループ（法線まわり180°）で合わせてあるが、
   * 万一裏返って見えた場合に備えて両面表示にし、
   * U を反転できる逃げ道も用意しておく。
   */
  private applyPaperTexture(model: Object3D, tex: import('three').Texture): void {
    model.traverse((o) => {
      if (o.name !== 'Chr_Paper') return
      const mesh = o as Mesh
      const mat = mesh.material
      if (Array.isArray(mat)) return
      const m = mat as import('three').MeshStandardMaterial
      m.map = tex
      m.side = DoubleSide   // 裏から見ても消えないように
      m.needsUpdate = true
    })
  }

  /**
   * 箱の内部を暗くする。
   *
   * 当初は colorWrite:false の純粋なオクルーダーにしていたが、
   * それだと「何も描かない」＝カメラ映像がそのまま見えてしまい、
   * 箱の中が透けているように見えた（実機で発覚）。
   *
   * 不透明な暗いマテリアルにすれば、下半身を隠す役目は果たしつつ
   * 「箱の中が暗い」という見た目になる。
   * 照明の影響を受けない Basic にして、環境光によらず確実に暗くする。
   */
  private setupInterior(model: Object3D): void {
    model.traverse((o) => {
      if (o.name !== 'Box_Interior_Occluder') return
      const mesh = o as Mesh
      mesh.material = new MeshBasicMaterial({color: 0x0a0a0c})
    })
  }

  private setupAnimation(clips: import('three').AnimationClip[], model: Object3D): void {
    if (clips.length === 0) return
    this.mixer = new AnimationMixer(model)

    for (const clip of clips) {
      const intro = AnimationUtils.subclip(clip, `${clip.name}_Intro`, INTRO.start, INTRO.end, FPS)
      const idle = AnimationUtils.subclip(clip, `${clip.name}_Idle`, IDLE.start, IDLE.end, FPS)

      const ia = this.mixer.clipAction(intro)
      ia.setLoop(LoopOnce, 1)
      ia.clampWhenFinished = true
      this.introActions.push(ia)

      const da = this.mixer.clipAction(idle)
      da.setLoop(LoopRepeat, Infinity)
      this.idleActions.push(da)
    }

    // Intro が終わったら Idle へ繋ぐ
    this.mixer.addEventListener('finished', () => {
      if (this.switched) return
      this.switched = true
      for (let i = 0; i < this.idleActions.length; i++) {
        const idle = this.idleActions[i]
        idle.reset()
        idle.play()
        this.introActions[i].crossFadeTo(idle, 0.3, false)
      }
    })
  }

  /** アンカー確定時に呼ぶ。Intro を頭から1回だけ再生する。 */
  playIntro(): void {
    this.root.visible = true
    this.started = true
    this.switched = false
    for (const a of this.idleActions) a.stop()
    for (const a of this.introActions) {
      a.reset()
      a.play()
    }
  }

  get isPlaying(): boolean {
    return this.started
  }

  update(dtSec: number): void {
    this.mixer?.update(dtSec)
  }
}
