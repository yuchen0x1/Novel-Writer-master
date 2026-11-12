import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

interface Frame { name: string, png: Buffer, fullBleed: boolean }

function icoFrames(file: Buffer): Frame[] {
  return Array.from({ length: file.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16
    const start = file.readUInt32LE(entry + 12)
    return { name: `ico ${file[entry] || 256}px`, png: file.subarray(start, start + file.readUInt32LE(entry + 8)), fullBleed: true }
  })
}

function icnsFrames(file: Buffer): Frame[] {
  const frames: Frame[] = []
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset + 4)
    frames.push({ name: `icns ${file.toString('ascii', offset, offset + 4)}`, png: file.subarray(offset + 8, offset + length), fullBleed: false })
    offset += length
  }
  return frames
}

/** 解 8 位 RGB/RGBA、非隔行的 PNG，返回每个像素的 alpha。 */
function decodeAlpha(png: Buffer) {
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0
  if (png[24] !== 8 || channels === 0 || png[28] !== 0) throw new Error('只支持 8 位 RGB/RGBA 非隔行 PNG')
  const idat: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      const paeth = () => {
        const p = left + up - upLeft
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
        return a <= b && a <= c ? left : b <= c ? up : upLeft
      }
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter]
      pixels[y * stride + x] = (value + predictor) & 0xff
    }
  }
  return { width, height, alpha: (x: number, y: number) => channels === 4 ? pixels[y * stride + x * channels + 3] : 255 }
}

function opaqueBounds(png: Buffer) {
  const { width, height, alpha } = decodeAlpha(png)
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha(x, y) === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  const corners = [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)]
  return {
    width,
    height,
    corners,
    centerAlpha: alpha(Math.floor(width / 2), Math.floor(height / 2)),
    margins: { left, top, right: width - 1 - right, bottom: height - 1 - bottom },
  }
}

const buildDir = resolve(process.cwd(), 'build')
const rendererIcon = readFileSync(resolve(process.cwd(), 'src/assets/brand/novel-writer-master-icon.png'))
const publicIcon = readFileSync(resolve(process.cwd(), 'public/novel-writer-master-icon.png'))
const sourceIcon = readFileSync(resolve(buildDir, 'icon.ico'))
const windowIcon = readFileSync(resolve(buildDir, 'icon.png'))
const frames = [
  ...icoFrames(sourceIcon),
  ...icnsFrames(readFileSync(resolve(buildDir, 'icon.icns'))),
  { name: 'window png', png: windowIcon, fullBleed: false },
]

describe('build/ 下提交的应用图标', () => {
  it('应用窗口、安装包与前端使用同一份用户提供的新图标', () => {
    expect(rendererIcon.equals(publicIcon)).toBe(true)
    expect(icoFrames(sourceIcon).find(frame => frame.name === 'ico 256px')?.png.equals(rendererIcon)).toBe(true)
  })

  it.each(frames)('$name 的图形完整居中，没有被截掉', ({ png, fullBleed }) => {
    const { width, corners, centerAlpha, margins } = opaqueBounds(png)

    expect(margins.right, '图形为空').toBeLessThan(width)
    expect(Math.abs(margins.top - margins.bottom), `上下留白 ${margins.top}/${margins.bottom}`).toBeLessThanOrEqual(1)
    expect(Math.abs(margins.left - margins.right), `左右留白 ${margins.left}/${margins.right}`).toBeLessThanOrEqual(1)
    if (fullBleed) expect(margins).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(corners, '圆角外侧四角透明，不能留下黑色方底').toEqual([0, 0, 0, 0])
    expect(centerAlpha, '图标主体仍然可见').toBe(255)
  })
})
