/**
 * 差し替えポイントを1箇所に集約する。
 * 中身を変えるときは、原則このファイルだけを書き換えれば済む。
 */

export interface TargetConfig {
  /** image-target-cli で付けたターゲット名（reality.imagefound の detail.name と一致させる） */
  name: string
  /** ターゲット JSON の URL（相対パス） */
  url: string
  /** 実物の横幅(m)。デバッグ表示のガイド枠と、後段の 3D 箱のスケール合わせに使う */
  physicalWidthM: number
  /** 実物の高さ(m) */
  physicalHeightM: number
}

// ---------------------------------------------------------------- カードの実寸

/**
 * ★ここが最重要★
 *
 * 目の前にある**カードの追跡領域（枠の外側）の実寸の横幅**をメートルで書く。
 * 定規で測って入れること。目分量だと 3D の箱が絵と重ならない。
 *
 *   タブレットの画面に表示する場合 … 画面上で測った幅（表示倍率で変わる）
 *   紙に印刷した場合               … 印刷物の幅（既定のレイアウトなら 0.088）
 *
 * この 1 つを直せば、下のターゲット定義もキャラクターの位置と大きさも
 * すべて追従する。個別に直す必要はない。
 *
 * 【実測】**実寸が認識距離を決める。** 同じ絵でも幅 48mm では極端に近づかないと
 * 認識できず（カメラがピントを合わせられない）、幅 83mm にしたら即座に認識した。
 * 大きく映せるならその方がよい。
 */
const CARD_WIDTH_M = 0.088

/**
 * 以下は scripts/make-postcard.mjs のレイアウトから来る比率。
 * 絵そのものを描き直さない限り、触る必要はない。
 */
/** 追跡領域の 高さ ÷ 幅。image-target-cli が縦3:4を強制するので固定 */
const CARD_ASPECT = 4 / 3
/** 描かれた箱の幅 ÷ 追跡領域の幅 */
const BOX_WIDTH_RATIO = 78 / 88
/** 追跡領域の中心から見た、箱の中心の上方向オフセット ÷ 追跡領域の幅 */
const BOX_OFFSET_Y_RATIO = 15.5 / 88
/** Blender で作った箱モデルの実寸の幅(m)。モデルを作り直したらここも直す */
const MODEL_BOX_WIDTH_M = 0.086

// ---------------------------------------------------------------- ターゲット

/**
 * 【重要】@8thwall/image-target-cli は FLAT ターゲットのクロップを
 * 3:4（縦）または 4:3（横）に *強制* する（CLI ソースで実測）。
 * physicalWidthM / physicalHeightM は必ずこの比率に合わせること。
 *
 * 【実測で判明】`--landscape`（isRotated: True）で作ったターゲットは、
 * このエンジンでは **一度も認識されなかった**。
 * 縦3:4（isRotated: False）だけを使う。
 *
 * 複数のカードを同時に載せて、当たった `detail.name` で内容を出し分けることもできる。
 * その場合はこの配列に足すだけでよい（3件同時までは実機で確認済み。上限は未計測）。
 */
export const TARGETS: TargetConfig[] = [
  {
    name: 'card',
    url: './image-targets/card.json',
    physicalWidthM: CARD_WIDTH_M,
    physicalHeightM: CARD_WIDTH_M * CARD_ASPECT,
  },
]

/** 既定（後方互換用） */
export const TARGET: TargetConfig = TARGETS[0]

/**
 * カメラ映像を画面にどう収めるか。
 *
 *   contain … 映像の全体を等倍で映す。上下（または左右）に黒帯が出る
 *   cover   … 画面いっぱいに広げる。はみ出した部分は切り落とされる
 *
 * 【なぜ既定が contain なのか — エンジンの実装を読んで確認】
 * 8th Wall の映像描画はキャンバスを **覆うように** 拡大して中央で切り取る。
 * スマホの画面は縦長（19.5:9 など）でカメラは 4:3 なので、画面いっぱいの
 * キャンバスにすると左右が大きく切られ、**1.5〜1.6倍に寄った映像**になる。
 * 迫力は出るが、カードを画面に収めるのが難しくなり「認識しない」の主因になる。
 */
export const CAMERA_FIT: 'contain' | 'cover' = 'contain'

/**
 * URL のクエリで真偽を上書きする。`?debug=1` / `?debug=0` のように使う。
 * スマホでは設定ファイルを書き換えにくいので、その場で切り替えられるようにしておく。
 */
function urlFlag(name: string): boolean | null {
  const v = new URLSearchParams(location.search).get(name)
  if (v === null) return null
  return v !== '0' && v !== 'false'
}

/**
 * デバッグ HUD（画面左上の数値）を出すか。
 * 本番ビルドでは VITE_DEBUG を未設定にする。`?debug=0` で消せる。
 */
export const DEBUG = urlFlag('debug') ?? (import.meta.env.VITE_DEBUG === '1' || import.meta.env.DEV)

/**
 * 位置合わせ用の目印（座標軸・追跡領域の枠・向きを示す矢印・立方体）を出すか。
 *
 * 開発中に「空間に固定できているか」を目で確かめるためのもの。
 * **既定は false。** キャラクターと重なって見えるので、ふつうは出さない。
 * URL に `?guides=1` を付けると、書き換えずに一時的に出せる。
 */
export const SHOW_GUIDES = urlFlag('guides') ?? false

// ---------------------------------------------------------------- 中身

/**
 * 紙に表示するメッセージ。GLB には焼き込まず、Web 側の CanvasTexture で描く。
 * ここを書き換えるだけで文面を差し替えられる。Blender を開く必要はない。
 */
export const MESSAGE = {
  /** 左右反転 */
  flipX: false,
  /** 上下反転 */
  flipY: true,

  // --- 文面（ここを書き換えるだけで差し替わる） ---
  /** 見出しの上に小さく出る一言。空文字なら出ない */
  label: 'MESSAGE',
  /** いちばん大きく出る一行 */
  heading: 'ありがとう',
  /** 見出しの下に続く行。何行でもよいが、増えるほど小さくなる */
  lines: [],
}

/** キャラクターのGLB */
export const AVATAR = {
  url: './assets/postcard_proxy.glb',
  /**
   * 追跡領域の中心から見た、箱の中心のオフセット（メートル）。
   * 追跡領域は縦3:4で箱より広いので、その中で箱がどこにあるかを指定する。
   *
   * x: 右が＋ / y: 上が＋ / z: カードから手前に浮かせる方向が＋
   */
  offset: {x: 0, y: CARD_WIDTH_M * BOX_OFFSET_Y_RATIO, z: 0},
  /**
   * 絵に描かれた箱と、Blender のモデルの箱の大きさを合わせる倍率。
   * 自分のモデルに差し替えたなら MODEL_BOX_WIDTH_M を直すか、
   * ここを 1 にして実寸で作り直すのが分かりやすい。
   */
  scale: (CARD_WIDTH_M * BOX_WIDTH_RATIO) / MODEL_BOX_WIDTH_M,
  /**
   * カードの法線まわりの向き。
   * 0       = カードの手前側（QRのある側）から見て正面
   * Math.PI = カードの上側から見て正面
   * 後ろを向いていたらここを Math.PI にする。
   */
  spinRad: 0,
}
