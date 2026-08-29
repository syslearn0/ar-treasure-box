/**
 * スマホ実機で検証するための HTTPS 開発サーバー。
 *
 * 8th Wall はデスクトップOSを非対応(UNSUPPORTED_OS)として弾くため、
 * AR の動作確認は必ず実機で行う必要がある。そして getUserMedia は
 * HTTPS（または localhost）でしか動かないので、LAN 越しに実機から
 * 開くには HTTPS が要る。
 *
 * 自己署名証明書なので、スマホ側で「安全ではない」警告を一度許可する。
 * 許可が通らない場合は Cloudflare Tunnel など正式な証明書を使う経路に切り替える。
 */
process.env.VITE_HTTPS = '1'

const {createServer} = await import('vite')
const server = await createServer()
await server.listen()
server.printUrls()
console.log('')
console.log('スマホから上の Network の https://... を開いてください。')
console.log('証明書の警告は「詳細」→「アクセスする」で進めます。')
