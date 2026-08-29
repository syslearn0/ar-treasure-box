import type {XR8Api} from './types'

/**
 * index.html の <script src="./external/xr/xr.js" async data-preload-chunks="slam">
 * が読み終わるのを待つ。読み込み完了時に window へ 'xrloaded' が発火する。
 */
export function waitForXR8(timeoutMs = 20000): Promise<XR8Api> {
  return new Promise((resolve, reject) => {
    if (window.XR8) {
      resolve(window.XR8)
      return
    }
    const timer = window.setTimeout(() => {
      window.removeEventListener('xrloaded', onLoaded)
      reject(new Error(`XR エンジンの読み込みがタイムアウトしました (${timeoutMs}ms)`))
    }, timeoutMs)

    function onLoaded() {
      window.clearTimeout(timer)
      if (window.XR8) {
        resolve(window.XR8)
      } else {
        reject(new Error("'xrloaded' は発火しましたが window.XR8 が存在しません"))
      }
    }
    window.addEventListener('xrloaded', onLoaded, {once: true})
  })
}

export interface CompatibilityResult {
  compatible: boolean
  reasons: string[]
  device: string
}

/**
 * incompatibleReasons() は数値コードを返す。
 * 実測した enum: XR8.XrDevice.IncompatibilityReasons
 *   {UNSPECIFIED:0, UNSUPPORTED_OS:1, UNSUPPORTED_BROWSER:2,
 *    MISSING_DEVICE_ORIENTATION:3, MISSING_USER_MEDIA:4, MISSING_WEB_ASSEMBLY:5}
 */
const REASON_TEXT: Record<number, string> = {
  0: '原因不明の非対応',
  1: 'このOSは対応していません（PCのデスクトップOSは非対応です）',
  2: 'このブラウザは対応していません',
  3: '端末の向きセンサー（deviceorientation）が使えません',
  4: 'カメラAPI（getUserMedia）が使えません',
  5: 'WebAssembly が使えません',
}

/** 端末・ブラウザが 8th Wall の要件を満たすか（iOS Safari 16.4+ / WASM SIMD など） */
export function checkCompatibility(XR8: XR8Api): CompatibilityResult {
  let compatible = false
  let reasons: string[] = []
  try {
    compatible = XR8.XrDevice.isDeviceBrowserCompatible()
    if (!compatible) {
      const codes = XR8.XrDevice.incompatibleReasons() ?? []
      reasons = codes.map((c) => REASON_TEXT[c as unknown as number] ?? `非対応コード ${String(c)}`)
    }
  } catch (e) {
    reasons = [`互換性チェックに失敗: ${String(e)}`]
  }
  return {compatible, reasons, device: describeDevice(XR8)}
}

/** デバッグHUD・計測記録用の端末名 */
export function describeDevice(XR8: XR8Api): string {
  try {
    const est = XR8.XrDevice.deviceEstimate()
    const os = [est.os, est.osVersion].filter(Boolean).join(' ')
    const browser = est.browser ? `${est.browser.name} ${est.browser.version ?? ''}`.trim() : ''
    const model = [est.manufacturer, est.model].filter(Boolean).join(' ')
    return [model, os, browser].filter(Boolean).join(' / ') || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 画像ターゲット JSON を読み込む。CLI (@8thwall/image-target-cli) が生成したもの。 */
export async function loadImageTargets(urls: string[]): Promise<unknown[]> {
  const results = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`画像ターゲットの読み込みに失敗: ${url} (HTTP ${res.status})`)
      }
      return res.json()
    })
  )
  return results
}
