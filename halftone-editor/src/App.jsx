import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DialRoot, DialStore, useDialKit } from 'dialkit';
import 'dialkit/styles.css';

const PANEL_NAME = 'Diagram';

const DEFAULT_SETTINGS = {
  gridSize: 20,
  brightness: 20,
  contrast: 0,
  gamma: 1.0,
  smoothing: 0,
  ditherType: 'None'
};

const ACTION_PATHS = {
  uploadMedia: 'Media.uploadMedia',
  resetAll: 'Actions.resetAll',
  exportPng: 'Actions.exportPng',
  resetView: 'Actions.resetView'
};

const VIEW_LIMITS = {
  minZoom: 0.25,
  maxZoom: 4
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function applyNoiseDithering(cellValues, numRows, numCols) {
  const threshold = 128;

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const index = row * numCols + col;
      const noise = (Math.random() - 0.5) * 50;
      const adjustedValue = cellValues[index] + noise;
      cellValues[index] = adjustedValue < threshold ? 0 : 255;
    }
  }
}

function generateHalftone({
  targetCanvas,
  sourceElement,
  isVideo,
  settings,
  baseWidth,
  baseHeight,
  scaleFactor
}) {
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

  const brightnessAdjustment = settings.brightness;
  const contrastAdjustment = settings.contrast;
  const gammaValue = settings.gamma;
  const contrastFactor = (259 * (contrastAdjustment + 255)) / (255 * (259 - contrastAdjustment));

  const grayData = new Float32Array(targetWidth * targetHeight);

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    let gray = 0.299 * red + 0.587 * green + 0.114 * blue;
    gray = contrastFactor * (gray - 128) + 128 + brightnessAdjustment;
    gray = clamp(gray, 0, 255);
    gray = 255 * Math.pow(gray / 255, 1 / gammaValue);

    grayData[index / 4] = gray;
  }

  const grid = Math.max(1, Math.round(settings.gridSize * scaleFactor));
  const numCols = Math.ceil(targetWidth / grid);
  const numRows = Math.ceil(targetHeight / grid);
  let cellValues = new Float32Array(numRows * numCols);

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
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

      cellValues[row * numCols + col] = count > 0 ? sum / count : 0;
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
    applyNoiseDithering(cellValues, numRows, numCols);
  }

  const context = targetCanvas.getContext('2d');
  if (!context) {
    return;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, targetWidth, targetHeight);

  for (let row = 0; row < numRows; row += 1) {
    for (let col = 0; col < numCols; col += 1) {
      const brightnessValue = cellValues[row * numCols + col];
      const normalized = brightnessValue / 255;
      const maxRadius = grid / 2;
      const radius = maxRadius * (1 - normalized);

      if (radius > 0.5) {
        const centerX = col * grid + grid / 2;
        const centerY = row * grid + grid / 2;

        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fillStyle = '#000000';
        context.fill();
      }
    }
  }

  if (!isVideo) {
    context.closePath();
  }
}

function App() {
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const zoomRef = useRef(1);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const sourceSizeRef = useRef({ width: 1200, height: 800 });
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

    context.fillStyle = '#ffffff';
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
        isVideo: media.isVideo,
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

    DialStore.updateValue(panel.id, 'Structure.gridSize', DEFAULT_SETTINGS.gridSize);
    DialStore.updateValue(panel.id, 'Style.brightness', DEFAULT_SETTINGS.brightness);
    DialStore.updateValue(panel.id, 'Style.contrast', DEFAULT_SETTINGS.contrast);
    DialStore.updateValue(panel.id, 'Style.gamma', DEFAULT_SETTINGS.gamma);
    DialStore.updateValue(panel.id, 'Style.smoothing', DEFAULT_SETTINGS.smoothing);
    DialStore.updateValue(panel.id, 'Dithering.mode', DEFAULT_SETTINGS.ditherType);
    DialStore.updateValue(panel.id, 'View.zoom', 1);
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
      }
    },
    [exportCurrentFrame, resetDialValues, updateDialValue]
  );

  const dialConfig = useMemo(
    () => ({
      Media: {
        uploadMedia: { type: 'action', label: 'Upload Image/Video' }
      },
      Structure: {
        gridSize: [DEFAULT_SETTINGS.gridSize, 5, 50, 1]
      },
      Style: {
        brightness: [DEFAULT_SETTINGS.brightness, -100, 100, 1],
        contrast: [DEFAULT_SETTINGS.contrast, -100, 100, 1],
        gamma: [DEFAULT_SETTINGS.gamma, 0.1, 3, 0.1],
        smoothing: [DEFAULT_SETTINGS.smoothing, 0, 5, 0.5]
      },
      Dithering: {
        mode: {
          type: 'select',
          options: [
            { value: 'FloydSteinberg', label: 'Smooth Transition (Floyd-Steinberg)' },
            { value: 'Ordered', label: 'Patterned Look (Ordered)' },
            { value: 'Noise', label: 'Grainy Texture (Noise)' },
            { value: 'None', label: 'No Extra Texture' }
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

  const activeSettings = useMemo(
    () => ({
      gridSize: dialValues.Structure.gridSize,
      brightness: dialValues.Style.brightness,
      contrast: dialValues.Style.contrast,
      gamma: dialValues.Style.gamma,
      smoothing: dialValues.Style.smoothing,
      ditherType: dialValues.Dithering.mode
    }),
    [dialValues]
  );
  const zoom = dialValues.View.zoom;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const handleViewportWheel = useCallback(
    (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const currentZoom = zoomRef.current;
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = clamp(currentZoom * multiplier, VIEW_LIMITS.minZoom, VIEW_LIMITS.maxZoom);

      if (Math.abs(nextZoom - currentZoom) < 0.001) {
        return;
      }

      updateDialValue('View.zoom', Number(nextZoom.toFixed(3)));
    },
    [updateDialValue]
  );

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
    }
  }, [activeSettings, hasSource, processFrame]);

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
    <div className="app-shell">
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
          onWheel={handleViewportWheel}
          title="Scroll to pan. Ctrl/Cmd + wheel to zoom."
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
