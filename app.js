let recording = false;
let data = [];
let startTime = null;
let renderQueued = false;

// DOM elements
const sensorBtn = document.getElementById("sensorBtn");
const recordBtn = document.getElementById("recordBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const sensorStatus = document.getElementById("sensorStatus");
const sessionState = document.getElementById("sessionState");
const sampleCountEl = document.getElementById("sampleCount");
const durationEl = document.getElementById("duration");

// Canvas setup
const accelCanvas = document.getElementById("accelChart");
const accelCtx = accelCanvas.getContext("2d");
const gyroCanvas = document.getElementById("gyroChart");
const gyroCtx = gyroCanvas.getContext("2d");

const MAX_POINTS = 300;

function getDpr() {
  return window.devicePixelRatio || 1;
}

function resizeCanvas(canvas, ctx) {
  const dpr = getDpr();

  // offsetWidth/offsetHeight are more stable than getBoundingClientRect on iPhone Safari
  const cssWidth = Math.max(1, canvas.offsetWidth);
  const cssHeight = Math.max(1, canvas.offsetHeight);

  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  // Draw using CSS-pixel coordinates on a high-resolution backing store
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function resizeAllCanvases() {
  resizeCanvas(accelCanvas, accelCtx);
  resizeCanvas(gyroCanvas, gyroCtx);
  queueRender();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;

  requestAnimationFrame(() => {
    renderQueued = false;
    renderCharts();
  });
}

window.addEventListener("resize", resizeAllCanvases);
window.addEventListener("orientationchange", () => {
  setTimeout(resizeAllCanvases, 150);
});
window.addEventListener("load", () => {
  setTimeout(resizeAllCanvases, 100);
});

function getCanvasSize(ctx) {
  return {
    width: ctx.canvas.clientWidth,
    height: ctx.canvas.clientHeight
  };
}

function crisp(value) {
  return Math.round(value) + 0.5;
}

function smooth(values, factor = 0.16) {
  if (values.length < 2) return values.slice();

  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(out[i - 1] * (1 - factor) + values[i] * factor);
  }
  return out;
}

// Reduce the series so we only draw roughly one point per horizontal pixel column.
// This fixes the coloured "ghost bar" / smear on the right edge.
function compressSeries(values, targetColumns) {
  if (values.length <= 2 || targetColumns <= 2) return values.slice();

  if (values.length <= targetColumns) return values.slice();

  const bucketSize = values.length / targetColumns;
  const compressed = [];

  for (let column = 0; column < targetColumns; column += 1) {
    const start = Math.floor(column * bucketSize);
    const end = Math.min(values.length, Math.floor((column + 1) * bucketSize));

    if (start >= values.length) break;

    // Use the last sample in the bucket so the trace feels current
    const index = Math.max(start, end - 1);
    compressed.push(values[index]);
  }

  return compressed;
}

function drawAxes(ctx, yMin, yMax, majorStep, labelFn) {
  const { width, height } = getCanvasSize(ctx);
  const range = yMax - yMin;
  const toY = (value) => height - ((value - yMin) / range) * height;

  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, width, height);

  const dpr = getDpr();

  // Slightly smaller fonts on high-DPI iPhones to counter Safari's heavier text rendering
  const fontPx = dpr >= 3 ? 7.5 : dpr >= 2 ? 8.5 : 10;

  ctx.save();
  ctx.strokeStyle = "#242838";
  ctx.fillStyle = "#9aa0b5";
  ctx.lineWidth = 1;
  ctx.font = `${fontPx}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let value = yMin; value <= yMax + 1e-9; value += majorStep) {
    const y = crisp(toY(value));

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.fillText(labelFn(value), 8, y);
  }

  // Stronger zero line
  const zeroY = toY(0);
  if (zeroY >= 0 && zeroY <= height) {
    ctx.strokeStyle = "#3a415a";
    ctx.beginPath();
    ctx.moveTo(0, crisp(zeroY));
    ctx.lineTo(width, crisp(zeroY));
    ctx.stroke();
  }

  ctx.restore();
}

function drawSeries(ctx, values, color, yMin, yMax) {
  if (!values.length) return;

  const { width, height } = getCanvasSize(ctx);
  const range = yMax - yMin;
  const toY = (value) => height - ((value - yMin) / range) * height;

  // Limit points first, then smooth, then compress to screen columns
  const clipped = values.slice(-MAX_POINTS);
  const smoothed = smooth(clipped, 0.16);

  // Keep the final x just inside the right edge to avoid edge artefacts
  const availableColumns = Math.max(2, Math.floor(width - 2));
  const reduced = compressSeries(smoothed, availableColumns);

  if (reduced.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  const plotWidth = Math.max(1, width - 2);

  for (let i = 0; i < reduced.length; i += 1) {
    const x = 1 + (i / (reduced.length - 1)) * plotWidth;
    const y = toY(reduced[i]);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function renderCharts() {
  // Fixed requested scales
  drawAxes(accelCtx, -4, 4, 1, (value) => `${value.toFixed(1)} g`);
  drawAxes(gyroCtx, -360, 360, 90, (value) => `${value.toFixed(0)}°/s`);

  if (data.length === 0) return;

  const ax = data.map((d) => d.ax / 9.81);
  const ay = data.map((d) => d.ay / 9.81);
  const az = data.map((d) => d.az / 9.81);

  const alpha = data.map((d) => d.rotationAlpha);
  const beta = data.map((d) => d.rotationBeta);
  const gamma = data.map((d) => d.rotationGamma);

  drawSeries(accelCtx, ax, "#ff375f", -4, 4);
  drawSeries(accelCtx, ay, "#32d74b", -4, 4);
  drawSeries(accelCtx, az, "#64d2ff", -4, 4);

  drawSeries(gyroCtx, alpha, "#ffd60a", -360, 360);
  drawSeries(gyroCtx, beta, "#ff9f0a", -360, 360);
  drawSeries(gyroCtx, gamma, "#bf5af2", -360, 360);
}

function updateSessionInfo() {
  sampleCountEl.textContent = String(data.length);

  if (!startTime || data.length === 0) {
    durationEl.textContent = "0.0 s";
    return;
  }

  const lastTime = data[data.length - 1].time;
  const seconds = (lastTime - startTime) / 1000;
  durationEl.textContent = `${seconds.toFixed(1)} s`;
}

// Motion permission
sensorBtn.onclick = async () => {
  try {
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      const response = await DeviceMotionEvent.requestPermission();

      if (response !== "granted") {
        sensorStatus.textContent = "Motion permission: Denied";
        sensorStatus.className = "status-pill status-pill--denied";
        sessionState.textContent = "Permission denied";
        return;
      }
    }

    sensorStatus.textContent = "Motion permission: Granted";
    sensorStatus.className = "status-pill status-pill--granted";
    sessionState.textContent = "Sensors enabled";

    recordBtn.disabled = false;
    sensorBtn.disabled = true;
    sensorBtn.textContent = "Sensors Enabled";
  } catch (error) {
    sensorStatus.textContent = "Motion permission: Error";
    sensorStatus.className = "status-pill status-pill--denied";
    sessionState.textContent = "Error requesting permission";
  }
};

// Start / stop recording
recordBtn.onclick = () => {
  recording = !recording;

  if (recording) {
    data = [];
    startTime = Date.now();

    recordBtn.textContent = "Stop Recording";
    recordBtn.classList.remove("btn-secondary");
    recordBtn.classList.add("btn-primary");

    sessionState.textContent = "Recording…";
    saveBtn.disabled = true;
    clearBtn.disabled = true;

    updateSessionInfo();
    queueRender();
    return;
  }

  recordBtn.textContent = "Start Recording";
  recordBtn.classList.remove("btn-primary");
  recordBtn.classList.add("btn-secondary");

  sessionState.textContent = data.length ? "Recorded" : "Idle";
  saveBtn.disabled = data.length === 0;
  clearBtn.disabled = data.length === 0;
};

// Save recording as JSON
saveBtn.onclick = () => {
  if (!data.length) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `motion-recording-${Date.now()}.json`;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

// Clear data
clearBtn.onclick = () => {
  data = [];
  startTime = null;
  sessionState.textContent = "Idle";
  saveBtn.disabled = true;
  clearBtn.disabled = true;
  updateSessionInfo();
  queueRender();
};

// Capture motion
window.addEventListener(
  "devicemotion",
  (event) => {
    if (!recording) return;

    const entry = {
      time: Date.now(),
      ax: event.acceleration?.x ?? 0,
      ay: event.acceleration?.y ?? 0,
      az: event.acceleration?.z ?? 0,
      rotationAlpha: event.rotationRate?.alpha ?? 0,
      rotationBeta: event.rotationRate?.beta ?? 0,
      rotationGamma: event.rotationRate?.gamma ?? 0
    };

    data.push(entry);
    updateSessionInfo();
    queueRender();
  },
  { passive: true }
);

updateSessionInfo();
resizeAllCanvases();
