/**
 * GLB 再生検証ページ（開発専用。本番ビルドには含めない）
 *
 * 確認したいこと:
 *   1. ボーンペアレントされたパーツが動くか
 *   2. Shape Key（モーフターゲット）が動くか
 *   3. オブジェクトのスケール・移動アニメーションが動くか
 *
 * Blender の SCENE モード書き出しでもアニメーションは1本にまとまらず、
 * オブジェクトごとに分かれる（実測: 5本）。よって全クリップを
 * 同じ AnimationMixer で同時に再生する。タイムラインは同一なので同期する。
 *
 * Intro と Idle も1本のタイムライン上に並んでいるため、
 * AnimationUtils.subclip でフレーム範囲を切り出して分ける。
 * GLB は1つのまま「Introは1回・Idleはループ」を実現できる。
 */
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
} from 'three'
import {AnimationUtils, LoopOnce, LoopRepeat} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js'

const GLB_URL = './assets/postcard_proxy.glb'

// Blender のフレーム範囲（07_idle_animation.py と一致させること）
const FPS = 30
const INTRO = {start: 1, end: 195}
const IDLE = {start: 196, end: 315}

const log = (msg: string) => {
  const el = document.getElementById('log')
  if (el) el.textContent += msg + '\n'
  console.log(msg)
}

const renderer = new WebGLRenderer({antialias: true})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new Scene()
scene.background = new Color(0x2a2d33)

const camera = new PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.001, 10)
camera.position.set(0.20, 0.13, 0.22)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.05, 0)
controls.update()

scene.add(new AmbientLight(0xffffff, 1.6))
const sun = new DirectionalLight(0xffffff, 2.2)
sun.position.set(0.2, 0.4, 0.3)
scene.add(sun)

const grid = new GridHelper(0.4, 20, 0x555555, 0x3a3a3a)
scene.add(grid)

let mixer: AnimationMixer | null = null
const actions: AnimationAction[] = []
let duration = 0

new GLTFLoader().load(
  GLB_URL,
  (gltf) => {
    scene.add(gltf.scene)

    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    log(`読み込み成功`)
    log(`バウンディング: ${(size.x * 1000).toFixed(1)} x ${(size.y * 1000).toFixed(1)} x ${(size.z * 1000).toFixed(1)} mm`)
    log(`クリップ数: ${gltf.animations.length}`)

    mixer = new AnimationMixer(gltf.scene)

    const introActions: AnimationAction[] = []
    const idleActions: AnimationAction[] = []

    for (const clip of gltf.animations) {
      const intro = AnimationUtils.subclip(clip, `${clip.name}_Intro`, INTRO.start, INTRO.end, FPS)
      const idle = AnimationUtils.subclip(clip, `${clip.name}_Idle`, IDLE.start, IDLE.end, FPS)
      duration = Math.max(duration, intro.duration)

      const ia = mixer.clipAction(intro)
      ia.setLoop(LoopOnce, 1)
      ia.clampWhenFinished = true
      introActions.push(ia)

      const da = mixer.clipAction(idle)
      da.setLoop(LoopRepeat, Infinity)
      idleActions.push(da)

      log(`  ${clip.name}: Intro ${intro.duration.toFixed(2)}s / Idle ${idle.duration.toFixed(2)}s`)
    }

    actions.push(...introActions, ...idleActions)

    // Intro を1回再生し、終わったら Idle へクロスフェード
    for (const a of introActions) a.play()
    let switched = false
    mixer.addEventListener('finished', () => {
      if (switched) return
      switched = true
      for (const a of idleActions) {
        a.reset()
        a.play()
      }
      for (const a of introActions) a.crossFadeTo(idleActions[introActions.indexOf(a)], 0.25, false)
      log('Intro 終了 → Idle へ移行')
    })

    // モーフターゲットが実際に載っているか確認
    gltf.scene.traverse((o) => {
      const m = o as unknown as {morphTargetInfluences?: number[]; morphTargetDictionary?: Record<string, number>; name: string}
      if (m.morphTargetInfluences?.length) {
        log(`  モーフ: ${m.name} → ${Object.keys(m.morphTargetDictionary ?? {}).join(', ')}`)
      }
    })

    const slider = document.getElementById('seek') as HTMLInputElement | null
    if (slider) slider.max = String(duration)
  },
  undefined,
  (err) => log(`読み込み失敗: ${String(err)}`)
)

// 検証用にシーンを外から触れるようにする（開発ページ限定）
;(window as unknown as Record<string, unknown>).__test = {scene, getMixer: () => mixer}

const clock = new Clock()
let paused = false

document.getElementById('btn-pause')?.addEventListener('click', () => {
  paused = !paused
  const b = document.getElementById('btn-pause')
  if (b) b.textContent = paused ? '再生' : '一時停止'
})

const slider = document.getElementById('seek') as HTMLInputElement | null
slider?.addEventListener('input', () => {
  if (!mixer) return
  paused = true
  const b = document.getElementById('btn-pause')
  if (b) b.textContent = '再生'
  mixer.setTime(Number(slider.value))
})

function tick() {
  requestAnimationFrame(tick)
  const dt = clock.getDelta()
  if (mixer && !paused) {
    mixer.update(dt)
    if (slider) slider.value = String(mixer.time % (duration || 1))
  }
  const t = document.getElementById('time')
  if (t && mixer) t.textContent = `${(mixer.time % (duration || 1)).toFixed(2)}s / ${duration.toFixed(2)}s`
  controls.update()
  renderer.render(scene, camera)
}
tick()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
