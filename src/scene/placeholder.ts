import {
  AxesHelper,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  ConeGeometry,
} from 'three'
import {TARGET} from '../config'

/**
 * Phase 2 の検証用プレースホルダ。人物もGLBも使わない。
 * ここに置くのは「空間に固定されているか」を目で判定できる最小の形だけ。
 *
 *  - 座標軸 10cm        … どの軸が紙から立ち上がるかが分かる
 *  - 立方体 3cm         … 位置が分かる
 *  - ターゲット実寸の枠  … 印刷物とピタリ重なるかが分かる
 *  - 前方を示す矢印      … 上下・前後の取り違えが分かる
 *
 * 【座標系の前提】
 * FLAT な画像ターゲットのローカル系は「画像面 = XY 平面、+Z が紙から手前へ」
 * であると仮定している。8th Wall の公式資料に明記がないため、Phase 2 の初回起動時に
 * AxesHelper（X:赤 / Y:緑 / Z:青）を見て実測で確認する。
 * 違っていた場合に直す箇所は下の OUT_AXIS 関連だけで済むようにしてある。
 */

/** 紙から立ち上がる方向のオフセットを作る（仮定: +Z） */
function outward(distanceM: number): [number, number, number] {
  return [0, 0, distanceM]
}

export function createPlaceholderContent(): Group {
  const content = new Group()
  content.name = 'placeholder-content'

  // --- 座標軸 (X:赤 Y:緑 Z:青) 10cm ---
  const axes = new AxesHelper(0.1)
  content.add(axes)

  // --- ターゲット実寸の枠（印刷物とピタリ重なるべき平面）---
  // PlaneGeometry は既に XY 平面にあるので回転させない。
  const outline = new Mesh(
    new PlaneGeometry(TARGET.physicalWidthM, TARGET.physicalHeightM),
    new MeshBasicMaterial({color: 0x00e5ff, wireframe: true})
  )
  outline.name = 'target-outline'
  content.add(outline)

  // --- 立方体 3cm。紙面から 1.5cm 浮かせて置く ---
  const cube = new Mesh(
    new BoxGeometry(0.03, 0.03, 0.03),
    new MeshStandardMaterial({color: 0xff7043, roughness: 0.6, metalness: 0.0})
  )
  cube.name = 'debug-cube'
  cube.position.set(...outward(0.015))
  content.add(cube)

  // 立方体の稜線。カメラを動かしたとき立体か平面かが一目で分かる。
  const cubeEdges = new LineSegments(
    new EdgesGeometry(cube.geometry),
    new LineBasicMaterial({color: 0x2b2b2b})
  )
  cubeEdges.position.copy(cube.position)
  content.add(cubeEdges)

  // --- ターゲットの +Y 方向（画像の「上」のはず）を示す矢印 ---
  const arrow = new Mesh(
    new ConeGeometry(0.008, 0.025, 12),
    new MeshBasicMaterial({color: 0xffd54f})
  )
  const [, , arrowOut] = outward(0.004)
  arrow.position.set(0, TARGET.physicalHeightM / 2 + 0.02, arrowOut)
  // ConeGeometry は +Y が先端。そのまま +Y を指す。
  content.add(arrow)

  return content
}
