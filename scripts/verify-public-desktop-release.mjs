import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const repository = 'yuchen0x1/Novel-Writer-master'
const api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }))

const release = api('releases/latest')
const tag = release.tag_name
const version = tag.match(/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/)?.[1]
if (!version || release.draft !== false || release.prerelease !== false) {
  throw Error('The latest release is not a stable semantic version')
}
const profile = JSON.parse(readFileSync('.release/release-profile.json', 'utf8'))
const expected = profile.releaseAssets.map(asset => asset.name.replaceAll('{version}', version))
const assets = new Map(release.assets.map(asset => [asset.name, asset]))
if (assets.size !== expected.length + 1) throw Error('Unexpected public release asset inventory')

async function download(name, expectedHash, capture = false) {
  const asset = assets.get(name)
  const url = `https://github.com/${repository}/releases/download/${tag}/${name}`
  if (!asset || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
    || (expectedHash && asset.digest !== `sha256:${expectedHash}`)) {
    throw Error(`Invalid GitHub asset metadata: ${name}`)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || !response.body) throw Error(`${name}: HTTP ${response.status}`)

  const hash = createHash('sha256')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > asset.size || (capture && size > 65_536)) throw Error(`Oversized asset: ${name}`)
    hash.update(chunk)
    if (capture) chunks.push(chunk)
  }
  if (size !== asset.size || size === 0 || `sha256:${hash.digest('hex')}` !== asset.digest) {
    throw Error(`Public download bytes differ from metadata: ${name}`)
  }
  console.log(`PASS ${name} (${size} bytes)`)
  return capture ? Buffer.concat(chunks).toString('utf8') : undefined
}

const sums = await download('SHA256SUMS.txt', undefined, true)
const hashes = new Map()
for (const row of sums.trim().split(/\r?\n/)) {
  const [, hash, name] = /^([a-f0-9]{64}) {2}(.+)$/.exec(row) ?? []
  if (!expected.includes(name) || hashes.has(name)) throw Error('Invalid release checksum entry')
  hashes.set(name, hash)
}
if (hashes.size !== expected.length) throw Error('Release checksum list is incomplete')

for (const name of expected) {
  const capture = name === 'latest.yml' || name.endsWith('.dmg.sha256')
  const content = await download(name, hashes.get(name), capture)
  if (name === 'latest.yml') {
    const manifestVersion = content.match(/^version:\s+([\d.]+)\r?$/m)?.[1]
    const installer = `Novel-Writer-master-setup-${version}.exe`
    if (manifestVersion !== version || !content.includes(`path: ${installer}`)) {
      throw Error('Windows update manifest does not match the release')
    }
  } else if (name.endsWith('.dmg.sha256')) {
    const dmg = name.slice(0, -'.sha256'.length)
    if (content.trim() !== `${hashes.get(dmg)}  ${dmg}`) {
      throw Error(`Invalid macOS installer checksum: ${name}`)
    }
  }
}
console.log(`Verified ${release.html_url}`)
