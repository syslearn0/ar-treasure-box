import * as THREE from 'three'
import {AmbientLight, DirectionalLight, Group} from 'three'
import {AVATAR, CAMERA_FIT, DEBUG, MESSAGE, SHOW_GUIDES, TARGET, TARGETS} from './config'
import {checkCompatibility, loadImageTargets, waitForXR8} from './xr/engineLoader'
import {ImageAnchor} from './xr/imageAnchor'
import {TrackingState} from './xr/trackingState'
import type {
  CameraStatusDetail,
  ImageTargetDetail,
  PipelineModule,
  PipelineModuleEvent,
  TrackingStatusDetail,
  XR8Api,
} from './xr/types'
import {createPlaceholderContent} from './scene/placeholder'
import {Avatar} from './scene/avatar'
import {createMessageTexture} from './scene/messageTexture'
import {DebugHud} from './ui/debugHud'
import {Overlay} from './ui/overlay'
import './style.css'

/**
 * 8th Wall の Threejs パイプラインモジュールは `window.THREE` をグローバル参照する
 * （実測エラー: "window.THREE does not exist but is required by the ThreeJS pipeline module"）。
 *
 * ES モジュールで import しただけでは window に生えないので、明示的に載せる。
 * 名前空間ごと同じインスタンスを渡すことが重要 — 別インスタンスだと、8th Wall が
 * 生成した Scene / Camera と、こちらが import したクラスとで instanceof が食い違う。
 *
 * XR8.Threejs.pipelineModule() より前に実行される必要があるため、モジュール先頭で行う。
 */
;(window as unknown as {THREE: typeof THREE}).THREE = THREE

const state = new TrackingState()
let anchor: ImageAnchor | null = null
let hud: DebugHud | null = null
let overlay: Overlay | null = null
let lastTracking: TrackingStatusDetail | null = null
let targetsLoaded = false
let deviceLabel = 'unknown'
let lastFrameTime = performance.now()
let engineVersionLabel = '@8thwall/engine-binary 1.0.0'
let watchdog = 0
let avatar: Avatar | null = null

/**
 * iPhone では devtools を開けないため、詰まった箇所を画面に出せるよう
 * 起動シーケンスの通過点を記録しておく。
 */
const diag: Record<string, string> = {
  engine: '未',
  compat: '未',
  targets: '未',
  permission: '未',
  cameraStatus: '未',
  run: '未',
  onStart: '未',
  avatar: '未',
}

function diagText(): string {
  return Object.entries(diag)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function boot(): void {
  overlay = new Overlay({
    onStart: () => {
      // ★ここが重要★
      // iOS Safari は getUserMedia にユーザージェスチャ起点を要求する。
      // await を1つでも挟んでから呼ぶとジェスチャの文脈が切れ、許可ダイアログすら
      // 出ないまま無言で失敗する。よって click ハンドラの *同期的な* 先頭で
      // カメラ許可を要求し、その Promise を非同期処理へ引き渡す。
      const permission = requestCameraPermission()
      void start(permission)
    },
    onRescan: () => anchor?.rescan(),
    onRecenter: () => {
      if (!anchor?.recenterToImage()) {
        overlay?.setProgress('箱を画面に映してから、もう一度押してください')
      }
    },
  })
  if (DEBUG) hud = new DebugHud()

  state.onChange((next, prev) => {
    overlay?.render(next)
    if (next === 'ANCHORED' && prev === 'LOCKING') {
      overlay?.anchorFeedback()
      // アンカーが決まった瞬間に Intro を1回だけ再生する
      if (avatar && !avatar.isPlaying) avatar.playIntro()
    }
  })
  state.set('BOOT')
  overlay.render('BOOT')
}

/**
 * canvas のバッキングストアを画面サイズへ合わせる。
 *
 * これを XR8.run() の *前* にやらないと、canvas は既定の 300x150 のままで、
 * 8th Wall の Threejs モジュールが renderer.setSize(300, 150) を呼び、
 * インラインスタイルに width:300px / height:150px を焼き付けてしまう。
 * 結果としてカメラ映像が画面左上の小さな矩形にだけ描かれる（実機で確認）。
 *
 * DPR は 2 で頭打ちにする。iPad の 3x をそのまま使うと塗りつぶし負荷が
 * 跳ね上がり、30fps 目標を割りやすいため。
 */
const MAX_DPR = 2

/**
 * カメラ映像の縦横比（videoWidth / videoHeight）。
 * onVideoSizeChange が来るまでは不明なので 0。
 */
let videoAspect = 0

/**
 * ★等倍表示の仕組み★
 *
 * 8th Wall の映像描画（GlTextureRenderer）は、キャンバスを **覆うように**
 * 拡大して中央で切り取る（エンジンの実装を読んで確認）。
 * 画面いっぱいのキャンバスにすると左右が切られ、寄った映像になる。
 *
 * エンジン側に「はみ出さずに収める」指定は無く、改変も禁止されている。
 * そこで **キャンバスの縦横比を映像の縦横比に一致させる**。
 * 一致すれば切り取り量が 0 になり、映像は等倍で全体が映る。
 * 余った領域は黒帯になるので、キャンバスは画面の中央に置く（CSS の margin:auto）。
 */
function sizeCanvasToWindow(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
  let cssW = window.innerWidth
  let cssH = window.innerHeight

  if (CAMERA_FIT === 'contain' && videoAspect > 0) {
    if (cssW / cssH > videoAspect) {
      cssW = Math.round(cssH * videoAspect)
    } else {
      cssH = Math.round(cssW / videoAspect)
    }
  }

  const w = Math.round(cssW * dpr)
  const h = Math.round(cssH * dpr)

  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

/** onVideoSizeChange から呼ぶ。比率が変わったときだけ組み直す。 */
function applyVideoAspect(videoWidth: number, videoHeight: number): void {
  if (!(videoWidth > 0 && videoHeight > 0)) return
  const next = videoWidth / videoHeight
  if (Math.abs(next - videoAspect) < 0.001) return
  videoAspect = next
  const canvas = document.getElementById('camerafeed') as HTMLCanvasElement | null
  if (canvas) sizeCanvasToWindow(canvas)
}

/**
 * カメラ許可だけを取る。ストリームは即座に解放する
 * （実際のカメラ制御は 8th Wall が自前で行うため、掴んだままだと競合しうる）。
 */
function requestCameraPermission(): Promise<void> {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) {
    return Promise.reject(new Error('このブラウザではカメラAPI(getUserMedia)が使えません'))
  }
  return md
    .getUserMedia({video: {facingMode: 'environment'}, audio: false})
    .then((stream) => {
      for (const track of stream.getTracks()) track.stop()
    })
}

async function start(permission: Promise<void>): Promise<void> {
  state.set('LOADING')
  overlay?.setProgress('ARエンジンを読み込んでいます…')

  // 許可ダイアログが出ている間に落ちても未処理拒否にならないようにする
  permission.catch(() => undefined)

  let XR8: XR8Api
  try {
    XR8 = await waitForXR8()
    diag.engine = 'OK'
  } catch (e) {
    diag.engine = `失敗 ${String(e)}`
    overlay?.showError(
      `ARエンジンを読み込めませんでした。通信環境を確認して再読み込みしてください。\n\n${diagText()}`
    )
    return
  }

  const compat = checkCompatibility(XR8)
  deviceLabel = compat.device
  try {
    engineVersionLabel = `engine-binary 1.0.0 (xr ${XR8.version()})`
  } catch {
    /* version() が無い版は既定ラベルのまま */
  }
  if (!compat.compatible) {
    diag.compat = compat.reasons.join(' / ')
    overlay?.showError(
      `このブラウザではARを表示できません。\n${compat.reasons.join('\n')}\n\niPhone/iPad は Safari、Android は Chrome でお試しください。`
    )
    return
  }
  diag.compat = `OK (${compat.device})`

  // --- カメラ許可 ---
  state.set('PERMISSION')
  overlay?.setProgress('カメラの使用を許可してください')
  try {
    await permission
    diag.permission = 'granted'
  } catch (e) {
    diag.permission = `denied ${String(e)}`
    overlay?.showError(
      'カメラを使用できませんでした。\n\n' +
        'Safari の設定 →「Webサイトの設定」→「カメラ」で許可するか、\n' +
        'ページを再読み込みして「許可」を選んでください。\n\n' +
        diagText()
    )
    return
  }

  state.set('LOADING')
  overlay?.setProgress('画像ターゲットを読み込んでいます…')
  let imageTargetData: unknown[]
  try {
    imageTargetData = await loadImageTargets(TARGETS.map((t) => t.url))
    targetsLoaded = true
    diag.targets = 'OK'
  } catch (e) {
    diag.targets = `失敗 ${String(e)}`
    overlay?.showError(`画像ターゲットを読み込めませんでした。\n\n${diagText()}`)
    return
  }

  overlay?.setProgress('カメラを準備しています…')

  const canvas = document.getElementById('camerafeed') as HTMLCanvasElement | null
  if (!canvas) {
    overlay?.showError('canvas 要素が見つかりません')
    return
  }

  // ★ run() より前に必ず実行する
  sizeCanvasToWindow(canvas)
  const onResize = () => sizeCanvasToWindow(canvas)
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)

  try {
    // SLAM を有効にしたまま画像ターゲットを使う。
    // scale:'absolute' → 座標がメートル単位で返る（実寸合わせのため必須）
    XR8.XrController.configure({
      disableWorldTracking: false,
      scale: 'absolute',
      imageTargetData,
    })

    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      appPipelineModule(XR8),
    ])

    XR8.run({canvas})
    diag.run = 'called'
  } catch (e) {
    diag.run = `例外 ${String(e)}`
    overlay?.showError(`ARを開始できませんでした。\n\n${diagText()}`)
    return
  }

  // onStart が来ないまま固まった場合に、原因を画面へ出す
  watchdog = window.setTimeout(() => {
    if (state.current === 'LOADING' || state.current === 'PERMISSION') {
      overlay?.showError(
        'カメラの起動が完了しませんでした。\n' +
          'ページを再読み込みしてもう一度お試しください。\n\n' +
          diagText()
      )
    }
  }, 15000)
}

/**
 * 認識されたターゲットに応じて実寸を切り替える。
 * 診断中は複数ターゲットを同時に載せており、それぞれ物理サイズが違うため。
 */
let activeTargetName = ''
function applyTargetSize(name: string): void {
  if (name === activeTargetName) return
  const t = TARGETS.find((x) => x.name === name)
  if (!t) return
  activeTargetName = name
  anchor?.setPhysicalSize(t.physicalWidthM, t.physicalHeightM)
}

function appPipelineModule(XR8: XR8Api): PipelineModule {
  return {
    name: 'ar-postcard',

    onStart() {
      diag.onStart = 'OK'
      window.clearTimeout(watchdog)

      const {scene, camera, renderer} = XR8.Threejs.xrScene()

      renderer.outputColorSpace = 'srgb'
      camera.position.set(0, 2, 0)

      scene.add(new AmbientLight(0xffffff, 1.2))
      const sun = new DirectionalLight(0xffffff, 1.6)
      sun.position.set(0.5, 1.2, 0.8)
      scene.add(sun)

      // ★ anchorRoot は scene 直下。画像ターゲットの子には *しない*。
      const anchorRoot = new Group()
      anchorRoot.name = 'anchorRoot'
      scene.add(anchorRoot)

      // 位置合わせ用の目印。既定では出さない（キャラクターと重なるため）。
      // URL に ?guides=1 を付けるか、config.ts の SHOW_GUIDES で出せる。
      const content = SHOW_GUIDES ? createPlaceholderContent() : new Group()
      anchorRoot.add(content)

      avatar = new Avatar()
      anchorRoot.add(avatar.root)
      overlay?.setProgress('モデルを読み込んでいます…')
      void avatar
        .load({
          url: AVATAR.url,
          offset: AVATAR.offset,
          scale: AVATAR.scale,
          spinRad: AVATAR.spinRad,
          paperTexture: createMessageTexture({
            label: MESSAGE.label,
            heading: MESSAGE.heading,
            lines: MESSAGE.lines,
            flipX: MESSAGE.flipX,
            flipY: MESSAGE.flipY,
          }),
          onProgress: (r) => overlay?.setProgress(`モデルを読み込んでいます… ${Math.round(r * 100)}%`),
        })
        .then(() => {
          diag.avatar = 'OK'
          // アンカーが既に決まっていたらすぐ再生する
          if (state.isAnchoredNow) avatar?.playIntro()
        })
        .catch((e) => {
          diag.avatar = `失敗 ${String(e)}`
          overlay?.showError(`モデルを読み込めませんでした。

${diagText()}`)
        })

      anchor = new ImageAnchor(anchorRoot, content, state, {
        physicalWidthM: TARGET.physicalWidthM,
        physicalHeightM: TARGET.physicalHeightM,
      })
      activeTargetName = ''


      state.set('SCANNING')
      lastFrameTime = performance.now()
    },

    onUpdate() {
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastFrameTime) / 1000)
      lastFrameTime = now

      anchor?.update(dt)
      avatar?.update(dt)
      overlay?.tick(dt, state.current)

      if (hud && anchor) {
        const c = document.getElementById('camerafeed') as HTMLCanvasElement | null
        hud.update(dt, state.current, lastTracking, anchor.getStats(), {
          device: deviceLabel,
          targetsLoaded,
          engineVersion: engineVersionLabel,
          canvas: c
            ? `${c.width}x${c.height} / css ${c.clientWidth}x${c.clientHeight} / win ${window.innerWidth}x${window.innerHeight}`
            : '—',
        })
      }
    },

    /**
     * カメラの解像度が決まった / 変わったときに呼ばれる。
     * ここでキャンバスの縦横比を映像に合わせて、切り取りを無くす。
     */
    onVideoSizeChange({videoWidth, videoHeight}: {videoWidth: number; videoHeight: number}) {
      applyVideoAspect(videoWidth, videoHeight)
    },

    onCameraStatusChange({status}: CameraStatusDetail) {
      diag.cameraStatus = status
      if (status === 'requesting') {
        overlay?.setProgress('カメラの使用を許可してください')
      } else if (status === 'hasStream') {
        overlay?.setProgress('カメラを起動しています…')
      } else if (status === 'failed') {
        window.clearTimeout(watchdog)
        overlay?.showError(
          'カメラを起動できませんでした。\n' +
            'ブラウザの設定でカメラを許可し、ページを再読み込みしてください。\n\n' +
            diagText()
        )
      }
    },

    onException(error: unknown) {
      console.error('[XR8]', error)
      window.clearTimeout(watchdog)
      overlay?.showError(`ARの実行中にエラーが発生しました。\n${String(error)}\n\n${diagText()}`)
    },

    listeners: [
      {
        event: 'reality.imagefound',
        process: ({detail}: PipelineModuleEvent<ImageTargetDetail>) => {
          applyTargetSize(detail.name)
          anchor?.onImageFound(detail)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({detail}: PipelineModuleEvent<ImageTargetDetail>) => {
          applyTargetSize(detail.name)
          anchor?.onImageUpdated(detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({detail}: PipelineModuleEvent<ImageTargetDetail>) => {
          anchor?.onImageLost(detail)
        },
      },
      {
        event: 'reality.trackingstatus',
        process: ({detail}: PipelineModuleEvent<TrackingStatusDetail>) => {
          lastTracking = detail
          anchor?.onTrackingStatus(detail)
        },
      },
    ],
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, {once: true})
} else {
  boot()
}
