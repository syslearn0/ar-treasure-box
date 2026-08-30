/**
 * 開発サーバー用の自己署名証明書を作る。
 *
 * 【なぜ @vitejs/plugin-basic-ssl を使わないのか — 実測で判明】
 * basic-ssl が作る証明書の SAN（対象ホスト）は
 *
 *     DNS:localhost, DNS:[::1], IP Address:127.0.0.1, IP Address:FE80::1
 *
 * だけで、**LAN の IP アドレスが入らない**。
 * PC のブラウザは名前不一致の警告を押し通せるが、iOS / iPadOS の Safari は
 * 名前が一致しない自己署名証明書を素通りさせない。結果、
 * 「PCでは開けるのにスマホ・タブレットでは開けない」になる（実機で確認）。
 *
 * そこで、この端末が持つ **すべてのローカル IPv4 を SAN に入れた**証明書を自前で作る。
 * これで名前は一致するので、あとは「発行元が信頼できない」警告を一度許可するだけで通る。
 *
 * 【それでも残ること】
 * 自己署名なので警告そのものは消えない。消したい場合は正式な証明書が要る
 * （公開サーバーに置くか、トンネルを使う）。
 *
 * 出力: node_modules/.cache/dev-cert/{key.pem, cert.pem}
 *   - IP の顔ぶれが変わったら作り直す（テザリングとWi-Fiを行き来しても追従する）
 *
 * 【有効期間】Apple は 2020-09-01 以降に発行された TLS サーバー証明書に
 * **398 日以下**という上限を課している。これを超えると iOS が拒否する。
 * selfsigned 5.x が実際に何日で作るかは版に依存するので、作ったあとに検査する。
 */
import os from 'node:os'
import path from 'node:path'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import selfsigned from 'selfsigned'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'node_modules', '.cache', 'dev-cert')
const keyPath = path.join(dir, 'key.pem')
const certPath = path.join(dir, 'cert.pem')
const stampPath = path.join(dir, 'hosts.json')

const DAYS = 30

/** この端末で待ち受けうるアドレスを全部集める */
export function localAddresses() {
  const v4 = []
  const v6 = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.internal) continue
      if (ni.family === 'IPv4') v4.push(ni.address)
      else if (ni.family === 'IPv6') v6.push(ni.address.replace(/%.*$/, ''))
    }
  }
  return {v4: [...new Set(v4)].sort(), v6: [...new Set(v6)].sort()}
}

function buildAltNames({v4, v6}) {
  // type 2 = DNS / 7 = IP
  const alt = [
    {type: 2, value: 'localhost'},
    {type: 2, value: os.hostname()},
    {type: 7, ip: '127.0.0.1'},
    {type: 7, ip: '::1'},
  ]
  for (const ip of v4) alt.push({type: 7, ip})
  for (const ip of v6) alt.push({type: 7, ip})
  return alt
}

/**
 * 証明書を用意して返す。既にあって条件が変わっていなければ作り直さない。
 * @returns {Promise<{key: Buffer, cert: Buffer, hosts: string[], regenerated: boolean}>}
 */
export async function ensureDevCert() {
  const addrs = localAddresses()
  const hosts = ['localhost', '127.0.0.1', ...addrs.v4]
  const stamp = JSON.stringify({v4: addrs.v4, v6: addrs.v6, days: DAYS})

  if (existsSync(keyPath) && existsSync(certPath) && existsSync(stampPath)) {
    const prev = await readFile(stampPath, 'utf8').catch(() => '')
    if (prev === stamp) {
      // 期限も見る。切れていたら作り直す。
      const pem = await readFile(certPath, 'utf8')
      const {X509Certificate} = await import('node:crypto')
      try {
        const x = new X509Certificate(pem)
        if (new Date(x.validTo).getTime() - Date.now() > 24 * 3600 * 1000) {
          return {
            key: await readFile(keyPath),
            cert: await readFile(certPath),
            hosts,
            regenerated: false,
          }
        }
      } catch {
        /* 読めなければ作り直す */
      }
    }
  }

  // selfsigned 5.x の generate は Promise を返す（3.x は同期だった）
  const pems = await selfsigned.generate(
    [
      {name: 'commonName', value: 'localhost'},
      {name: 'organizationName', value: 'WebAR Dev'},
    ],
    {
      days: DAYS,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {name: 'basicConstraints', cA: false},
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true,
        },
        {name: 'extKeyUsage', serverAuth: true},
        {name: 'subjectAltName', altNames: buildAltNames(addrs)},
      ],
    }
  )

  // Apple の上限（398日）を超えていないか、出来上がったものを実際に測って確かめる。
  // selfsigned の days オプションが版によって効かないことがあるため、宣言ではなく実測する。
  {
    const {X509Certificate} = await import('node:crypto')
    const x = new X509Certificate(pems.cert)
    const days = (new Date(x.validTo) - new Date(x.validFrom)) / 86400000
    if (days > 398) {
      throw new Error(
        `証明書の有効期間が ${Math.round(days)} 日あります。` +
          'iOS は 398 日を超える TLS サーバー証明書を拒否します。'
      )
    }
  }

  await mkdir(dir, {recursive: true})
  await writeFile(keyPath, pems.private)
  await writeFile(certPath, pems.cert)
  await writeFile(stampPath, stamp)

  return {
    key: Buffer.from(pems.private),
    cert: Buffer.from(pems.cert),
    hosts,
    regenerated: true,
  }
}

// 直接実行されたときは、作って中身を表示する
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dev-cert.mjs')) {
  const {hosts, regenerated} = await ensureDevCert()
  console.log(`[dev-cert] ${regenerated ? '作成しました' : '既存のものを使います'}`)
  console.log(`[dev-cert] 対象ホスト: ${hosts.join(', ')}`)
  console.log(`[dev-cert] 置き場所  : node_modules/.cache/dev-cert/`)
}
