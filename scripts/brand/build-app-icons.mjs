// 从 build/icon.ico 的产品源图标同步生成 Windows、macOS、Linux 与前端图标。
// 统一为圆角透明画布，避免源图四角的不透明深色背景形成黑色方边。
// 用法：npx electron scripts/brand/build-app-icons.mjs
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { app, nativeImage } from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceIcoPath = path.join(root, 'build/icon.ico')
const sourceIco = readFileSync(sourceIcoPath)

const ICNS_ENTRIES = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
]

function readIcoFrames(file) {
  if (file.readUInt16LE(0) !== 0 || file.readUInt16LE(2) !== 1) throw new Error(`${sourceIcoPath} 不是有效 ICO`)
  const count = file.readUInt16LE(4)
  const frames = new Map()
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16
    const size = file[entry] || 256
    const length = file.readUInt32LE(entry + 8)
    const offset = file.readUInt32LE(entry + 12)
    const png = file.subarray(offset, offset + length)
    if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a') continue
    const image = nativeImage.createFromBuffer(png)
    const dimensions = image.getSize()
    if (dimensions.width !== size || dimensions.height !== size) {
      throw new Error(`ICO ${size}px 帧的图像尺寸为 ${dimensions.width}×${dimensions.height}`)
    }
    frames.set(size, png)
  }
  if (!frames.has(256)) throw new Error(`${sourceIcoPath} 缺少 256px PNG 图标帧`)
  return frames
}

const sourceFrames = readIcoFrames(sourceIco)

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)]
  return distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : upLeft
}

function decodePng(png) {
  const chunks = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) })
    offset += length + 12
    if (type === 'IEND') break
  }
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR')?.data
  if (!ihdr) throw new Error('PNG 缺少 IHDR')
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (bitDepth !== 8 || channels === 0 || ihdr[12] !== 0) throw new Error('只支持 8 位 RGB/RGBA 非隔行 PNG 图标')
  const stride = width * channels
  const packed = inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)))
  const decoded = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1)
    const filter = packed[rowOffset]
    if (filter > 4) throw new Error(`不支持 PNG 行过滤器 ${filter}`)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] : 0
      const up = y > 0 ? decoded[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? decoded[(y - 1) * stride + x - channels] : 0
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]
      decoded[y * stride + x] = (packed[rowOffset + 1 + x] + predictor) & 0xff
    }
  }
  const pixels = Buffer.alloc(width * height * 4)
  const transparentColor = colorType === 2 ? chunks.find(chunk => chunk.type === 'tRNS')?.data : undefined
  for (let index = 0; index < width * height; index++) {
    const input = index * channels
    const output = index * 4
    pixels[output] = decoded[input]
    pixels[output + 1] = decoded[input + 1]
    pixels[output + 2] = decoded[input + 2]
    pixels[output + 3] = channels === 4 ? decoded[input + 3] : 255
    if (transparentColor?.length >= 6 && decoded[input] === transparentColor.readUInt16BE(0) && decoded[input + 1] === transparentColor.readUInt16BE(2) && decoded[input + 2] === transparentColor.readUInt16BE(4)) pixels[output + 3] = 0
  }
  return { width, height, ihdr, chunks, pixels }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function encodeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBytes, data])
  let crc = 0xffffffff
  for (const byte of crcInput) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8)
  return chunk
}

function encodePng({ width, height, ihdr: sourceIhdr, chunks, pixels }) {
  const ihdr = Buffer.from(sourceIhdr)
  ihdr[9] = 6
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const metadata = chunks.filter(chunk => !['IHDR', 'IDAT', 'IEND', 'tRNS'].includes(chunk.type)).map(chunk => encodeChunk(chunk.type, chunk.data))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    encodeChunk('IHDR', ihdr),
    ...metadata,
    encodeChunk('IDAT', deflateSync(rows)),
    encodeChunk('IEND', Buffer.alloc(0)),
  ])
}

function roundCorners(png, size) {
  const image = decodePng(png)
  if (image.width !== size || image.height !== size) throw new Error(`图标帧尺寸与 ICO 声明不符：${image.width}×${image.height}，声明 ${size}×${size}`)
  const corners = [0, size - 1].flatMap(y => [0, size - 1].map(x => image.pixels[(y * size + x) * 4 + 3]))
  // 已修过的图标保持不变，避免重复生成时反复柔化抗锯齿边缘。
  if (corners.every(alpha => alpha === 0)) return nativeImage.createFromBuffer(png).toPNG()
  const half = size / 2
  const radius = size * 0.16
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const qx = Math.abs(x + 0.5 - half) - (half - radius)
      const qy = Math.abs(y + 0.5 - half) - (half - radius)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      const distance = outside + Math.min(Math.max(qx, qy), 0) - radius
      const coverage = Math.max(0, Math.min(1, 0.5 - distance))
      const alphaIndex = (y * size + x) * 4 + 3
      image.pixels[alphaIndex] = Math.round(image.pixels[alphaIndex] * coverage)
    }
  }
  // 在 16px 帧中，圆弧的亚像素覆盖率会让最外侧角点残留少量深色；角点本身必须完全透明。
  for (const index of [0, size - 1, (size - 1) * size, size * size - 1]) image.pixels[index * 4 + 3] = 0
  return nativeImage.createFromBuffer(encodePng(image)).toPNG()
}

function encodeIco(frames) {
  const directory = Buffer.alloc(6 + frames.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(frames.length, 4)
  let offset = directory.length
  for (const [index, { size, png }] of frames.entries()) {
    const entry = 6 + index * 16
    directory.writeUInt8(size === 256 ? 0 : size, entry)
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  }
  return Buffer.concat([directory, ...frames.map(frame => frame.png)])
}

function icns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

async function main() {
  const roundedFrames = new Map()
  for (const [size, png] of sourceFrames) roundedFrames.set(size, await roundCorners(png, size))

  const renderRounded = size => {
    const sourceSize = roundedFrames.has(size) ? size : 256
    const image = nativeImage.createFromBuffer(roundedFrames.get(sourceSize))
    return (sourceSize === size ? image : image.resize({ width: size, height: size, quality: 'best' })).toPNG()
  }

  writeFileSync(sourceIcoPath, encodeIco([...roundedFrames].map(([size, png]) => ({ size, png }))))
  const mac = new Map()
  for (const size of new Set(ICNS_ENTRIES.map(([, size]) => size))) mac.set(size, renderRounded(size))

  writeFileSync(path.join(root, 'build/icon.icns'), icns(ICNS_ENTRIES.map(([type, size]) => ({ type, png: mac.get(size) }))))
  writeFileSync(path.join(root, 'build/icon.png'), renderRounded(512))
  const appIcon = roundedFrames.get(256)
  writeFileSync(path.join(root, 'src/assets/brand/novel-writer-master-icon.png'), appIcon)
  writeFileSync(path.join(root, 'public/novel-writer-master-icon.png'), appIcon)
  console.log('build/icon.ico、build/icon.icns、build/icon.png 与前端图标已同步并添加透明圆角')
}

app.whenReady().then(main).then(() => app.exit(0), error => {
  console.error(error)
  app.exit(1)
})
