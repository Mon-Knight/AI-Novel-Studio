import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

export interface PngVisualMetrics {
  width: number;
  height: number;
  meanLuminance: number;
  p10Luminance: number;
  medianLuminance: number;
  p90Luminance: number;
  opaqueRatio: number;
  coarseColorBuckets: number;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

function percentile(values: readonly number[], ratio: number): number {
  return values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0;
}

/** Decodes WebDriver's 8-bit RGB/RGBA, non-interlaced PNG screenshots without a new dependency. */
export function readPngVisualMetrics(filePath: string): PngVisualMetrics {
  const png = fs.readFileSync(filePath);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Theme screenshot is not a PNG: ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported theme screenshot PNG shape: ${filePath}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bytesPerPixel || idat.length === 0) {
    throw new Error(`Unsupported theme screenshot PNG color type: ${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);
  if (raw.length !== expectedLength) {
    throw new Error(`Theme screenshot PNG payload length mismatch: ${filePath}`);
  }
  const rows: Buffer[] = [];
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = raw[rawOffset] ?? 0;
    rawOffset += 1;
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? (row[index - bytesPerPixel] ?? 0) : 0;
      const above = previous[index] ?? 0;
      const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : filter === 4
                  ? paeth(left, above, upperLeft)
                  : Number.NaN;
      if (!Number.isFinite(predictor)) throw new Error(`Unsupported PNG filter ${filter}.`);
      row[index] = ((row[index] ?? 0) + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
  }

  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 100_000)));
  const luminance: number[] = [];
  const buckets = new Set<number>();
  let opaqueSamples = 0;
  for (let y = 0; y < height; y += sampleStep) {
    const row = rows[y];
    if (!row) continue;
    for (let x = 0; x < width; x += sampleStep) {
      const pixel = x * bytesPerPixel;
      const red = row[pixel] ?? 0;
      const green = row[pixel + 1] ?? 0;
      const blue = row[pixel + 2] ?? 0;
      const alpha = bytesPerPixel === 4 ? (row[pixel + 3] ?? 0) : 255;
      if (alpha >= 250) opaqueSamples += 1;
      luminance.push((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255);
      buckets.add(
        (Math.floor(red / 16) << 8) | (Math.floor(green / 16) << 4) | Math.floor(blue / 16),
      );
    }
  }
  luminance.sort((left, right) => left - right);
  const sampleCount = luminance.length;
  if (sampleCount === 0) throw new Error(`Theme screenshot has no pixels: ${filePath}`);
  return {
    width,
    height,
    meanLuminance: luminance.reduce((sum, value) => sum + value, 0) / sampleCount,
    p10Luminance: percentile(luminance, 0.1),
    medianLuminance: percentile(luminance, 0.5),
    p90Luminance: percentile(luminance, 0.9),
    opaqueRatio: opaqueSamples / sampleCount,
    coarseColorBuckets: buckets.size,
  };
}
