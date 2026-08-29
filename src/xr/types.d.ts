/**
 * 8th Wall Distributed Engine Binary の最小型定義。
 * 公式の .d.ts が同梱されていないため、使用する範囲だけを自前で宣言する。
 * 出典: https://8thwall.org/docs/api/engine/xrcontroller/configure
 *       https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule
 */
import type {Scene, PerspectiveCamera, WebGLRenderer} from 'three'

export interface Vec3 {x: number; y: number; z: number}
export interface Quat {w: number; x: number; y: number; z: number}

/** reality.imagefound / imageupdated / imagelost の payload */
export interface ImageTargetDetail {
  name: string
  type: 'FLAT' | 'CYLINDRICAL' | 'CONICAL'
  position: Vec3
  rotation: Quat
  scale: number
  scaledWidth?: number
  scaledHeight?: number
  height?: number
  radiusTop?: number
  radiusBottom?: number
  arcStartRadians?: number
  arcLengthRadians?: number
}

export type TrackingStatus = 'NORMAL' | 'LIMITED' | 'NOT_AVAILABLE'

export interface TrackingStatusDetail {
  status: TrackingStatus
  reason?: string
}

export interface CameraStatusDetail {
  status: 'requesting' | 'hasStream' | 'hasVideo' | 'failed' | string
}

export interface PipelineModuleEvent<T = unknown> {
  name: string
  detail: T
}

export interface PipelineModule {
  name: string
  onStart?: (args: {canvas: HTMLCanvasElement; canvasWidth: number; canvasHeight: number}) => void
  onUpdate?: (args: unknown) => void
  onException?: (error: unknown) => void
  onCameraStatusChange?: (args: CameraStatusDetail) => void
  listeners?: Array<{event: string; process: (event: PipelineModuleEvent<any>) => void}>
}

export interface XrControllerConfig {
  disableWorldTracking?: boolean
  enableLighting?: boolean
  enableWorldPoints?: boolean
  imageTargetData?: unknown[]
  leftHandedAxes?: boolean
  mirroredDisplay?: boolean
  scale?: 'responsive' | 'absolute'
}

export interface XR8Api {
  addCameraPipelineModules(modules: unknown[]): void
  addCameraPipelineModule(module: unknown): void
  run(args: {canvas: HTMLCanvasElement; allowedDevices?: string}): void
  stop(): void
  pause(): void
  resume(): void
  loadChunk(name: string): Promise<void>
  GlTextureRenderer: {pipelineModule(): unknown}
  Threejs: {
    pipelineModule(): unknown
    xrScene(): {scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer}
  }
  XrController: {
    pipelineModule(): unknown
    configure(config: XrControllerConfig): void
    recenter(): void
  }
  XrDevice: {
    isDeviceBrowserCompatible(): boolean
    /** 数値コードの配列を返す（IncompatibilityReasons 参照） */
    incompatibleReasons(): number[]
    incompatibleReasonDetails?: () => unknown
    /** {UNSPECIFIED:0, UNSUPPORTED_OS:1, UNSUPPORTED_BROWSER:2, MISSING_DEVICE_ORIENTATION:3, MISSING_USER_MEDIA:4, MISSING_WEB_ASSEMBLY:5} */
    IncompatibilityReasons: Record<string, number>
    deviceEstimate(): {
      locale?: string
      os?: string
      osVersion?: string
      manufacturer?: string
      model?: string
      browser?: {name?: string; fullName?: string; version?: string; majorVersion?: number}
    }
  }
  version(): string
  CanvasScreenshot?: {pipelineModule(): unknown}
}

declare global {
  interface Window {
    XR8?: XR8Api
    XRExtras?: unknown
  }
}
