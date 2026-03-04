import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialRoot, DialStore, useDialKit } from 'dialkit';
import 'dialkit/styles.css';

const PANEL_NAME = 'Mono Halftone';

const DEFAULT_SETTINGS = {
  dotSize: 20,
  angle: 0,
  contrast: 0,
  spread: 0,
  shape: 'Circle',
  preset: 'Classic',
  pageBackground: '#070707',
  paperColor: '#FFFFFF',
  inkColor: '#000000',
  colorMode: false,
  inverted: false,
  smoothing: 0,
  ditherType: 'None'
};

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
  resetAll: 'Actions.resetAll',
  exportPng: 'Actions.exportPng',
  resetView: 'Actions.resetView',
  matchPageToPaper: 'Style.matchPageToPaper'
};

const VIEW_LIMITS = {
  minZoom: 0.25,
  maxZoom: 4
};
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

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const index = row * numCols + col;
      const brightnessValue = clamp(cellValues[index], 0, 255);
      const normalized = brightnessValue / 255;
      const tone = settings.inverted ? normalized : 1 - normalized;
      const radius = maxRadius * tone;

      if (radius <= 0.45) {
        continue;
      }

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

      const dotColor = settings.colorMode
        ? `rgb(${cellColors[index * 3]} ${cellColors[index * 3 + 1]} ${cellColors[index * 3 + 2]})`
        : settings.inkColor;

      drawHalftoneShape(context, settings.shape, dotX, dotY, radius, dotColor, angleRadians);
    }
  }
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

  const exportCurrentFrame = useCallback(() => {
    if (!hasSource) {
      return;
    }

    const media = mediaRef.current;
    const sourceElement = media.isVideo ? media.video : media.image;

    if (!sourceElement || !canvasRef.current) {
      return;
    }

    const exportCanvas = document.createElement('canvas');
    processFrame(2, exportCanvas);

    const dataUrl = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'halftone.png';
    link.click();
  }, [hasSource, processFrame]);

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
    DialStore.updateValue(panel.id, 'View.zoom', 1);
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

      if (path === ACTION_PATHS.resetAll) {
        resetDialValues();
        return;
      }

      if (path === ACTION_PATHS.exportPng) {
        exportCurrentFrame();
        return;
      }

      if (path === ACTION_PATHS.resetView) {
        updateDialValue('View.zoom', 1);
        return;
      }

      if (path === ACTION_PATHS.matchPageToPaper) {
        updateDialValue('Style.pageBackground', settingsRef.current.paperColor);
      }
    },
    [exportCurrentFrame, resetDialValues, updateDialValue]
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
        }
      },
      View: {
        zoom: [1, VIEW_LIMITS.minZoom, VIEW_LIMITS.maxZoom, 0.05]
      },
      Actions: {
        resetAll: { type: 'action', label: 'Reset All' },
        exportPng: { type: 'action', label: 'Export PNG' },
        resetView: { type: 'action', label: 'Reset View' }
      }
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
      ditherType: dialValues.Advanced.ditherType
    }),
    [dialValues]
  );
  const zoom = dialValues.View.zoom;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

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
      if ((!event.metaKey && !event.ctrlKey) || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      applyZoomValue(zoomRef.current * multiplier);
    };

    window.addEventListener('wheel', handleWheelZoom, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheelZoom, true);
  }, [applyZoomValue]);

  useEffect(() => {
    const handleKeyDown = (event) => {
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
  }, [applyZoomValue]);

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

      <DialRoot position="top-right" defaultOpen />
    </div>
  );
}

export default App;
