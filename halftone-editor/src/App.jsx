import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialRoot, DialStore, useDialKit } from 'dialkit';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import 'dialkit/styles.css';

const PANEL_NAME = 'Mono Halftone';

const DEFAULT_SETTINGS = {
  dotSize: 30,
  angle: 0,
  contrast: 0,
  spread: 0,
  shape: 'Circle',
  preset: 'Classic',
  pageBackground: '#f2f1e8',
  paperColor: '#f2f1e8',
  inkColor: '#2b2b2b',
  colorMode: false,
  inverted: false,
  smoothing: 0,
  ditherType: 'None',
  grainMixer: 0,
  grainOverlay: 0,
  grainSize: 0
};

const DEFAULT_ZOOM = 0.5;

const COLOR_PRESETS = [
  { name: 'Classic', paperColor: '#FFFFFF', inkColor: '#000000' },
  { name: 'Soft Gray', paperColor: '#FFFFFF', inkColor: '#3D3D3D' },
  { name: 'Noir', paperColor: '#0F1115', inkColor: '#F6F7F8' },
  { name: 'Sepia', paperColor: '#F1E7D2', inkColor: '#5D422E' },
  { name: 'Cobalt', paperColor: '#E8EEFF', inkColor: '#1E2A86' },
  { name: 'Forest', paperColor: '#EEF6EA', inkColor: '#234B2E' },
  { name: 'Sunset', paperColor: '#FFE9D8', inkColor: '#B0452A' },
  { name: 'Neon', paperColor: '#111018', inkColor: '#4DFF9A' },
  { name: 'Lavender', paperColor: '#F0EAFF', inkColor: '#5E3FA0' },
  { name: 'Cyanotype', paperColor: '#DDF6FF', inkColor: '#0E5268' },
  { name: 'Ruby', paperColor: '#FFE8EC', inkColor: '#8A1E3A' }
];

const ACTION_PATHS = {
  uploadMedia: 'Media.uploadMedia',
  resetSettings: 'resetSettings',
  openExport: 'openExport',
  resetView: 'resetView',
  matchPageToPaper: 'Style.matchPageToPaper'
};

const VIEW_LIMITS = {
  minZoom: 0.25,
  maxZoom: 4
};

const EXPORT_TYPES = {
  png: 'png',
  gif: 'gif',
  mp4: 'mp4',
  htmlJsBg: 'htmlJsBg',
  reactComponent: 'reactComponent'
};

const EXPORT_TYPE_LABELS = {
  [EXPORT_TYPES.png]: 'PNG',
  [EXPORT_TYPES.gif]: 'GIF',
  [EXPORT_TYPES.mp4]: 'MP4 Video',
  [EXPORT_TYPES.htmlJsBg]: 'HTML + JS BG',
  [EXPORT_TYPES.reactComponent]: 'React Component'
};

const EXPORT_TYPE_META = {
  [EXPORT_TYPES.png]: 'High-res still export',
  [EXPORT_TYPES.gif]: 'Animated image sequence',
  [EXPORT_TYPES.mp4]: 'High-res browser video',
  [EXPORT_TYPES.htmlJsBg]: 'Standalone web background',
  [EXPORT_TYPES.reactComponent]: 'Reusable JSX export'
};

const EXPORT_TAB_ORDER = [
  EXPORT_TYPES.png,
  EXPORT_TYPES.htmlJsBg,
  EXPORT_TYPES.reactComponent,
  EXPORT_TYPES.gif,
  EXPORT_TYPES.mp4
];

const EXPORT_RESOLUTION_OPTIONS = [
  { value: 'source', label: 'Source' },
  { value: '320', label: '320p' },
  { value: '480', label: '480p' },
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' }
];

const VIDEO_QUALITY_BITRATES = {
  low: 2_500_000,
  medium: 5_000_000,
  high: 9_000_000
};

const VIDEO_QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
];

const KEYBOARD_ZOOM_STEP = 1.1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}

function wait(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function sanitizeFileName(name, fallback = 'halftone-export') {
  const trimmed = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
  return trimmed || fallback;
}

function escapeTemplateLiteral(value) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function getPreferredMimeType(candidates) {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to convert media to data URL.'));
    reader.readAsDataURL(blob);
  });
}

function applyBoxBlur(cellValues, numRows, numCols, strength) {
  let result = new Float32Array(cellValues);
  const passes = Math.floor(strength);

  for (let pass = 0; pass < passes; pass += 1) {
    const temp = new Float32Array(result.length);

    for (let row = 0; row < numRows; row += 1) {
      for (let col = 0; col < numCols; col += 1) {
        let sum = 0;
        let count = 0;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sampleRow = row + dy;
            const sampleCol = col + dx;

            if (sampleRow >= 0 && sampleRow < numRows && sampleCol >= 0 && sampleCol < numCols) {
              sum += result[sampleRow * numCols + sampleCol];
              count += 1;
            }
          }
        }

        temp[row * numCols + col] = sum / count;
      }
    }

    result = temp;
  }

  const fractional = strength - Math.floor(strength);
  if (fractional > 0) {
    for (let index = 0; index < result.length; index += 1) {
      result[index] = cellValues[index] * (1 - fractional) + result[index] * fractional;
    }
  }

  return result;
}

function applyFloydSteinbergDithering(cellValues, numRows, numCols) {
  const threshold = 128;

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const index = row * numCols + col;
      const oldValue = cellValues[index];
      const newValue = oldValue < threshold ? 0 : 255;
      const error = oldValue - newValue;

      cellValues[index] = newValue;

      if (col + 1 < numCols) {
        cellValues[row * numCols + (col + 1)] += error * (7 / 16);
      }

      if (row + 1 < numRows) {
        if (col - 1 >= 0) {
          cellValues[(row + 1) * numCols + (col - 1)] += error * (3 / 16);
        }
        cellValues[(row + 1) * numCols + col] += error * (5 / 16);
        if (col + 1 < numCols) {
          cellValues[(row + 1) * numCols + (col + 1)] += error * (1 / 16);
        }
      }
    }
  }
}

function applyOrderedDithering(cellValues, numRows, numCols) {
  const bayerMatrix = [
    [0, 2],
    [3, 1]
  ];
  const matrixSize = 2;

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const index = row * numCols + col;
      const threshold =
        (bayerMatrix[row % matrixSize][col % matrixSize] + 0.5) * (255 / (matrixSize * matrixSize));
      cellValues[index] = cellValues[index] < threshold ? 0 : 255;
    }
  }
}

function applyNoiseDithering(cellValues) {
  const threshold = 128;

  for (let index = 0; index < cellValues.length; index += 1) {
    const noise = (Math.random() - 0.5) * 50;
    const adjustedValue = cellValues[index] + noise;
    cellValues[index] = adjustedValue < threshold ? 0 : 255;
  }
}

function sampleGrayAt(grayData, width, height, x, y) {
  const sampleX = clamp(Math.round(x), 0, width - 1);
  const sampleY = clamp(Math.round(y), 0, height - 1);
  return grayData[sampleY * width + sampleX];
}

function sampleRgbAt(data, width, height, x, y) {
  const sampleX = clamp(Math.round(x), 0, width - 1);
  const sampleY = clamp(Math.round(y), 0, height - 1);
  const index = (sampleY * width + sampleX) * 4;
  return [data[index], data[index + 1], data[index + 2]];
}

function pseudoRandom2d(x, y, seed) {
  const raw = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return raw - Math.floor(raw);
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothstep(edge0, edge1, value) {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value >= edge1 ? 1 : 0;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash21(x, y) {
  let px = fract(x * 0.3183099) + 0.1;
  let py = fract(y * 0.3678794) + 0.1;
  const dotTerm = px * (px + 19.19) + py * (py + 19.19);
  px += dotTerm;
  py += dotTerm;
  return fract(px * py);
}

function valueNoise2d(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x1 = a + (b - a) * ux;
  const x2 = c + (d - c) * ux;
  return x1 + (x2 - x1) * uy;
}

function rotateVec2(x, y, angleRadians) {
  const cosAngle = Math.cos(angleRadians);
  const sinAngle = Math.sin(angleRadians);
  return [cosAngle * x - sinAngle * y, sinAngle * x + cosAngle * y];
}

function getGrainUv(imageU, imageV, grainSize, imageAspectRatio) {
  const clampedSize = clamp(grainSize, 0, 1);
  const grainScale = 2000 + (200 - 2000) * clampedSize;
  const scaledAspect = Math.max(1e-5, imageAspectRatio);
  let grainU = imageU - 0.5;
  let grainV = imageV - 0.5;
  grainU *= grainScale;
  grainV *= grainScale * (1 / scaledAspect);
  grainU += 0.5;
  grainV += 0.5;
  return [grainU, grainV];
}

function getGrainMixerAmount(grainU, grainV, grainMixer) {
  const clampedMixer = clamp(grainMixer, 0, 1);
  if (clampedMixer <= 0) {
    return 0;
  }
  let grain = valueNoise2d(grainU, grainV);
  grain = smoothstep(0.55, 0.7 + 0.2 * clampedMixer, grain);
  return grain * clampedMixer;
}

function getGrainOverlaySample(grainU, grainV, grainOverlay) {
  const clampedOverlay = clamp(grainOverlay, 0, 1);
  if (clampedOverlay <= 0) {
    return { isWhite: true, strength: 0 };
  }

  const [r1x, r1y] = rotateVec2(grainU, grainV, 1);
  let overlay = valueNoise2d(r1x + 3, r1y + 3);
  const [r2x, r2y] = rotateVec2(grainU, grainV, 2);
  overlay = overlay * 0.5 + valueNoise2d(r2x - 1, r2y - 1) * 0.5;
  overlay = Math.pow(overlay, 1.3);
  const overlayValue = overlay * 2 - 1;
  let strength = clampedOverlay * Math.abs(overlayValue);
  strength = Math.pow(strength, 0.8);
  return { isWhite: overlayValue >= 0, strength };
}

function parseHexColor(color) {
  if (typeof color !== 'string') {
    return null;
  }
  const value = color.trim();
  if (!value.startsWith('#')) {
    return null;
  }
  const hex = value.slice(1);
  if (hex.length === 3) {
    return [
      Number.parseInt(hex[0] + hex[0], 16),
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16)
    ];
  }
  if (hex.length === 6 || hex.length === 8) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    ];
  }
  return null;
}

function applyGrainPostProcess({
  context,
  width,
  height,
  grainMixer,
  grainOverlay,
  grainSize,
  imageAspectRatio,
  paperColor
}) {
  if (grainMixer <= 0 && grainOverlay <= 0) {
    return;
  }

  const paperRgb = parseHexColor(paperColor);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const widthDenominator = Math.max(1, width - 1);
  const heightDenominator = Math.max(1, height - 1);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const imageU = x / widthDenominator;
      const imageV = y / heightDenominator;
      const [grainU, grainV] = getGrainUv(imageU, imageV, grainSize, imageAspectRatio);

      if (grainMixer > 0) {
        const mixerAmount = getGrainMixerAmount(grainU, grainV, grainMixer);
        const blend = 1 - mixerAmount;
        if (paperRgb) {
          data[index] = paperRgb[0] + (data[index] - paperRgb[0]) * blend;
          data[index + 1] = paperRgb[1] + (data[index + 1] - paperRgb[1]) * blend;
          data[index + 2] = paperRgb[2] + (data[index + 2] - paperRgb[2]) * blend;
        } else {
          data[index] *= blend;
          data[index + 1] *= blend;
          data[index + 2] *= blend;
          data[index + 3] *= blend;
        }
      }

      if (grainOverlay > 0) {
        const { isWhite, strength } = getGrainOverlaySample(grainU, grainV, grainOverlay);
        if (strength > 0.001) {
          const tone = isWhite ? 255 : 0;
          const alpha = 0.5 * strength;
          data[index] = data[index] * (1 - alpha) + tone * alpha;
          data[index + 1] = data[index + 1] * (1 - alpha) + tone * alpha;
          data[index + 2] = data[index + 2] * (1 - alpha) + tone * alpha;
        }
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

function drawHalftoneShape(context, shape, centerX, centerY, radius, color, angleRadians) {
  context.fillStyle = color;
  context.strokeStyle = color;

  if (shape === 'Square') {
    const side = radius * 2;
    context.fillRect(centerX - side / 2, centerY - side / 2, side, side);
    return;
  }

  if (shape === 'Diamond') {
    const side = radius * Math.SQRT2;
    context.beginPath();
    context.moveTo(centerX, centerY - side);
    context.lineTo(centerX + side, centerY);
    context.lineTo(centerX, centerY + side);
    context.lineTo(centerX - side, centerY);
    context.closePath();
    context.fill();
    return;
  }

  if (shape === 'Triangle') {
    const triangleRadius = radius * 1.25;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(angleRadians);
    context.beginPath();
    context.moveTo(0, -triangleRadius);
    context.lineTo(triangleRadius * 0.9, triangleRadius * 0.75);
    context.lineTo(-triangleRadius * 0.9, triangleRadius * 0.75);
    context.closePath();
    context.fill();
    context.restore();
    return;
  }

  if (shape === 'Line') {
    const lineLength = radius * 2;
    const lineThickness = Math.max(1, radius * 0.55);
    context.save();
    context.translate(centerX, centerY);
    context.rotate(angleRadians);
    context.beginPath();
    context.lineWidth = lineThickness;
    context.lineCap = 'round';
    context.moveTo(-lineLength / 2, 0);
    context.lineTo(lineLength / 2, 0);
    context.stroke();
    context.restore();
    return;
  }

  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();
}

function generateHalftone({ targetCanvas, sourceElement, settings, baseWidth, baseHeight, scaleFactor }) {
  const targetWidth = Math.max(1, Math.floor(baseWidth * scaleFactor));
  const targetHeight = Math.max(1, Math.floor(baseHeight * scaleFactor));

  targetCanvas.width = targetWidth;
  targetCanvas.height = targetHeight;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;

  const tempContext = tempCanvas.getContext('2d', { willReadFrequently: true });
  if (!tempContext) {
    return;
  }

  tempContext.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);

  const imageData = tempContext.getImageData(0, 0, targetWidth, targetHeight);
  const data = imageData.data;
  const baseBrightness = 20;
  const baseGamma = 1;
  const contrastAdjustment = clamp(settings.contrast, -255, 255);
  const contrastFactor = (259 * (contrastAdjustment + 255)) / (255 * (259 - contrastAdjustment));

  const grayData = new Float32Array(targetWidth * targetHeight);

  for (let index = 0; index < data.length; index += 4) {
    let gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    gray = contrastFactor * (gray - 128) + 128 + baseBrightness;
    gray = clamp(gray, 0, 255);
    gray = 255 * Math.pow(gray / 255, 1 / baseGamma);
    grayData[index / 4] = gray;
  }

  const grid = Math.max(1, Math.round(settings.dotSize * scaleFactor));
  const angleRadians = (settings.angle * Math.PI) / 180;
  const isAxisAligned = Math.abs(settings.angle) < 0.001;
  let numCols;
  let numRows;
  let cellValues;
  let posX;
  let posY;
  let cellColors;

  if (isAxisAligned) {
    numCols = Math.ceil(targetWidth / grid);
    numRows = Math.ceil(targetHeight / grid);
    cellValues = new Float32Array(numRows * numCols);
    posX = new Float32Array(numRows * numCols);
    posY = new Float32Array(numRows * numCols);
    cellColors = new Uint8ClampedArray(numRows * numCols * 3);

    for (let row = 0; row < numRows; row += 1) {
      for (let col = 0; col < numCols; col += 1) {
        const index = row * numCols + col;
        let sum = 0;
        let count = 0;

        const startY = row * grid;
        const startX = col * grid;
        const endY = Math.min(startY + grid, targetHeight);
        const endX = Math.min(startX + grid, targetWidth);

        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            sum += grayData[y * targetWidth + x];
            count += 1;
          }
        }

        cellValues[index] = count > 0 ? sum / count : 0;
        posX[index] = col * grid + grid / 2;
        posY[index] = row * grid + grid / 2;

        if (settings.colorMode) {
          const [red, green, blue] = sampleRgbAt(data, targetWidth, targetHeight, posX[index], posY[index]);
          const colorIndex = index * 3;
          cellColors[colorIndex] = red;
          cellColors[colorIndex + 1] = green;
          cellColors[colorIndex + 2] = blue;
        }
      }
    }
  } else {
    const diagonal = Math.ceil(Math.sqrt(targetWidth ** 2 + targetHeight ** 2));
    numCols = Math.ceil(diagonal / grid) + 2;
    numRows = Math.ceil(diagonal / grid) + 2;
    const halfCols = numCols / 2;
    const halfRows = numRows / 2;
    const cosAngle = Math.cos(angleRadians);
    const sinAngle = Math.sin(angleRadians);
    const centerX = targetWidth / 2;
    const centerY = targetHeight / 2;

    cellValues = new Float32Array(numRows * numCols);
    posX = new Float32Array(numRows * numCols);
    posY = new Float32Array(numRows * numCols);
    cellColors = new Uint8ClampedArray(numRows * numCols * 3);

    for (let row = 0; row < numRows; row += 1) {
      for (let col = 0; col < numCols; col += 1) {
        const index = row * numCols + col;
        const localX = (col - halfCols + 0.5) * grid;
        const localY = (row - halfRows + 0.5) * grid;
        const rotatedX = centerX + localX * cosAngle - localY * sinAngle;
        const rotatedY = centerY + localX * sinAngle + localY * cosAngle;

        posX[index] = rotatedX;
        posY[index] = rotatedY;
        cellValues[index] = sampleGrayAt(grayData, targetWidth, targetHeight, rotatedX, rotatedY);

        if (settings.colorMode) {
          const [red, green, blue] = sampleRgbAt(data, targetWidth, targetHeight, rotatedX, rotatedY);
          const colorIndex = index * 3;
          cellColors[colorIndex] = red;
          cellColors[colorIndex + 1] = green;
          cellColors[colorIndex + 2] = blue;
        }
      }
    }
  }

  if (settings.smoothing > 0) {
    cellValues = applyBoxBlur(cellValues, numRows, numCols, settings.smoothing);
  }

  if (settings.ditherType === 'FloydSteinberg') {
    applyFloydSteinbergDithering(cellValues, numRows, numCols);
  } else if (settings.ditherType === 'Ordered') {
    applyOrderedDithering(cellValues, numRows, numCols);
  } else if (settings.ditherType === 'Noise') {
    applyNoiseDithering(cellValues);
  }

  const context = targetCanvas.getContext('2d');
  if (!context) {
    return;
  }

  context.fillStyle = settings.paperColor;
  context.fillRect(0, 0, targetWidth, targetHeight);

  const maxRadius = grid / 2;
  const spreadRadius = (settings.spread / 100) * grid * 0.8;
  const grainMixer =
    typeof settings.grainMixer === 'number' ? clamp(settings.grainMixer, 0, 1) : DEFAULT_SETTINGS.grainMixer;
  const grainOverlay =
    typeof settings.grainOverlay === 'number'
      ? clamp(settings.grainOverlay, 0, 1)
      : DEFAULT_SETTINGS.grainOverlay;
  const grainSize =
    typeof settings.grainSize === 'number' ? clamp(settings.grainSize, 0, 1) : DEFAULT_SETTINGS.grainSize;
  const imageAspectRatio = targetWidth / Math.max(1, targetHeight);

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const index = row * numCols + col;
      const brightnessValue = clamp(cellValues[index], 0, 255);
      const normalized = brightnessValue / 255;
      const tone = settings.inverted ? normalized : 1 - normalized;

      let dotX = posX[index];
      let dotY = posY[index];

      if (spreadRadius > 0) {
        const randomX = pseudoRandom2d(col + 13, row + 29, 17);
        const randomY = pseudoRandom2d(col + 41, row + 7, 91);
        dotX += (randomX - 0.5) * spreadRadius * 2;
        dotY += (randomY - 0.5) * spreadRadius * 2;
      }

      if (dotX < -grid || dotX > targetWidth + grid || dotY < -grid || dotY > targetHeight + grid) {
        continue;
      }

      const radius = maxRadius * tone;
      if (radius <= 0.45) {
        continue;
      }

      const dotColor = settings.colorMode
        ? `rgb(${cellColors[index * 3]} ${cellColors[index * 3 + 1]} ${cellColors[index * 3 + 2]})`
        : settings.inkColor;

      drawHalftoneShape(context, settings.shape, dotX, dotY, radius, dotColor, angleRadians);
    }
  }

  applyGrainPostProcess({
    context,
    width: targetWidth,
    height: targetHeight,
    grainMixer,
    grainOverlay,
    grainSize,
    imageAspectRatio,
    paperColor: settings.paperColor
  });
}

function ExportDropdown({ value, options, onChange, disabled, ariaLabel }) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) || options[0];
  }, [options, value]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  const selectValue = useCallback(
    (nextValue) => {
      onChange(nextValue);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleTriggerKeyDown = useCallback(
    (event) => {
      if (disabled) {
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setIsOpen((open) => !open);
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      event.preventDefault();
      const currentIndex = Math.max(0, options.findIndex((option) => option.value === value));
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + offset + options.length) % options.length;
      selectValue(options[nextIndex].value);
    },
    [disabled, options, selectValue, value]
  );

  return (
    <div ref={rootRef} className={`export-select ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <button
        type="button"
        className="export-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="export-select-value">{selectedOption.label}</span>
        <span className="export-select-chevron" aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="export-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className={`export-select-option ${option.value === value ? 'is-selected' : ''}`}
              aria-selected={option.value === value}
              onClick={() => selectValue(option.value)}
            >
              <span className="export-select-check" aria-hidden="true">
                {option.value === value ? '✓' : ''}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const zoomRef = useRef(1);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const sourceSizeRef = useRef({ width: 1200, height: 800 });
  const presetRef = useRef(DEFAULT_SETTINGS.preset);
  const mediaRef = useRef({
    image: null,
    video: null,
    isVideo: false,
    objectUrl: null,
    animationFrameId: 0
  });

  const [hasSource, setHasSource] = useState(false);
  const [canvasSize, setCanvasSize] = useState(sourceSizeRef.current);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeExportType, setActiveExportType] = useState(EXPORT_TYPES.png);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatusMessage, setExportStatusMessage] = useState('');
  const [exportOptions, setExportOptions] = useState({
    fileName: 'halftone-export',
    durationSec: '2',
    fps: '24',
    resolution: '720',
    videoQuality: 'high',
    transparentBackground: true,
    alphaMaskGradient: true,
    pauseWhenOffscreen: true,
    enableInteraction: true,
    fadeIn: true,
    adaptivePerformance: true,
    splitHtmlJsFile: true
  });

  const paintWhiteCanvas = useCallback((canvas) => {
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.fillStyle = settingsRef.current.paperColor || DEFAULT_SETTINGS.paperColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const fitCanvas = useCallback((sourceWidth, sourceHeight) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const horizontalPadding = window.innerWidth > 900 ? 360 : 36;
    const maxWidth = Math.max(320, window.innerWidth - horizontalPadding);
    const maxHeight = Math.max(240, window.innerHeight - 36);

    let width = sourceWidth;
    let height = sourceHeight;

    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width *= ratio;
      height *= ratio;
    }

    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    setCanvasSize({ width: canvas.width, height: canvas.height });
  }, []);

  const processFrame = useCallback(
    (scaleFactor = 1, targetCanvas = null) => {
      const previewCanvas = canvasRef.current;
      const canvas = targetCanvas ?? previewCanvas;

      if (!previewCanvas || !canvas) {
        return;
      }

      const media = mediaRef.current;
      const sourceElement = media.isVideo ? media.video : media.image;

      if (!sourceElement) {
        if (!targetCanvas) {
          paintWhiteCanvas(previewCanvas);
        }
        return;
      }

      generateHalftone({
        targetCanvas: canvas,
        sourceElement,
        settings: settingsRef.current,
        baseWidth: previewCanvas.width,
        baseHeight: previewCanvas.height,
        scaleFactor
      });
    },
    [paintWhiteCanvas]
  );

  const stopVideoLoop = useCallback(() => {
    if (mediaRef.current.animationFrameId) {
      cancelAnimationFrame(mediaRef.current.animationFrameId);
      mediaRef.current.animationFrameId = 0;
    }
  }, []);

  const clearMedia = useCallback(() => {
    stopVideoLoop();

    const media = mediaRef.current;

    if (media.video) {
      media.video.pause();
      media.video.src = '';
      media.video.load();
    }

    if (media.objectUrl) {
      URL.revokeObjectURL(media.objectUrl);
    }

    media.image = null;
    media.video = null;
    media.isVideo = false;
    media.objectUrl = null;
  }, [stopVideoLoop]);

  const startVideoLoop = useCallback(() => {
    stopVideoLoop();

    const renderVideoFrame = () => {
      if (!mediaRef.current.isVideo) {
        return;
      }

      processFrame();
      mediaRef.current.animationFrameId = requestAnimationFrame(renderVideoFrame);
    };

    renderVideoFrame();
  }, [processFrame, stopVideoLoop]);

  const loadVideoSource = useCallback(
    (sourceUrl, objectUrl = null) => {
      clearMedia();

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('webkit-playsinline', 'true');

      video.addEventListener(
        'loadeddata',
        () => {
          mediaRef.current.video = video;
          mediaRef.current.isVideo = true;
          mediaRef.current.objectUrl = objectUrl;

          sourceSizeRef.current = {
            width: video.videoWidth || 800,
            height: video.videoHeight || 600
          };

          fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
          setHasSource(true);
          video.play().catch(() => {});
          startVideoLoop();
        },
        { once: true }
      );

      video.addEventListener(
        'error',
        () => {
          setHasSource(false);
          fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
          paintWhiteCanvas(canvasRef.current);
        },
        { once: true }
      );

      video.src = sourceUrl;
    },
    [clearMedia, fitCanvas, paintWhiteCanvas, startVideoLoop]
  );

  const loadImageSource = useCallback(
    (sourceUrl, objectUrl = null) => {
      clearMedia();

      const image = new Image();
      image.addEventListener(
        'load',
        () => {
          mediaRef.current.image = image;
          mediaRef.current.isVideo = false;
          mediaRef.current.objectUrl = objectUrl;

          sourceSizeRef.current = {
            width: image.width || 800,
            height: image.height || 600
          };

          fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
          setHasSource(true);
          processFrame();
        },
        { once: true }
      );

      image.addEventListener(
        'error',
        () => {
          setHasSource(false);
          fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
          paintWhiteCanvas(canvasRef.current);
        },
        { once: true }
      );

      image.src = sourceUrl;
    },
    [clearMedia, fitCanvas, paintWhiteCanvas, processFrame]
  );

  const updateExportOption = useCallback((key, value) => {
    setExportOptions((previous) => ({
      ...previous,
      [key]: value
    }));
  }, []);

  const closeExportModal = useCallback(() => {
    if (isExporting) {
      return;
    }
    setIsExportModalOpen(false);
  }, [isExporting]);

  const openExportModal = useCallback((type) => {
    setActiveExportType(type);
    setExportStatusMessage('');
    setIsExportModalOpen(true);
  }, []);

  const downloadBlob = useCallback((blob, fileName) => {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2_000);
  }, []);

  const downloadTextFile = useCallback(
    (contents, fileName, mimeType = 'text/plain;charset=utf-8') => {
      downloadBlob(new Blob([contents], { type: mimeType }), fileName);
    },
    [downloadBlob]
  );

  const getExportDimensions = useCallback((resolutionValue) => {
    const previewCanvas = canvasRef.current;
    const sourceWidth = Math.max(1, Math.round(sourceSizeRef.current.width || previewCanvas?.width || 1));
    const sourceHeight = Math.max(1, Math.round(sourceSizeRef.current.height || previewCanvas?.height || 1));
    const aspectRatio = sourceWidth / sourceHeight;

    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    if (resolutionValue !== 'source') {
      const requestedHeight = Math.max(120, Number.parseInt(resolutionValue, 10) || sourceHeight);
      targetHeight = requestedHeight;
      targetWidth = Math.max(1, Math.round(requestedHeight * aspectRatio));
    }

    const baseWidth = Math.max(1, previewCanvas?.width || sourceWidth);
    const baseHeight = Math.max(1, previewCanvas?.height || sourceHeight);
    const scaleFactor = Math.max(targetWidth / baseWidth, targetHeight / baseHeight, 1);

    return {
      targetWidth,
      targetHeight,
      scaleFactor
    };
  }, []);

  const createSnapshotDataUrl = useCallback(
    (resolutionValue) => {
      const { targetWidth, targetHeight, scaleFactor } = getExportDimensions(resolutionValue);
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;
      processFrame(scaleFactor, exportCanvas);
      return { dataUrl: exportCanvas.toDataURL('image/png'), width: targetWidth, height: targetHeight };
    },
    [getExportDimensions, processFrame]
  );

  const getCurrentMediaPayload = useCallback(async () => {
    const media = mediaRef.current;
    const sourceElement = media.isVideo ? media.video : media.image;
    if (!sourceElement) {
      throw new Error('Load an image or video first.');
    }

    const mediaType = media.isVideo ? 'video' : 'image';
    const sourceUrl =
      mediaType === 'video'
        ? media.video?.currentSrc || media.video?.src || ''
        : media.image?.currentSrc || media.image?.src || '';

    if (!sourceUrl) {
      throw new Error('Unable to resolve media source for export.');
    }

    if (sourceUrl.startsWith('data:')) {
      return { mediaType, dataUrl: sourceUrl };
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch media source for export.');
    }

    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return { mediaType, dataUrl };
  }, []);

  const exportCurrentFrame = useCallback(() => {
    if (!hasSource || !canvasRef.current) {
      throw new Error('Load an image or video first.');
    }

    const { targetWidth, targetHeight, scaleFactor } = getExportDimensions('source');
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;
    processFrame(scaleFactor, exportCanvas);

    const exportName = sanitizeFileName(exportOptions.fileName, 'halftone-export');
    exportCanvas.toBlob(
      (blob) => {
        if (!blob) {
          setExportStatusMessage('PNG export failed.');
          return;
        }
        downloadBlob(blob, `${exportName}.png`);
      },
      'image/png',
      1
    );
    return `Exported PNG (${targetWidth}x${targetHeight}).`;
  }, [downloadBlob, exportOptions.fileName, getExportDimensions, hasSource, processFrame]);

  const exportGif = useCallback(async () => {
    if (!hasSource || !canvasRef.current) {
      throw new Error('Load an image or video first.');
    }

    const exportName = sanitizeFileName(exportOptions.fileName, 'halftone-export');
    const fps = clamp(Number(exportOptions.fps) || 24, 1, 60);
    const durationSec = clamp(Number(exportOptions.durationSec) || 2, 0.5, 30);
    const frameDelay = Math.max(16, Math.round(1000 / fps));
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const { targetWidth, targetHeight, scaleFactor } = getExportDimensions(exportOptions.resolution);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;

    const context = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('GIF export failed: no 2D context.');
    }

    const gif = GIFEncoder();
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      processFrame(scaleFactor, exportCanvas);
      const frameImage = context.getImageData(0, 0, targetWidth, targetHeight);
      const palette = quantize(frameImage.data, 256);
      const indexedFrame = applyPalette(frameImage.data, palette);
      const frameOptions = {
        palette,
        delay: frameDelay
      };

      if (frameIndex === 0) {
        frameOptions.repeat = 0;
      }

      gif.writeFrame(indexedFrame, targetWidth, targetHeight, frameOptions);
      await wait(frameDelay);
    }

    gif.finish();
    downloadBlob(new Blob([gif.bytes()], { type: 'image/gif' }), `${exportName}.gif`);
    return `Exported GIF (${targetWidth}x${targetHeight}, ${fps} FPS).`;
  }, [downloadBlob, exportOptions, getExportDimensions, hasSource, processFrame]);

  const exportMp4 = useCallback(async () => {
    if (!hasSource || !canvasRef.current) {
      throw new Error('Load an image or video first.');
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Video export is not available in this browser.');
    }

    const exportName = sanitizeFileName(exportOptions.fileName, 'halftone-export');
    const fps = clamp(Number(exportOptions.fps) || 24, 1, 60);
    const durationSec = clamp(Number(exportOptions.durationSec) || 2, 0.5, 30);
    const totalFrames = Math.max(1, Math.round(durationSec * fps));
    const frameDelay = Math.max(8, Math.round(1000 / fps));
    const { targetWidth, targetHeight, scaleFactor } = getExportDimensions(exportOptions.resolution);
    const qualityPreset = exportOptions.videoQuality in VIDEO_QUALITY_BITRATES ? exportOptions.videoQuality : 'medium';

    const preferredMp4Type = getPreferredMimeType([
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264',
      'video/mp4'
    ]);
    const fallbackType = getPreferredMimeType(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);
    const mimeType = preferredMp4Type || fallbackType;
    if (!mimeType) {
      throw new Error('No supported recorder codec was found in this browser.');
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth;
    exportCanvas.height = targetHeight;

    const stream = exportCanvas.captureStream(fps);
    const chunks = [];

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_QUALITY_BITRATES[qualityPreset]
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }

    const recordingFinished = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('Recording failed.'));
    });

    recorder.start();
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      processFrame(scaleFactor, exportCanvas);
      await wait(frameDelay);
    }
    recorder.stop();
    await recordingFinished;
    stream.getTracks().forEach((track) => track.stop());

    const isMp4 = mimeType.startsWith('video/mp4');
    const extension = isMp4 ? 'mp4' : 'webm';
    downloadBlob(new Blob(chunks, { type: mimeType }), `${exportName}.${extension}`);

    return isMp4
      ? `Exported MP4 (${targetWidth}x${targetHeight}, ${fps} FPS).`
      : `MP4 is not available in this browser, exported WebM instead (${targetWidth}x${targetHeight}).`;
  }, [downloadBlob, exportOptions, getExportDimensions, hasSource, processFrame]);

  const exportHtmlJsBackground = useCallback(async () => {
    if (!hasSource || !canvasRef.current) {
      throw new Error('Load an image or video first.');
    }

    const exportName = sanitizeFileName(exportOptions.fileName, 'halftone-export');
    const mediaPayload = await getCurrentMediaPayload();
    const { targetWidth, targetHeight, scaleFactor } = getExportDimensions(exportOptions.resolution);
    const settingsJson = JSON.stringify(settingsRef.current, null, 2);
    const optionsJson = JSON.stringify(
      {
        transparentBackground: exportOptions.transparentBackground,
        alphaMaskGradient: exportOptions.alphaMaskGradient,
        pauseWhenOffscreen: exportOptions.pauseWhenOffscreen,
        enableInteraction: exportOptions.enableInteraction,
        fadeIn: exportOptions.fadeIn,
        autoplay: true
      },
      null,
      2
    );

    const runtimeCore = `function clamp(value, min, max) {\n  return Math.max(min, Math.min(max, value));\n}\n\nfunction applyBoxBlur(cellValues, numRows, numCols, strength) {\n  var result = new Float32Array(cellValues);\n  var passes = Math.floor(strength);\n\n  for (var pass = 0; pass < passes; pass += 1) {\n    var temp = new Float32Array(result.length);\n    for (var row = 0; row < numRows; row += 1) {\n      for (var col = 0; col < numCols; col += 1) {\n        var sum = 0;\n        var count = 0;\n        for (var dy = -1; dy <= 1; dy += 1) {\n          for (var dx = -1; dx <= 1; dx += 1) {\n            var sampleRow = row + dy;\n            var sampleCol = col + dx;\n            if (sampleRow >= 0 && sampleRow < numRows && sampleCol >= 0 && sampleCol < numCols) {\n              sum += result[sampleRow * numCols + sampleCol];\n              count += 1;\n            }\n          }\n        }\n        temp[row * numCols + col] = sum / count;\n      }\n    }\n    result = temp;\n  }\n\n  var fractional = strength - Math.floor(strength);\n  if (fractional > 0) {\n    for (var i = 0; i < result.length; i += 1) {\n      result[i] = cellValues[i] * (1 - fractional) + result[i] * fractional;\n    }\n  }\n\n  return result;\n}\n\nfunction applyFloydSteinbergDithering(cellValues, numRows, numCols) {\n  var threshold = 128;\n  for (var row = 0; row < numRows; row += 1) {\n    for (var col = 0; col < numCols; col += 1) {\n      var index = row * numCols + col;\n      var oldValue = cellValues[index];\n      var newValue = oldValue < threshold ? 0 : 255;\n      var error = oldValue - newValue;\n      cellValues[index] = newValue;\n      if (col + 1 < numCols) {\n        cellValues[row * numCols + (col + 1)] += error * (7 / 16);\n      }\n      if (row + 1 < numRows) {\n        if (col - 1 >= 0) {\n          cellValues[(row + 1) * numCols + (col - 1)] += error * (3 / 16);\n        }\n        cellValues[(row + 1) * numCols + col] += error * (5 / 16);\n        if (col + 1 < numCols) {\n          cellValues[(row + 1) * numCols + (col + 1)] += error * (1 / 16);\n        }\n      }\n    }\n  }\n}\n\nfunction applyOrderedDithering(cellValues, numRows, numCols) {\n  var bayerMatrix = [[0, 2], [3, 1]];\n  var matrixSize = 2;\n  for (var row = 0; row < numRows; row += 1) {\n    for (var col = 0; col < numCols; col += 1) {\n      var index = row * numCols + col;\n      var threshold = (bayerMatrix[row % matrixSize][col % matrixSize] + 0.5) * (255 / (matrixSize * matrixSize));\n      cellValues[index] = cellValues[index] < threshold ? 0 : 255;\n    }\n  }\n}\n\nfunction applyNoiseDithering(cellValues) {\n  var threshold = 128;\n  for (var index = 0; index < cellValues.length; index += 1) {\n    var noise = (Math.random() - 0.5) * 50;\n    var adjustedValue = cellValues[index] + noise;\n    cellValues[index] = adjustedValue < threshold ? 0 : 255;\n  }\n}\n\nfunction sampleGrayAt(grayData, width, height, x, y) {\n  var sampleX = clamp(Math.round(x), 0, width - 1);\n  var sampleY = clamp(Math.round(y), 0, height - 1);\n  return grayData[sampleY * width + sampleX];\n}\n\nfunction sampleRgbAt(data, width, height, x, y) {\n  var sampleX = clamp(Math.round(x), 0, width - 1);\n  var sampleY = clamp(Math.round(y), 0, height - 1);\n  var index = (sampleY * width + sampleX) * 4;\n  return [data[index], data[index + 1], data[index + 2]];\n}\n\nfunction pseudoRandom2d(x, y, seed) {\n  var raw = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;\n  return raw - Math.floor(raw);\n}\n\nfunction fract(value) {\n  return value - Math.floor(value);\n}\n\nfunction smoothstep(edge0, edge1, value) {\n  if (Math.abs(edge1 - edge0) < 1e-6) {\n    return value >= edge1 ? 1 : 0;\n  }\n  var t = clamp((value - edge0) / (edge1 - edge0), 0, 1);\n  return t * t * (3 - 2 * t);\n}\n\nfunction hash21(x, y) {\n  var px = fract(x * 0.3183099) + 0.1;\n  var py = fract(y * 0.3678794) + 0.1;\n  var dotTerm = px * (px + 19.19) + py * (py + 19.19);\n  px += dotTerm;\n  py += dotTerm;\n  return fract(px * py);\n}\n\nfunction valueNoise2d(x, y) {\n  var ix = Math.floor(x);\n  var iy = Math.floor(y);\n  var fx = fract(x);\n  var fy = fract(y);\n  var a = hash21(ix, iy);\n  var b = hash21(ix + 1, iy);\n  var c = hash21(ix, iy + 1);\n  var d = hash21(ix + 1, iy + 1);\n  var ux = fx * fx * (3 - 2 * fx);\n  var uy = fy * fy * (3 - 2 * fy);\n  var x1 = a + (b - a) * ux;\n  var x2 = c + (d - c) * ux;\n  return x1 + (x2 - x1) * uy;\n}\n\nfunction rotateVec2(x, y, angleRadians) {\n  var cosAngle = Math.cos(angleRadians);\n  var sinAngle = Math.sin(angleRadians);\n  return [cosAngle * x - sinAngle * y, sinAngle * x + cosAngle * y];\n}\n\nfunction getGrainUv(imageU, imageV, grainSize, imageAspectRatio) {\n  var clampedSize = clamp(grainSize, 0, 1);\n  var grainScale = 2000 + (200 - 2000) * clampedSize;\n  var scaledAspect = Math.max(1e-5, imageAspectRatio);\n  var grainU = imageU - 0.5;\n  var grainV = imageV - 0.5;\n  grainU *= grainScale;\n  grainV *= grainScale * (1 / scaledAspect);\n  grainU += 0.5;\n  grainV += 0.5;\n  return [grainU, grainV];\n}\n\nfunction getGrainMixerAmount(grainU, grainV, grainMixer) {\n  var clampedMixer = clamp(grainMixer, 0, 1);\n  if (clampedMixer <= 0) {\n    return 0;\n  }\n  var grain = valueNoise2d(grainU, grainV);\n  grain = smoothstep(0.55, 0.7 + 0.2 * clampedMixer, grain);\n  return grain * clampedMixer;\n}\n\nfunction getGrainOverlaySample(grainU, grainV, grainOverlay) {\n  var clampedOverlay = clamp(grainOverlay, 0, 1);\n  if (clampedOverlay <= 0) {\n    return { isWhite: true, strength: 0 };\n  }\n  var rotated1 = rotateVec2(grainU, grainV, 1);\n  var overlay = valueNoise2d(rotated1[0] + 3, rotated1[1] + 3);\n  var rotated2 = rotateVec2(grainU, grainV, 2);\n  overlay = overlay * 0.5 + valueNoise2d(rotated2[0] - 1, rotated2[1] - 1) * 0.5;\n  overlay = Math.pow(overlay, 1.3);\n  var overlayValue = overlay * 2 - 1;\n  var strength = clampedOverlay * Math.abs(overlayValue);\n  strength = Math.pow(strength, 0.8);\n  return { isWhite: overlayValue >= 0, strength: strength };\n}\n\nfunction drawHalftoneShape(context, shape, centerX, centerY, radius, color, angleRadians) {\n  context.fillStyle = color;\n  context.strokeStyle = color;\n  if (shape === 'Square') {\n    var side = radius * 2;\n    context.fillRect(centerX - side / 2, centerY - side / 2, side, side);\n    return;\n  }\n  if (shape === 'Diamond') {\n    var diamondSide = radius * Math.SQRT2;\n    context.beginPath();\n    context.moveTo(centerX, centerY - diamondSide);\n    context.lineTo(centerX + diamondSide, centerY);\n    context.lineTo(centerX, centerY + diamondSide);\n    context.lineTo(centerX - diamondSide, centerY);\n    context.closePath();\n    context.fill();\n    return;\n  }\n  if (shape === 'Triangle') {\n    var triangleRadius = radius * 1.25;\n    context.save();\n    context.translate(centerX, centerY);\n    context.rotate(angleRadians);\n    context.beginPath();\n    context.moveTo(0, -triangleRadius);\n    context.lineTo(triangleRadius * 0.9, triangleRadius * 0.75);\n    context.lineTo(-triangleRadius * 0.9, triangleRadius * 0.75);\n    context.closePath();\n    context.fill();\n    context.restore();\n    return;\n  }\n  if (shape === 'Line') {\n    var lineLength = radius * 2;\n    var lineThickness = Math.max(1, radius * 0.55);\n    context.save();\n    context.translate(centerX, centerY);\n    context.rotate(angleRadians);\n    context.beginPath();\n    context.lineWidth = lineThickness;\n    context.lineCap = 'round';\n    context.moveTo(-lineLength / 2, 0);\n    context.lineTo(lineLength / 2, 0);\n    context.stroke();\n    context.restore();\n    return;\n  }\n  context.beginPath();\n  context.arc(centerX, centerY, radius, 0, Math.PI * 2);\n  context.fill();\n}\n\nfunction renderHalftoneFrame(targetCanvas, sourceElement, settings, scaleFactor, options) {\n  var targetWidth = targetCanvas.width;\n  var targetHeight = targetCanvas.height;\n  var tempCanvas = document.createElement('canvas');\n  tempCanvas.width = targetWidth;\n  tempCanvas.height = targetHeight;\n  var tempContext = tempCanvas.getContext('2d', { willReadFrequently: true });\n  if (!tempContext) return;\n\n  var sourceWidth = sourceElement.videoWidth || sourceElement.naturalWidth || sourceElement.width || targetWidth;\n  var sourceHeight = sourceElement.videoHeight || sourceElement.naturalHeight || sourceElement.height || targetHeight;\n\n  if (sourceWidth > 0 && sourceHeight > 0) {\n    var sourceAspect = sourceWidth / sourceHeight;\n    var targetAspect = targetWidth / targetHeight;\n    var drawWidth = targetWidth;\n    var drawHeight = targetHeight;\n    var offsetX = 0;\n    var offsetY = 0;\n\n    if (sourceAspect > targetAspect) {\n      drawHeight = targetWidth / sourceAspect;\n      offsetY = (targetHeight - drawHeight) / 2;\n    } else if (sourceAspect < targetAspect) {\n      drawWidth = targetHeight * sourceAspect;\n      offsetX = (targetWidth - drawWidth) / 2;\n    }\n\n    tempContext.clearRect(0, 0, targetWidth, targetHeight);\n    tempContext.drawImage(sourceElement, offsetX, offsetY, drawWidth, drawHeight);\n  } else {\n    tempContext.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);\n  }\n  var imageData = tempContext.getImageData(0, 0, targetWidth, targetHeight);\n  var data = imageData.data;\n  var contrastAdjustment = clamp(settings.contrast, -255, 255);\n  var contrastFactor = (259 * (contrastAdjustment + 255)) / (255 * (259 - contrastAdjustment));\n  var grayData = new Float32Array(targetWidth * targetHeight);\n\n  for (var index = 0; index < data.length; index += 4) {\n    var gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];\n    gray = contrastFactor * (gray - 128) + 128 + 20;\n    gray = clamp(gray, 0, 255);\n    grayData[index / 4] = gray;\n  }\n\n  var grid = Math.max(1, Math.round(settings.dotSize * scaleFactor));\n  var angleRadians = (settings.angle * Math.PI) / 180;\n  var isAxisAligned = Math.abs(settings.angle) < 0.001;\n  var numCols;\n  var numRows;\n  var cellValues;\n  var posX;\n  var posY;\n  var cellColors;\n\n  if (isAxisAligned) {\n    numCols = Math.ceil(targetWidth / grid);\n    numRows = Math.ceil(targetHeight / grid);\n    cellValues = new Float32Array(numRows * numCols);\n    posX = new Float32Array(numRows * numCols);\n    posY = new Float32Array(numRows * numCols);\n    cellColors = new Uint8ClampedArray(numRows * numCols * 3);\n\n    for (var row = 0; row < numRows; row += 1) {\n      for (var col = 0; col < numCols; col += 1) {\n        var idx = row * numCols + col;\n        var sum = 0;\n        var count = 0;\n        var startY = row * grid;\n        var startX = col * grid;\n        var endY = Math.min(startY + grid, targetHeight);\n        var endX = Math.min(startX + grid, targetWidth);\n\n        for (var y = startY; y < endY; y += 1) {\n          for (var x = startX; x < endX; x += 1) {\n            sum += grayData[y * targetWidth + x];\n            count += 1;\n          }\n        }\n\n        cellValues[idx] = count > 0 ? sum / count : 0;\n        posX[idx] = col * grid + grid / 2;\n        posY[idx] = row * grid + grid / 2;\n\n        if (settings.colorMode) {\n          var rgb = sampleRgbAt(data, targetWidth, targetHeight, posX[idx], posY[idx]);\n          var colorIndex = idx * 3;\n          cellColors[colorIndex] = rgb[0];\n          cellColors[colorIndex + 1] = rgb[1];\n          cellColors[colorIndex + 2] = rgb[2];\n        }\n      }\n    }\n  } else {\n    var diagonal = Math.ceil(Math.sqrt(targetWidth * targetWidth + targetHeight * targetHeight));\n    numCols = Math.ceil(diagonal / grid) + 2;\n    numRows = Math.ceil(diagonal / grid) + 2;\n    var halfCols = numCols / 2;\n    var halfRows = numRows / 2;\n    var cosAngle = Math.cos(angleRadians);\n    var sinAngle = Math.sin(angleRadians);\n    var centerX = targetWidth / 2;\n    var centerY = targetHeight / 2;\n\n    cellValues = new Float32Array(numRows * numCols);\n    posX = new Float32Array(numRows * numCols);\n    posY = new Float32Array(numRows * numCols);\n    cellColors = new Uint8ClampedArray(numRows * numCols * 3);\n\n    for (var r = 0; r < numRows; r += 1) {\n      for (var c = 0; c < numCols; c += 1) {\n        var index2 = r * numCols + c;\n        var localX = (c - halfCols + 0.5) * grid;\n        var localY = (r - halfRows + 0.5) * grid;\n        var rotatedX = centerX + localX * cosAngle - localY * sinAngle;\n        var rotatedY = centerY + localX * sinAngle + localY * cosAngle;\n\n        posX[index2] = rotatedX;\n        posY[index2] = rotatedY;\n        cellValues[index2] = sampleGrayAt(grayData, targetWidth, targetHeight, rotatedX, rotatedY);\n\n        if (settings.colorMode) {\n          var rgb2 = sampleRgbAt(data, targetWidth, targetHeight, rotatedX, rotatedY);\n          var colorIndex2 = index2 * 3;\n          cellColors[colorIndex2] = rgb2[0];\n          cellColors[colorIndex2 + 1] = rgb2[1];\n          cellColors[colorIndex2 + 2] = rgb2[2];\n        }\n      }\n    }\n  }\n\n  if (settings.smoothing > 0) {\n    cellValues = applyBoxBlur(cellValues, numRows, numCols, settings.smoothing);\n  }\n  if (settings.ditherType === 'FloydSteinberg') {\n    applyFloydSteinbergDithering(cellValues, numRows, numCols);\n  } else if (settings.ditherType === 'Ordered') {\n    applyOrderedDithering(cellValues, numRows, numCols);\n  } else if (settings.ditherType === 'Noise') {\n    applyNoiseDithering(cellValues);\n  }\n\n  var context = targetCanvas.getContext('2d');\n  if (!context) return;\n\n  if (options.transparentBackground) {\n    context.clearRect(0, 0, targetWidth, targetHeight);\n  } else {\n    context.fillStyle = settings.paperColor;\n    context.fillRect(0, 0, targetWidth, targetHeight);\n  }\n\n  var maxRadius = grid / 2;\n  var spreadRadius = (settings.spread / 100) * grid * 0.8;\n  var grainMixer = typeof settings.grainMixer === 'number' ? clamp(settings.grainMixer, 0, 1) : 0;\n  var grainOverlay = typeof settings.grainOverlay === 'number' ? clamp(settings.grainOverlay, 0, 1) : 0;\n  var grainSize = typeof settings.grainSize === 'number' ? clamp(settings.grainSize, 0, 1) : 0;\n  var imageAspectRatio = targetWidth / Math.max(1, targetHeight);\n\n  for (var row2 = 0; row2 < numRows; row2 += 1) {\n    for (var col2 = 0; col2 < numCols; col2 += 1) {\n      var idx2 = row2 * numCols + col2;\n      var brightnessValue = clamp(cellValues[idx2], 0, 255);\n      var normalized = brightnessValue / 255;\n      var tone = settings.inverted ? normalized : 1 - normalized;\n      var finalShape = tone;\n\n      var dotX = posX[idx2];\n      var dotY = posY[idx2];\n      if (spreadRadius > 0) {\n        var randomX = pseudoRandom2d(col2 + 13, row2 + 29, 17);\n        var randomY = pseudoRandom2d(col2 + 41, row2 + 7, 91);\n        dotX += (randomX - 0.5) * spreadRadius * 2;\n        dotY += (randomY - 0.5) * spreadRadius * 2;\n      }\n\n      if (dotX < -grid || dotX > targetWidth + grid || dotY < -grid || dotY > targetHeight + grid) {\n        continue;\n      }\n\n      if (grainMixer > 0) {\n        var imageU = clamp(dotX / targetWidth, 0, 1);\n        var imageV = clamp(dotY / targetHeight, 0, 1);\n        var grainUV = getGrainUv(imageU, imageV, grainSize, imageAspectRatio);\n        var mixerAmount = getGrainMixerAmount(grainUV[0], grainUV[1], grainMixer);\n        finalShape *= 1 - mixerAmount;\n      }\n\n      var radius = maxRadius * finalShape;\n      if (radius <= 0.45) continue;\n\n      var dotColor = settings.colorMode\n        ? 'rgb(' + cellColors[idx2 * 3] + ' ' + cellColors[idx2 * 3 + 1] + ' ' + cellColors[idx2 * 3 + 2] + ')'\n        : settings.inkColor;\n\n      drawHalftoneShape(context, settings.shape, dotX, dotY, radius, dotColor, angleRadians);\n    }\n  }\n\n  if (grainOverlay > 0) {\n    var overlaySize = Math.max(1, grid * 0.24);\n    for (var overlayRow = 0; overlayRow < numRows; overlayRow += 1) {\n      for (var overlayCol = 0; overlayCol < numCols; overlayCol += 1) {\n        var overlayIndex = overlayRow * numCols + overlayCol;\n        var overlayX = posX[overlayIndex];\n        var overlayY = posY[overlayIndex];\n        if (overlayX < -grid || overlayX > targetWidth + grid || overlayY < -grid || overlayY > targetHeight + grid) {\n          continue;\n        }\n        var imageU = clamp(overlayX / targetWidth, 0, 1);\n        var imageV = clamp(overlayY / targetHeight, 0, 1);\n        var overlayGrainUv = getGrainUv(imageU, imageV, grainSize, imageAspectRatio);\n        var overlaySample = getGrainOverlaySample(overlayGrainUv[0], overlayGrainUv[1], grainOverlay);\n        if (overlaySample.strength <= 0.01) {\n          continue;\n        }\n        var tone = overlaySample.isWhite ? 255 : 0;\n        var alpha = 0.5 * overlaySample.strength;\n        context.fillStyle = 'rgba(' + tone + ', ' + tone + ', ' + tone + ', ' + alpha + ')';\n        context.fillRect(overlayX - overlaySize / 2, overlayY - overlaySize / 2, overlaySize, overlaySize);\n      }\n    }\n  }\n}\n\nfunction createMediaSource(type, src) {\n  return new Promise(function(resolve, reject) {\n    if (type === 'video') {\n      var video = document.createElement('video');\n      video.crossOrigin = 'anonymous';\n      video.loop = true;\n      video.muted = true;\n      video.playsInline = true;\n      video.setAttribute('webkit-playsinline', 'true');\n      video.addEventListener('loadeddata', function() { resolve(video); }, { once: true });\n      video.addEventListener('error', function() { reject(new Error('Failed to load video source.')); }, { once: true });\n      video.src = src;\n      video.load();\n      return;\n    }\n\n    var image = new Image();\n    image.crossOrigin = 'anonymous';\n    image.addEventListener('load', function() { resolve(image); }, { once: true });\n    image.addEventListener('error', function() { reject(new Error('Failed to load image source.')); }, { once: true });\n    image.src = src;\n  });\n}\n\nasync function mountHalftoneRuntime(host, config) {\n  var media = config.media;\n  var settings = config.settings;\n  var options = config.options;\n  var render = config.render;\n\n  host.style.position = host.style.position || 'relative';\n  host.style.overflow = host.style.overflow || 'hidden';\n\n  var canvas = document.createElement('canvas');\n  canvas.width = Math.max(1, Math.round(render.width));\n  canvas.height = Math.max(1, Math.round(render.height));\n  canvas.style.width = '100%';\n  canvas.style.height = '100%';\n  canvas.style.objectFit = 'contain';\n  canvas.style.display = 'block';\n  canvas.style.willChange = 'transform, opacity';\n  canvas.style.opacity = options.fadeIn ? '0' : '1';\n\n  host.replaceChildren(canvas);\n\n  var source = await createMediaSource(media.type, media.src);\n  if (options.fadeIn) {\n    requestAnimationFrame(function() {\n      canvas.style.transition = 'opacity 420ms ease';\n      canvas.style.opacity = '1';\n    });\n  }\n\n  var running = true;\n  var raf = 0;\n  var pointerActive = false;\n  var visible = true;\n  var renderedImage = false;\n\n  if (media.type === 'video' && options.autoplay !== false) {\n    source.play().catch(function() {});\n  }\n\n  var draw = function() {\n    if (!running) return;\n\n    if (media.type === 'video') {\n      if (!options.pauseWhenOffscreen || visible) {\n        renderHalftoneFrame(canvas, source, settings, render.scaleFactor, options);\n      }\n      if (options.autoplay !== false) {\n        raf = requestAnimationFrame(draw);\n      }\n    } else if (!renderedImage) {\n      renderHalftoneFrame(canvas, source, settings, render.scaleFactor, options);\n      renderedImage = true;\n    }\n  };\n\n  draw();\n\n  var observer = null;\n  if (options.pauseWhenOffscreen && typeof IntersectionObserver !== 'undefined') {\n    observer = new IntersectionObserver(function(entries) {\n      visible = entries.some(function(entry) { return entry.isIntersecting; });\n      if (media.type === 'video' && options.autoplay !== false) {\n        if (visible) {\n          source.play().catch(function() {});\n        } else {\n          source.pause();\n        }\n      }\n    });\n    observer.observe(host);\n  }\n\n  var handlePointerMove = function(event) {\n    if (!options.enableInteraction) return;\n    pointerActive = true;\n    var bounds = canvas.getBoundingClientRect();\n    var nx = (event.clientX - bounds.left) / bounds.width - 0.5;\n    var ny = (event.clientY - bounds.top) / bounds.height - 0.5;\n    canvas.style.transform = 'scale(1.01) translate(' + (nx * 8).toFixed(2) + 'px, ' + (ny * 8).toFixed(2) + 'px)';\n  };\n\n  var handlePointerLeave = function() {\n    pointerActive = false;\n    canvas.style.transform = 'none';\n  };\n\n  if (options.enableInteraction) {\n    canvas.addEventListener('pointermove', handlePointerMove);\n    canvas.addEventListener('pointerleave', handlePointerLeave);\n  }\n\n  return function cleanup() {\n    running = false;\n    if (raf) {\n      cancelAnimationFrame(raf);\n    }\n    if (observer) {\n      observer.disconnect();\n    }\n    if (options.enableInteraction) {\n      canvas.removeEventListener('pointermove', handlePointerMove);\n      canvas.removeEventListener('pointerleave', handlePointerLeave);\n    }\n    if (media.type === 'video') {\n      source.pause();\n      source.src = '';\n      source.load();\n    }\n    host.replaceChildren();\n  };\n}\n`;

    const jsContents = `const halftoneEmbeddedMedia = {\n  type: '${mediaPayload.mediaType}',\n  src: \`${escapeTemplateLiteral(mediaPayload.dataUrl)}\`\n};\nconst halftoneSettings = ${settingsJson};\nconst halftoneDefaults = ${optionsJson};\nconst halftoneRender = {\n  width: ${targetWidth},\n  height: ${targetHeight},\n  scaleFactor: ${scaleFactor}\n};\n\n${runtimeCore}\n\nexport async function mountHalftoneBackground(target, overrides = {}) {\n  const element = target || document.querySelector('[data-halftone-bg]');\n  if (!element) return () => {};\n\n  const runtimeOptions = { ...halftoneDefaults, ...overrides };\n  const runtimeMedia = {\n    type: overrides.mediaType || halftoneEmbeddedMedia.type,\n    src: overrides.mediaSrc || halftoneEmbeddedMedia.src\n  };\n\n  delete runtimeOptions.mediaType;\n  delete runtimeOptions.mediaSrc;\n\n  return mountHalftoneRuntime(element, {\n    media: runtimeMedia,\n    settings: halftoneSettings,\n    options: runtimeOptions,\n    render: {\n      width: runtimeOptions.width || halftoneRender.width,\n      height: runtimeOptions.height || halftoneRender.height,\n      scaleFactor: runtimeOptions.scaleFactor || halftoneRender.scaleFactor\n    }\n  });\n}\n\nif (typeof window !== 'undefined') {\n  mountHalftoneBackground().catch((error) => {\n    console.error('[Halftone Export]', error);\n  });\n}\n`;

    const htmlWithExternalScript = `<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>Halftone Background</title>\n    <style>\n      html, body { margin: 0; width: 100%; height: 100%; }\n      [data-halftone-bg] { width: 100%; height: 100%; }\n    </style>\n  </head>\n  <body>\n    <div data-halftone-bg></div>\n    <script type=\"module\" src=\"./${exportName}.js\"></script>\n  </body>\n</html>\n`;

    if (exportOptions.splitHtmlJsFile) {
      downloadTextFile(htmlWithExternalScript, `${exportName}.html`, 'text/html;charset=utf-8');
      downloadTextFile(jsContents, `${exportName}.js`, 'application/javascript;charset=utf-8');
      return 'Exported realtime HTML and JS halftone files.';
    }

    const htmlInline = `<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>Halftone Background</title>\n    <style>\n      html, body { margin: 0; width: 100%; height: 100%; }\n      [data-halftone-bg] { width: 100%; height: 100%; }\n    </style>\n  </head>\n  <body>\n    <div data-halftone-bg></div>\n    <script type=\"module\">\n${jsContents}\n    </script>\n  </body>\n</html>\n`;

    downloadTextFile(htmlInline, `${exportName}.html`, 'text/html;charset=utf-8');
    return 'Exported realtime HTML halftone file.';
  }, [downloadTextFile, exportOptions, getCurrentMediaPayload, getExportDimensions, hasSource]);

  const exportReactComponent = useCallback(async () => {
    if (!hasSource || !canvasRef.current) {
      throw new Error('Load an image or video first.');
    }

    const exportName = sanitizeFileName(exportOptions.fileName, 'halftone-export');
    const mediaPayload = await getCurrentMediaPayload();
    const { targetWidth, targetHeight, scaleFactor } = getExportDimensions(exportOptions.resolution);
    const settingsJson = JSON.stringify(settingsRef.current, null, 2);
    const componentName =
      sanitizeFileName(exportName, 'HalftoneBackground')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('') || 'HalftoneBackground';

    const runtimeOptionsJson = JSON.stringify(
      {
        transparentBackground: exportOptions.transparentBackground,
        alphaMaskGradient: exportOptions.alphaMaskGradient,
        pauseWhenOffscreen: exportOptions.pauseWhenOffscreen,
        enableInteraction: exportOptions.enableInteraction,
        fadeIn: exportOptions.fadeIn,
        autoplay: true
      },
      null,
      2
    );

    const runtimeCore = `function clamp(value, min, max) {\n  return Math.max(min, Math.min(max, value));\n}\n\nfunction applyBoxBlur(cellValues, numRows, numCols, strength) {\n  var result = new Float32Array(cellValues);\n  var passes = Math.floor(strength);\n  for (var pass = 0; pass < passes; pass += 1) {\n    var temp = new Float32Array(result.length);\n    for (var row = 0; row < numRows; row += 1) {\n      for (var col = 0; col < numCols; col += 1) {\n        var sum = 0;\n        var count = 0;\n        for (var dy = -1; dy <= 1; dy += 1) {\n          for (var dx = -1; dx <= 1; dx += 1) {\n            var sampleRow = row + dy;\n            var sampleCol = col + dx;\n            if (sampleRow >= 0 && sampleRow < numRows && sampleCol >= 0 && sampleCol < numCols) {\n              sum += result[sampleRow * numCols + sampleCol];\n              count += 1;\n            }\n          }\n        }\n        temp[row * numCols + col] = sum / count;\n      }\n    }\n    result = temp;\n  }\n  var fractional = strength - Math.floor(strength);\n  if (fractional > 0) {\n    for (var i = 0; i < result.length; i += 1) {\n      result[i] = cellValues[i] * (1 - fractional) + result[i] * fractional;\n    }\n  }\n  return result;\n}\n\nfunction applyFloydSteinbergDithering(cellValues, numRows, numCols) {\n  var threshold = 128;\n  for (var row = 0; row < numRows; row += 1) {\n    for (var col = 0; col < numCols; col += 1) {\n      var index = row * numCols + col;\n      var oldValue = cellValues[index];\n      var newValue = oldValue < threshold ? 0 : 255;\n      var error = oldValue - newValue;\n      cellValues[index] = newValue;\n      if (col + 1 < numCols) {\n        cellValues[row * numCols + (col + 1)] += error * (7 / 16);\n      }\n      if (row + 1 < numRows) {\n        if (col - 1 >= 0) {\n          cellValues[(row + 1) * numCols + (col - 1)] += error * (3 / 16);\n        }\n        cellValues[(row + 1) * numCols + col] += error * (5 / 16);\n        if (col + 1 < numCols) {\n          cellValues[(row + 1) * numCols + (col + 1)] += error * (1 / 16);\n        }\n      }\n    }\n  }\n}\n\nfunction applyOrderedDithering(cellValues, numRows, numCols) {\n  var bayerMatrix = [[0, 2], [3, 1]];\n  var matrixSize = 2;\n  for (var row = 0; row < numRows; row += 1) {\n    for (var col = 0; col < numCols; col += 1) {\n      var index = row * numCols + col;\n      var threshold = (bayerMatrix[row % matrixSize][col % matrixSize] + 0.5) * (255 / (matrixSize * matrixSize));\n      cellValues[index] = cellValues[index] < threshold ? 0 : 255;\n    }\n  }\n}\n\nfunction applyNoiseDithering(cellValues) {\n  var threshold = 128;\n  for (var index = 0; index < cellValues.length; index += 1) {\n    var noise = (Math.random() - 0.5) * 50;\n    var adjustedValue = cellValues[index] + noise;\n    cellValues[index] = adjustedValue < threshold ? 0 : 255;\n  }\n}\n\nfunction sampleGrayAt(grayData, width, height, x, y) {\n  var sampleX = clamp(Math.round(x), 0, width - 1);\n  var sampleY = clamp(Math.round(y), 0, height - 1);\n  return grayData[sampleY * width + sampleX];\n}\n\nfunction sampleRgbAt(data, width, height, x, y) {\n  var sampleX = clamp(Math.round(x), 0, width - 1);\n  var sampleY = clamp(Math.round(y), 0, height - 1);\n  var index = (sampleY * width + sampleX) * 4;\n  return [data[index], data[index + 1], data[index + 2]];\n}\n\nfunction pseudoRandom2d(x, y, seed) {\n  var raw = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;\n  return raw - Math.floor(raw);\n}\n\nfunction fract(value) {\n  return value - Math.floor(value);\n}\n\nfunction smoothstep(edge0, edge1, value) {\n  if (Math.abs(edge1 - edge0) < 1e-6) {\n    return value >= edge1 ? 1 : 0;\n  }\n  var t = clamp((value - edge0) / (edge1 - edge0), 0, 1);\n  return t * t * (3 - 2 * t);\n}\n\nfunction hash21(x, y) {\n  var px = fract(x * 0.3183099) + 0.1;\n  var py = fract(y * 0.3678794) + 0.1;\n  var dotTerm = px * (px + 19.19) + py * (py + 19.19);\n  px += dotTerm;\n  py += dotTerm;\n  return fract(px * py);\n}\n\nfunction valueNoise2d(x, y) {\n  var ix = Math.floor(x);\n  var iy = Math.floor(y);\n  var fx = fract(x);\n  var fy = fract(y);\n  var a = hash21(ix, iy);\n  var b = hash21(ix + 1, iy);\n  var c = hash21(ix, iy + 1);\n  var d = hash21(ix + 1, iy + 1);\n  var ux = fx * fx * (3 - 2 * fx);\n  var uy = fy * fy * (3 - 2 * fy);\n  var x1 = a + (b - a) * ux;\n  var x2 = c + (d - c) * ux;\n  return x1 + (x2 - x1) * uy;\n}\n\nfunction rotateVec2(x, y, angleRadians) {\n  var cosAngle = Math.cos(angleRadians);\n  var sinAngle = Math.sin(angleRadians);\n  return [cosAngle * x - sinAngle * y, sinAngle * x + cosAngle * y];\n}\n\nfunction getGrainUv(imageU, imageV, grainSize, imageAspectRatio) {\n  var clampedSize = clamp(grainSize, 0, 1);\n  var grainScale = 2000 + (200 - 2000) * clampedSize;\n  var scaledAspect = Math.max(1e-5, imageAspectRatio);\n  var grainU = imageU - 0.5;\n  var grainV = imageV - 0.5;\n  grainU *= grainScale;\n  grainV *= grainScale * (1 / scaledAspect);\n  grainU += 0.5;\n  grainV += 0.5;\n  return [grainU, grainV];\n}\n\nfunction getGrainMixerAmount(grainU, grainV, grainMixer) {\n  var clampedMixer = clamp(grainMixer, 0, 1);\n  if (clampedMixer <= 0) {\n    return 0;\n  }\n  var grain = valueNoise2d(grainU, grainV);\n  grain = smoothstep(0.55, 0.7 + 0.2 * clampedMixer, grain);\n  return grain * clampedMixer;\n}\n\nfunction getGrainOverlaySample(grainU, grainV, grainOverlay) {\n  var clampedOverlay = clamp(grainOverlay, 0, 1);\n  if (clampedOverlay <= 0) {\n    return { isWhite: true, strength: 0 };\n  }\n  var rotated1 = rotateVec2(grainU, grainV, 1);\n  var overlay = valueNoise2d(rotated1[0] + 3, rotated1[1] + 3);\n  var rotated2 = rotateVec2(grainU, grainV, 2);\n  overlay = overlay * 0.5 + valueNoise2d(rotated2[0] - 1, rotated2[1] - 1) * 0.5;\n  overlay = Math.pow(overlay, 1.3);\n  var overlayValue = overlay * 2 - 1;\n  var strength = clampedOverlay * Math.abs(overlayValue);\n  strength = Math.pow(strength, 0.8);\n  return { isWhite: overlayValue >= 0, strength: strength };\n}\n\nfunction drawHalftoneShape(context, shape, centerX, centerY, radius, color, angleRadians) {\n  context.fillStyle = color;\n  context.strokeStyle = color;\n  if (shape === 'Square') {\n    var side = radius * 2;\n    context.fillRect(centerX - side / 2, centerY - side / 2, side, side);\n    return;\n  }\n  if (shape === 'Diamond') {\n    var diamondSide = radius * Math.SQRT2;\n    context.beginPath();\n    context.moveTo(centerX, centerY - diamondSide);\n    context.lineTo(centerX + diamondSide, centerY);\n    context.lineTo(centerX, centerY + diamondSide);\n    context.lineTo(centerX - diamondSide, centerY);\n    context.closePath();\n    context.fill();\n    return;\n  }\n  if (shape === 'Triangle') {\n    var triangleRadius = radius * 1.25;\n    context.save();\n    context.translate(centerX, centerY);\n    context.rotate(angleRadians);\n    context.beginPath();\n    context.moveTo(0, -triangleRadius);\n    context.lineTo(triangleRadius * 0.9, triangleRadius * 0.75);\n    context.lineTo(-triangleRadius * 0.9, triangleRadius * 0.75);\n    context.closePath();\n    context.fill();\n    context.restore();\n    return;\n  }\n  if (shape === 'Line') {\n    var lineLength = radius * 2;\n    var lineThickness = Math.max(1, radius * 0.55);\n    context.save();\n    context.translate(centerX, centerY);\n    context.rotate(angleRadians);\n    context.beginPath();\n    context.lineWidth = lineThickness;\n    context.lineCap = 'round';\n    context.moveTo(-lineLength / 2, 0);\n    context.lineTo(lineLength / 2, 0);\n    context.stroke();\n    context.restore();\n    return;\n  }\n  context.beginPath();\n  context.arc(centerX, centerY, radius, 0, Math.PI * 2);\n  context.fill();\n}\n\nfunction renderHalftoneFrame(targetCanvas, sourceElement, settings, scaleFactor, options) {\n  var targetWidth = targetCanvas.width;\n  var targetHeight = targetCanvas.height;\n  var tempCanvas = document.createElement('canvas');\n  tempCanvas.width = targetWidth;\n  tempCanvas.height = targetHeight;\n  var tempContext = tempCanvas.getContext('2d', { willReadFrequently: true });\n  if (!tempContext) return;\n\n  var sourceWidth = sourceElement.videoWidth || sourceElement.naturalWidth || sourceElement.width || targetWidth;\n  var sourceHeight = sourceElement.videoHeight || sourceElement.naturalHeight || sourceElement.height || targetHeight;\n\n  if (sourceWidth > 0 && sourceHeight > 0) {\n    var sourceAspect = sourceWidth / sourceHeight;\n    var targetAspect = targetWidth / targetHeight;\n    var drawWidth = targetWidth;\n    var drawHeight = targetHeight;\n    var offsetX = 0;\n    var offsetY = 0;\n\n    if (sourceAspect > targetAspect) {\n      drawHeight = targetWidth / sourceAspect;\n      offsetY = (targetHeight - drawHeight) / 2;\n    } else if (sourceAspect < targetAspect) {\n      drawWidth = targetHeight * sourceAspect;\n      offsetX = (targetWidth - drawWidth) / 2;\n    }\n\n    tempContext.clearRect(0, 0, targetWidth, targetHeight);\n    tempContext.drawImage(sourceElement, offsetX, offsetY, drawWidth, drawHeight);\n  } else {\n    tempContext.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);\n  }\n  var imageData = tempContext.getImageData(0, 0, targetWidth, targetHeight);\n  var data = imageData.data;\n  var contrastAdjustment = clamp(settings.contrast, -255, 255);\n  var contrastFactor = (259 * (contrastAdjustment + 255)) / (255 * (259 - contrastAdjustment));\n  var grayData = new Float32Array(targetWidth * targetHeight);\n\n  for (var index = 0; index < data.length; index += 4) {\n    var gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];\n    gray = contrastFactor * (gray - 128) + 128 + 20;\n    gray = clamp(gray, 0, 255);\n    grayData[index / 4] = gray;\n  }\n\n  var grid = Math.max(1, Math.round(settings.dotSize * scaleFactor));\n  var angleRadians = (settings.angle * Math.PI) / 180;\n  var isAxisAligned = Math.abs(settings.angle) < 0.001;\n  var numCols;\n  var numRows;\n  var cellValues;\n  var posX;\n  var posY;\n  var cellColors;\n\n  if (isAxisAligned) {\n    numCols = Math.ceil(targetWidth / grid);\n    numRows = Math.ceil(targetHeight / grid);\n    cellValues = new Float32Array(numRows * numCols);\n    posX = new Float32Array(numRows * numCols);\n    posY = new Float32Array(numRows * numCols);\n    cellColors = new Uint8ClampedArray(numRows * numCols * 3);\n\n    for (var row = 0; row < numRows; row += 1) {\n      for (var col = 0; col < numCols; col += 1) {\n        var idx = row * numCols + col;\n        var sum = 0;\n        var count = 0;\n        var startY = row * grid;\n        var startX = col * grid;\n        var endY = Math.min(startY + grid, targetHeight);\n        var endX = Math.min(startX + grid, targetWidth);\n\n        for (var y = startY; y < endY; y += 1) {\n          for (var x = startX; x < endX; x += 1) {\n            sum += grayData[y * targetWidth + x];\n            count += 1;\n          }\n        }\n\n        cellValues[idx] = count > 0 ? sum / count : 0;\n        posX[idx] = col * grid + grid / 2;\n        posY[idx] = row * grid + grid / 2;\n\n        if (settings.colorMode) {\n          var rgb = sampleRgbAt(data, targetWidth, targetHeight, posX[idx], posY[idx]);\n          var colorIndex = idx * 3;\n          cellColors[colorIndex] = rgb[0];\n          cellColors[colorIndex + 1] = rgb[1];\n          cellColors[colorIndex + 2] = rgb[2];\n        }\n      }\n    }\n  } else {\n    var diagonal = Math.ceil(Math.sqrt(targetWidth * targetWidth + targetHeight * targetHeight));\n    numCols = Math.ceil(diagonal / grid) + 2;\n    numRows = Math.ceil(diagonal / grid) + 2;\n    var halfCols = numCols / 2;\n    var halfRows = numRows / 2;\n    var cosAngle = Math.cos(angleRadians);\n    var sinAngle = Math.sin(angleRadians);\n    var centerX = targetWidth / 2;\n    var centerY = targetHeight / 2;\n\n    cellValues = new Float32Array(numRows * numCols);\n    posX = new Float32Array(numRows * numCols);\n    posY = new Float32Array(numRows * numCols);\n    cellColors = new Uint8ClampedArray(numRows * numCols * 3);\n\n    for (var r = 0; r < numRows; r += 1) {\n      for (var c = 0; c < numCols; c += 1) {\n        var index2 = r * numCols + c;\n        var localX = (c - halfCols + 0.5) * grid;\n        var localY = (r - halfRows + 0.5) * grid;\n        var rotatedX = centerX + localX * cosAngle - localY * sinAngle;\n        var rotatedY = centerY + localX * sinAngle + localY * cosAngle;\n\n        posX[index2] = rotatedX;\n        posY[index2] = rotatedY;\n        cellValues[index2] = sampleGrayAt(grayData, targetWidth, targetHeight, rotatedX, rotatedY);\n\n        if (settings.colorMode) {\n          var rgb2 = sampleRgbAt(data, targetWidth, targetHeight, rotatedX, rotatedY);\n          var colorIndex2 = index2 * 3;\n          cellColors[colorIndex2] = rgb2[0];\n          cellColors[colorIndex2 + 1] = rgb2[1];\n          cellColors[colorIndex2 + 2] = rgb2[2];\n        }\n      }\n    }\n  }\n\n  if (settings.smoothing > 0) {\n    cellValues = applyBoxBlur(cellValues, numRows, numCols, settings.smoothing);\n  }\n  if (settings.ditherType === 'FloydSteinberg') {\n    applyFloydSteinbergDithering(cellValues, numRows, numCols);\n  } else if (settings.ditherType === 'Ordered') {\n    applyOrderedDithering(cellValues, numRows, numCols);\n  } else if (settings.ditherType === 'Noise') {\n    applyNoiseDithering(cellValues);\n  }\n\n  var context = targetCanvas.getContext('2d');\n  if (!context) return;\n\n  if (options.transparentBackground) {\n    context.clearRect(0, 0, targetWidth, targetHeight);\n  } else {\n    context.fillStyle = settings.paperColor;\n    context.fillRect(0, 0, targetWidth, targetHeight);\n  }\n\n  var maxRadius = grid / 2;\n  var spreadRadius = (settings.spread / 100) * grid * 0.8;\n  var grainMixer = typeof settings.grainMixer === 'number' ? clamp(settings.grainMixer, 0, 1) : 0;\n  var grainOverlay = typeof settings.grainOverlay === 'number' ? clamp(settings.grainOverlay, 0, 1) : 0;\n  var grainSize = typeof settings.grainSize === 'number' ? clamp(settings.grainSize, 0, 1) : 0;\n  var imageAspectRatio = targetWidth / Math.max(1, targetHeight);\n\n  for (var row2 = 0; row2 < numRows; row2 += 1) {\n    for (var col2 = 0; col2 < numCols; col2 += 1) {\n      var idx2 = row2 * numCols + col2;\n      var brightnessValue = clamp(cellValues[idx2], 0, 255);\n      var normalized = brightnessValue / 255;\n      var tone = settings.inverted ? normalized : 1 - normalized;\n      var finalShape = tone;\n\n      var dotX = posX[idx2];\n      var dotY = posY[idx2];\n      if (spreadRadius > 0) {\n        var randomX = pseudoRandom2d(col2 + 13, row2 + 29, 17);\n        var randomY = pseudoRandom2d(col2 + 41, row2 + 7, 91);\n        dotX += (randomX - 0.5) * spreadRadius * 2;\n        dotY += (randomY - 0.5) * spreadRadius * 2;\n      }\n\n      if (dotX < -grid || dotX > targetWidth + grid || dotY < -grid || dotY > targetHeight + grid) {\n        continue;\n      }\n\n      if (grainMixer > 0) {\n        var imageU = clamp(dotX / targetWidth, 0, 1);\n        var imageV = clamp(dotY / targetHeight, 0, 1);\n        var grainUV = getGrainUv(imageU, imageV, grainSize, imageAspectRatio);\n        var mixerAmount = getGrainMixerAmount(grainUV[0], grainUV[1], grainMixer);\n        finalShape *= 1 - mixerAmount;\n      }\n\n      var radius = maxRadius * finalShape;\n      if (radius <= 0.45) continue;\n\n      var dotColor = settings.colorMode\n        ? 'rgb(' + cellColors[idx2 * 3] + ' ' + cellColors[idx2 * 3 + 1] + ' ' + cellColors[idx2 * 3 + 2] + ')'\n        : settings.inkColor;\n\n      drawHalftoneShape(context, settings.shape, dotX, dotY, radius, dotColor, angleRadians);\n    }\n  }\n\n  if (grainOverlay > 0) {\n    var overlaySize = Math.max(1, grid * 0.24);\n    for (var overlayRow = 0; overlayRow < numRows; overlayRow += 1) {\n      for (var overlayCol = 0; overlayCol < numCols; overlayCol += 1) {\n        var overlayIndex = overlayRow * numCols + overlayCol;\n        var overlayX = posX[overlayIndex];\n        var overlayY = posY[overlayIndex];\n        if (overlayX < -grid || overlayX > targetWidth + grid || overlayY < -grid || overlayY > targetHeight + grid) {\n          continue;\n        }\n        var imageU = clamp(overlayX / targetWidth, 0, 1);\n        var imageV = clamp(overlayY / targetHeight, 0, 1);\n        var overlayGrainUv = getGrainUv(imageU, imageV, grainSize, imageAspectRatio);\n        var overlaySample = getGrainOverlaySample(overlayGrainUv[0], overlayGrainUv[1], grainOverlay);\n        if (overlaySample.strength <= 0.01) {\n          continue;\n        }\n        var tone = overlaySample.isWhite ? 255 : 0;\n        var alpha = 0.5 * overlaySample.strength;\n        context.fillStyle = 'rgba(' + tone + ', ' + tone + ', ' + tone + ', ' + alpha + ')';\n        context.fillRect(overlayX - overlaySize / 2, overlayY - overlaySize / 2, overlaySize, overlaySize);\n      }\n    }\n  }\n}\n\nfunction createMediaSource(type, src) {\n  return new Promise(function(resolve, reject) {\n    if (type === 'video') {\n      var video = document.createElement('video');\n      video.crossOrigin = 'anonymous';\n      video.loop = true;\n      video.muted = true;\n      video.playsInline = true;\n      video.setAttribute('webkit-playsinline', 'true');\n      video.addEventListener('loadeddata', function() { resolve(video); }, { once: true });\n      video.addEventListener('error', function() { reject(new Error('Failed to load video source.')); }, { once: true });\n      video.src = src;\n      video.load();\n      return;\n    }\n\n    var image = new Image();\n    image.crossOrigin = 'anonymous';\n    image.addEventListener('load', function() { resolve(image); }, { once: true });\n    image.addEventListener('error', function() { reject(new Error('Failed to load image source.')); }, { once: true });\n    image.src = src;\n  });\n}\n\nasync function mountHalftoneRuntime(host, config) {\n  var media = config.media;\n  var settings = config.settings;\n  var options = config.options;\n  var render = config.render;\n\n  host.style.position = host.style.position || 'relative';\n  host.style.overflow = host.style.overflow || 'hidden';\n\n  var canvas = document.createElement('canvas');\n  canvas.width = Math.max(1, Math.round(render.width));\n  canvas.height = Math.max(1, Math.round(render.height));\n  canvas.style.width = '100%';\n  canvas.style.height = '100%';\n  canvas.style.objectFit = 'contain';\n  canvas.style.display = 'block';\n  canvas.style.willChange = 'transform, opacity';\n  canvas.style.opacity = options.fadeIn ? '0' : '1';\n\n  host.replaceChildren(canvas);\n\n  var source = await createMediaSource(media.type, media.src);\n  if (options.fadeIn) {\n    requestAnimationFrame(function() {\n      canvas.style.transition = 'opacity 420ms ease';\n      canvas.style.opacity = '1';\n    });\n  }\n\n  var running = true;\n  var raf = 0;\n  var visible = true;\n  var renderedImage = false;\n\n  if (media.type === 'video' && options.autoplay !== false) {\n    source.play().catch(function() {});\n  }\n\n  var draw = function() {\n    if (!running) return;\n\n    if (media.type === 'video') {\n      if (!options.pauseWhenOffscreen || visible) {\n        renderHalftoneFrame(canvas, source, settings, render.scaleFactor, options);\n      }\n      if (options.autoplay !== false) {\n        raf = requestAnimationFrame(draw);\n      }\n    } else if (!renderedImage) {\n      renderHalftoneFrame(canvas, source, settings, render.scaleFactor, options);\n      renderedImage = true;\n    }\n  };\n\n  draw();\n\n  var observer = null;\n  if (options.pauseWhenOffscreen && typeof IntersectionObserver !== 'undefined') {\n    observer = new IntersectionObserver(function(entries) {\n      visible = entries.some(function(entry) { return entry.isIntersecting; });\n      if (media.type === 'video' && options.autoplay !== false) {\n        if (visible) {\n          source.play().catch(function() {});\n        } else {\n          source.pause();\n        }\n      }\n    });\n    observer.observe(host);\n  }\n\n  var handlePointerMove = function(event) {\n    if (!options.enableInteraction) return;\n    var bounds = canvas.getBoundingClientRect();\n    var nx = (event.clientX - bounds.left) / bounds.width - 0.5;\n    var ny = (event.clientY - bounds.top) / bounds.height - 0.5;\n    canvas.style.transform = 'scale(1.01) translate(' + (nx * 8).toFixed(2) + 'px, ' + (ny * 8).toFixed(2) + 'px)';\n  };\n\n  var handlePointerLeave = function() {\n    canvas.style.transform = 'none';\n  };\n\n  if (options.enableInteraction) {\n    canvas.addEventListener('pointermove', handlePointerMove);\n    canvas.addEventListener('pointerleave', handlePointerLeave);\n  }\n\n  return function cleanup() {\n    running = false;\n    if (raf) {\n      cancelAnimationFrame(raf);\n    }\n    if (observer) {\n      observer.disconnect();\n    }\n    if (options.enableInteraction) {\n      canvas.removeEventListener('pointermove', handlePointerMove);\n      canvas.removeEventListener('pointerleave', handlePointerLeave);\n    }\n    if (media.type === 'video') {\n      source.pause();\n      source.src = '';\n      source.load();\n    }\n    host.replaceChildren();\n  };\n}\n`;

    const componentSource = `import React, { useEffect, useRef } from 'react';\n\nconst embeddedMedia = {\n  type: '${mediaPayload.mediaType}',\n  src: \`${escapeTemplateLiteral(mediaPayload.dataUrl)}\`\n};\nconst defaultSettings = ${settingsJson};\nconst defaultOptions = ${runtimeOptionsJson};\nconst defaultRender = {\n  width: ${targetWidth},\n  height: ${targetHeight},\n  scaleFactor: ${scaleFactor}\n};\n\n${runtimeCore}\n\nexport default function ${componentName}({\n  children,\n  className = '',\n  style = {},\n  mediaType,\n  mediaSrc,\n  settings = defaultSettings,\n  autoplay = defaultOptions.autoplay,\n  pauseWhenOffscreen = defaultOptions.pauseWhenOffscreen,\n  enableInteraction = defaultOptions.enableInteraction,\n  transparentBackground = defaultOptions.transparentBackground,\n  alphaMaskGradient = defaultOptions.alphaMaskGradient,\n  fadeIn = defaultOptions.fadeIn,\n  renderWidth = defaultRender.width,\n  renderHeight = defaultRender.height,\n  scaleFactor = defaultRender.scaleFactor\n}) {\n  const renderRef = useRef(null);\n\n  useEffect(() => {\n    if (!renderRef.current) {\n      return undefined;\n    }\n\n    let disposed = false;\n    let cleanup = () => {};\n\n    mountHalftoneRuntime(renderRef.current, {\n      media: {\n        type: mediaType || embeddedMedia.type,\n        src: mediaSrc || embeddedMedia.src\n      },\n      settings,\n      options: {\n        autoplay,\n        pauseWhenOffscreen,\n        enableInteraction,\n        transparentBackground,\n        alphaMaskGradient,\n        fadeIn\n      },\n      render: {\n        width: renderWidth,\n        height: renderHeight,\n        scaleFactor\n      }\n    })\n      .then((disposeFn) => {\n        if (disposed) {\n          disposeFn();\n          return;\n        }\n        cleanup = disposeFn;\n      })\n      .catch((error) => {\n        console.error('[Halftone Export]', error);\n      });\n\n    return () => {\n      disposed = true;\n      cleanup();\n    };\n  }, [\n    mediaType,\n    mediaSrc,\n    settings,\n    autoplay,\n    pauseWhenOffscreen,\n    enableInteraction,\n    transparentBackground,\n    alphaMaskGradient,\n    fadeIn,\n    renderWidth,\n    renderHeight,\n    scaleFactor\n  ]);\n\n  return (\n    <div\n      className={className}\n      style={{\n        position: 'relative',\n        width: '100%',\n        height: '100%',\n        overflow: 'hidden',\n        ...style\n      }}\n    >\n      <div ref={renderRef} style={{ position: 'absolute', inset: 0 }} />\n      {children ? <div style={{ position: 'relative', zIndex: 2 }}>{children}</div> : null}\n    </div>\n  );\n}\n`;

    downloadTextFile(componentSource, `${exportName}.jsx`, 'text/javascript;charset=utf-8');
    return `Exported realtime React component (${componentName}.jsx).`;
  }, [downloadTextFile, exportOptions, getCurrentMediaPayload, getExportDimensions, hasSource]);

  const runModalExport = useCallback(async () => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setExportStatusMessage('');

    try {
      let message = '';
      if (activeExportType === EXPORT_TYPES.png) {
        message = exportCurrentFrame();
      } else if (activeExportType === EXPORT_TYPES.gif) {
        message = await exportGif();
      } else if (activeExportType === EXPORT_TYPES.mp4) {
        message = await exportMp4();
      } else if (activeExportType === EXPORT_TYPES.htmlJsBg) {
        message = await exportHtmlJsBackground();
      } else if (activeExportType === EXPORT_TYPES.reactComponent) {
        message = await exportReactComponent();
      }

      setExportStatusMessage(message || 'Export complete.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed.';
      setExportStatusMessage(message);
    } finally {
      setIsExporting(false);
    }
  }, [activeExportType, exportCurrentFrame, exportGif, exportHtmlJsBackground, exportMp4, exportReactComponent, isExporting]);

  const resetDialValues = useCallback(() => {
    const panel = DialStore.getPanels().find((entry) => entry.name === PANEL_NAME);
    if (!panel) {
      return;
    }

    DialStore.updateValue(panel.id, 'Style.dotSize', DEFAULT_SETTINGS.dotSize);
    DialStore.updateValue(panel.id, 'Style.angle', DEFAULT_SETTINGS.angle);
    DialStore.updateValue(panel.id, 'Style.contrast', DEFAULT_SETTINGS.contrast);
    DialStore.updateValue(panel.id, 'Style.spread', DEFAULT_SETTINGS.spread);
    DialStore.updateValue(panel.id, 'Style.shape', DEFAULT_SETTINGS.shape);
    DialStore.updateValue(panel.id, 'Style.preset', DEFAULT_SETTINGS.preset);
    DialStore.updateValue(panel.id, 'Style.pageBackground', DEFAULT_SETTINGS.pageBackground);
    DialStore.updateValue(panel.id, 'Style.paperColor', DEFAULT_SETTINGS.paperColor);
    DialStore.updateValue(panel.id, 'Style.inkColor', DEFAULT_SETTINGS.inkColor);
    DialStore.updateValue(panel.id, 'Style.colorMode', DEFAULT_SETTINGS.colorMode);
    DialStore.updateValue(panel.id, 'Style.inverted', DEFAULT_SETTINGS.inverted);
    DialStore.updateValue(panel.id, 'Advanced.smoothing', DEFAULT_SETTINGS.smoothing);
    DialStore.updateValue(panel.id, 'Advanced.ditherType', DEFAULT_SETTINGS.ditherType);
    DialStore.updateValue(panel.id, 'Advanced.grainMixer', DEFAULT_SETTINGS.grainMixer);
    DialStore.updateValue(panel.id, 'Advanced.grainOverlay', DEFAULT_SETTINGS.grainOverlay);
    DialStore.updateValue(panel.id, 'Advanced.grainSize', DEFAULT_SETTINGS.grainSize);
    DialStore.updateValue(panel.id, 'View.zoom', DEFAULT_ZOOM);
    presetRef.current = DEFAULT_SETTINGS.preset;
  }, []);

  const updateDialValue = useCallback((path, value) => {
    const panel = DialStore.getPanels().find((entry) => entry.name === PANEL_NAME);
    if (!panel) {
      return;
    }
    DialStore.updateValue(panel.id, path, value);
  }, []);

  const handleDialAction = useCallback(
    (path) => {
      if (path === ACTION_PATHS.uploadMedia) {
        fileInputRef.current?.click();
        return;
      }

      if (path === ACTION_PATHS.resetSettings) {
        resetDialValues();
        return;
      }

      if (path === ACTION_PATHS.openExport) {
        openExportModal(activeExportType);
        return;
      }

      if (path === ACTION_PATHS.resetView) {
        updateDialValue('View.zoom', DEFAULT_ZOOM);
        return;
      }

      if (path === ACTION_PATHS.matchPageToPaper) {
        updateDialValue('Style.pageBackground', settingsRef.current.paperColor);
      }
    },
    [activeExportType, openExportModal, resetDialValues, updateDialValue]
  );

  const dialConfig = useMemo(
    () => ({
      Media: {
        uploadMedia: { type: 'action', label: 'Upload Image/Video' }
      },
      Style: {
        dotSize: [DEFAULT_SETTINGS.dotSize, 2, 60, 1],
        angle: [DEFAULT_SETTINGS.angle, -90, 90, 1],
        contrast: [DEFAULT_SETTINGS.contrast, -255, 255, 1],
        spread: [DEFAULT_SETTINGS.spread, 0, 100, 1],
        shape: {
          type: 'select',
          options: ['Circle', 'Square', 'Diamond', 'Triangle', 'Line'],
          default: DEFAULT_SETTINGS.shape
        },
        preset: {
          type: 'select',
          options: COLOR_PRESETS.map((entry) => entry.name),
          default: DEFAULT_SETTINGS.preset
        },
        paperColor: DEFAULT_SETTINGS.paperColor,
        inkColor: DEFAULT_SETTINGS.inkColor,
        pageBackground: DEFAULT_SETTINGS.pageBackground,
        matchPageToPaper: { type: 'action', label: 'Match Page to Paper' },
        colorMode: DEFAULT_SETTINGS.colorMode,
        inverted: DEFAULT_SETTINGS.inverted
      },
      Advanced: {
        smoothing: [DEFAULT_SETTINGS.smoothing, 0, 5, 0.5],
        ditherType: {
          type: 'select',
          options: [
            { value: 'None', label: 'No Dither' },
            { value: 'FloydSteinberg', label: 'Smooth Transition' },
            { value: 'Ordered', label: 'Patterned Look' },
            { value: 'Noise', label: 'Grainy Texture' }
          ],
          default: DEFAULT_SETTINGS.ditherType
        },
        grainMixer: [DEFAULT_SETTINGS.grainMixer, 0, 1, 0.01],
        grainOverlay: [DEFAULT_SETTINGS.grainOverlay, 0, 1, 0.01],
        grainSize: [DEFAULT_SETTINGS.grainSize, 0, 1, 0.01]
      },
      View: {
        zoom: [DEFAULT_ZOOM, VIEW_LIMITS.minZoom, VIEW_LIMITS.maxZoom, 0.05]
      },
      resetSettings: { type: 'action', label: 'Reset Settings' },
      resetView: { type: 'action', label: 'Reset View' },
      openExport: { type: 'action', label: 'Export' }
    }),
    []
  );

  const dialValues = useDialKit(PANEL_NAME, dialConfig, {
    onAction: handleDialAction
  });

  useEffect(() => {
    const presetName = dialValues.Style.preset;
    if (presetRef.current === presetName) {
      return;
    }

    presetRef.current = presetName;
    const selectedPreset = COLOR_PRESETS.find((entry) => entry.name === presetName);
    if (!selectedPreset) {
      return;
    }

    updateDialValue('Style.paperColor', selectedPreset.paperColor);
    updateDialValue('Style.inkColor', selectedPreset.inkColor);
  }, [dialValues.Style.preset, updateDialValue]);

  const activeSettings = useMemo(
    () => ({
      dotSize: dialValues.Style.dotSize,
      angle: dialValues.Style.angle,
      contrast: dialValues.Style.contrast,
      spread: dialValues.Style.spread,
      shape: dialValues.Style.shape,
      pageBackground: dialValues.Style.pageBackground,
      paperColor: dialValues.Style.paperColor,
      inkColor: dialValues.Style.inkColor,
      colorMode: dialValues.Style.colorMode,
      inverted: dialValues.Style.inverted,
      smoothing: dialValues.Advanced.smoothing,
      ditherType: dialValues.Advanced.ditherType,
      grainMixer: dialValues.Advanced.grainMixer,
      grainOverlay: dialValues.Advanced.grainOverlay,
      grainSize: dialValues.Advanced.grainSize
    }),
    [dialValues]
  );
  const zoom = dialValues.View.zoom;
  const isAnimationExport = activeExportType === EXPORT_TYPES.gif || activeExportType === EXPORT_TYPES.mp4;
  const isCodeExport =
    activeExportType === EXPORT_TYPES.htmlJsBg || activeExportType === EXPORT_TYPES.reactComponent;

  const exportDescription = useMemo(() => {
    if (activeExportType === EXPORT_TYPES.png) {
      return 'Export a still image from the current canvas at the source resolution.';
    }

    if (activeExportType === EXPORT_TYPES.gif) {
      return 'Export an animated GIF from the current canvas with your chosen duration, FPS, and resolution.';
    }

    if (activeExportType === EXPORT_TYPES.mp4) {
      return 'Export a video from the current canvas. MP4 is used when available in your browser.';
    }

    if (activeExportType === EXPORT_TYPES.htmlJsBg) {
      return 'Generate a ready-to-use HTML + JS background export based on the current halftone output.';
    }

    return 'Generate a React component file with the current halftone output embedded as a background.';
  }, [activeExportType]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!isExportModalOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscapeClose = (event) => {
      if (event.key === 'Escape') {
        closeExportModal();
      }
    };

    window.addEventListener('keydown', handleEscapeClose, true);
    return () => {
      window.removeEventListener('keydown', handleEscapeClose, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeExportModal, isExportModalOpen]);

  const applyZoomValue = useCallback(
    (nextZoom) => {
      const clamped = clamp(nextZoom, VIEW_LIMITS.minZoom, VIEW_LIMITS.maxZoom);
      if (Math.abs(clamped - zoomRef.current) < 0.001) {
        return;
      }
      updateDialValue('View.zoom', Number(clamped.toFixed(3)));
    },
    [updateDialValue]
  );

  useEffect(() => {
    const handleWheelZoom = (event) => {
      if (isExportModalOpen) {
        return;
      }

      if ((!event.metaKey && !event.ctrlKey) || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      applyZoomValue(zoomRef.current * multiplier);
    };

    window.addEventListener('wheel', handleWheelZoom, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheelZoom, true);
  }, [applyZoomValue, isExportModalOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isExportModalOpen) {
        return;
      }

      if ((!event.metaKey && !event.ctrlKey) || isEditableTarget(event.target)) {
        return;
      }

      let nextZoom = zoomRef.current;

      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
        nextZoom = zoomRef.current * KEYBOARD_ZOOM_STEP;
      } else if (event.key === '-' || event.code === 'NumpadSubtract') {
        nextZoom = zoomRef.current / KEYBOARD_ZOOM_STEP;
      } else if (event.key === '0') {
        nextZoom = 1;
      } else {
        return;
      }

      event.preventDefault();
      applyZoomValue(nextZoom);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [applyZoomValue, isExportModalOpen]);

  const handleFileUpload = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) {
        return;
      }

      const objectUrl = URL.createObjectURL(file);

      if (file.type.startsWith('video/')) {
        loadVideoSource(objectUrl, objectUrl);
        return;
      }

      if (file.type.startsWith('image/')) {
        loadImageSource(objectUrl, objectUrl);
      }
    },
    [loadImageSource, loadVideoSource]
  );

  useEffect(() => {
    settingsRef.current = activeSettings;

    if (hasSource && !mediaRef.current.isVideo) {
      processFrame();
      return;
    }

    if (!hasSource) {
      paintWhiteCanvas(canvasRef.current);
    }
  }, [activeSettings, hasSource, paintWhiteCanvas, processFrame]);

  useEffect(() => {
    fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
    paintWhiteCanvas(canvasRef.current);
  }, [fitCanvas, paintWhiteCanvas]);

  useEffect(() => {
    loadVideoSource('/default-media.mp4');
  }, [loadVideoSource]);

  useEffect(() => {
    const handleResize = () => {
      fitCanvas(sourceSizeRef.current.width, sourceSizeRef.current.height);
      if (hasSource) {
        processFrame();
      } else {
        paintWhiteCanvas(canvasRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitCanvas, hasSource, paintWhiteCanvas, processFrame]);

  useEffect(() => {
    return () => {
      clearMedia();
    };
  }, [clearMedia]);

  return (
    <div className="app-shell" style={{ background: activeSettings.pageBackground }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      <main className="canvas-stage">
        <div
          ref={viewportRef}
          className="canvas-viewport"
        >
          <div className="canvas-pan-layer">
            <div
              className="canvas-transform-layer"
              style={{
                width: `${canvasSize.width * zoom}px`,
                height: `${canvasSize.height * zoom}px`
              }}
            >
              <canvas
                id="halftoneCanvas"
                ref={canvasRef}
                style={{
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left'
                }}
              />
            </div>
          </div>
        </div>
      </main>

      {isExportModalOpen && (
        <div
          className="export-modal-backdrop"
          onClick={closeExportModal}
        >
          <section
            className="export-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export options"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="export-modal-header">
              <div className="export-heading-block">
                <h2>Export Options</h2>
              </div>
              <button
                type="button"
                className="export-close-button"
                onClick={closeExportModal}
                disabled={isExporting}
                aria-label="Close export modal"
                title="Close"
              >
                <svg className="export-close-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3.5 3.5L12.5 12.5" />
                  <path d="M12.5 3.5L3.5 12.5" />
                </svg>
              </button>
            </header>

            <div className="export-layout">
              <aside className="export-sidebar">
                <div className="export-tab-grid">
                  {EXPORT_TAB_ORDER.map((exportType) => (
                    <button
                      key={exportType}
                      type="button"
                      className={`export-tab-button ${activeExportType === exportType ? 'is-active' : ''}`}
                      onClick={() => setActiveExportType(exportType)}
                      disabled={isExporting}
                    >
                      <strong>{EXPORT_TYPE_LABELS[exportType]}</strong>
                      <span>{EXPORT_TYPE_META[exportType]}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="export-main">
                <div className="export-main-scroll">
                  <section className="export-panel">
                    <div className="export-section-heading">
                      <h3>Setup</h3>
                      <p>{exportDescription}</p>
                    </div>

                    <div className="export-options-grid">
                      <label className="export-field">
                        <span>File Name</span>
                        <input
                          type="text"
                          value={exportOptions.fileName}
                          onChange={(event) => updateExportOption('fileName', event.target.value)}
                          disabled={isExporting}
                        />
                      </label>

                    <label className="export-field">
                      <span>Resolution</span>
                      <ExportDropdown
                        value={exportOptions.resolution}
                        options={EXPORT_RESOLUTION_OPTIONS}
                        onChange={(nextValue) => updateExportOption('resolution', nextValue)}
                        disabled={isExporting}
                        ariaLabel="Resolution"
                      />
                    </label>

                      {isAnimationExport && (
                        <label className="export-field">
                          <span>Duration (sec)</span>
                          <input
                            type="number"
                            min="0.5"
                            max="30"
                            step="0.5"
                            value={exportOptions.durationSec}
                            onChange={(event) => updateExportOption('durationSec', event.target.value)}
                            disabled={isExporting}
                          />
                        </label>
                      )}

                      {isAnimationExport && (
                        <label className="export-field">
                          <span>FPS</span>
                          <input
                            type="number"
                            min="1"
                            max="60"
                            step="1"
                            value={exportOptions.fps}
                            onChange={(event) => updateExportOption('fps', event.target.value)}
                            disabled={isExporting}
                          />
                        </label>
                      )}

                      {activeExportType === EXPORT_TYPES.mp4 && (
                      <label className="export-field">
                        <span>Video Quality</span>
                        <ExportDropdown
                          value={exportOptions.videoQuality}
                          options={VIDEO_QUALITY_OPTIONS}
                          onChange={(nextValue) => updateExportOption('videoQuality', nextValue)}
                          disabled={isExporting}
                          ariaLabel="Video quality"
                        />
                      </label>
                    )}
                    </div>
                  </section>

                  {isCodeExport && (
                    <section className="export-panel export-runtime-panel">
                      <div className="export-section-heading">
                        <h3>Runtime Options</h3>
                        <p>Toggle how the generated background behaves once it is embedded.</p>
                      </div>

                      <div className="export-checkbox-grid">
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.transparentBackground}
                            onChange={(event) => updateExportOption('transparentBackground', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Transparent background</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.enableInteraction}
                            onChange={(event) => updateExportOption('enableInteraction', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Enable hover + click interaction</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.alphaMaskGradient}
                            onChange={(event) => updateExportOption('alphaMaskGradient', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Alpha mask gradient</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.fadeIn}
                            onChange={(event) => updateExportOption('fadeIn', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Fade in</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.pauseWhenOffscreen}
                            onChange={(event) => updateExportOption('pauseWhenOffscreen', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Pause when off-screen</span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={exportOptions.adaptivePerformance}
                            onChange={(event) => updateExportOption('adaptivePerformance', event.target.checked)}
                            disabled={isExporting}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>Adaptive performance</span>
                        </label>
                        <label className={`export-checkbox-wide ${activeExportType === EXPORT_TYPES.htmlJsBg ? '' : 'is-placeholder'}`}>
                          <input
                            type="checkbox"
                            checked={exportOptions.splitHtmlJsFile}
                            onChange={(event) => updateExportOption('splitHtmlJsFile', event.target.checked)}
                            disabled={isExporting || !isCodeExport || activeExportType !== EXPORT_TYPES.htmlJsBg}
                          />
                          <span className="export-checkbox-mark" aria-hidden="true" />
                          <span>
                            Split into HTML + external
                            <br />
                            JavaScript file
                          </span>
                        </label>
                      </div>
                    </section>
                  )}
                </div>

                <footer className="export-actions">
                  {exportStatusMessage ? <p className="export-status">{exportStatusMessage}</p> : <div className="export-status-spacer" />}
                  <button
                    type="button"
                    className="export-run-button"
                    onClick={runModalExport}
                    disabled={isExporting}
                  >
                    {isExporting ? 'Exporting...' : `Export ${EXPORT_TYPE_LABELS[activeExportType]}`}
                  </button>
                </footer>
              </div>
            </div>
          </section>
        </div>
      )}

      <DialRoot position="top-right" defaultOpen />
    </div>
  );
}

export default App;
