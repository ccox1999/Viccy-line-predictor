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
const accelCtx = accelCanvas.getContext("2d", { alpha: false });
const gyroCanvas = document.getElementById("gyroChart");
const gyroCtx = gyroCanvas.getContext("2d", { alpha: false });

// Display settings
const TIME_WINDOW_MS = 8000; // last 8 seconds visible
const MAX_BUFFER_POINTS = 12000; // keep plenty of raw points for save/export

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

  // Draw using CSS-pixel coordinates over a Retina backing store
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

function crisp(v) {
  return Math.round(v) + 0.5;
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

/**
 * Build one plotted point per horizontal pixel column using timestamps.
 * This removes:
 * - right-edge smear (multiple points in the same x column)
 * - left-edge wobble caused by remapping a sliding sample window by index
 *
 * We do NOT clamp values vertically.
 */
function binSeriesByTime(entries, width, valueAccessor) {
  const plotWidth = Math.max(2, Math.floor(width - 2)); // 1px inset on both sides
  if (!entries.length) return [];

  const latestTime = entries[entries.length - 1].time;
  const windowStart = latestTime - TIME_WINDOW_MS;

  // Keep only samples inside the visible time window
  const visible = entries.filter((entry) => entry.time >= windowStart);
  if (!visible.length) return [];

  const columns = new Array(plotWidth).fill(null);

  for (const entry of visible) {
    const progress = (entry.time - windowStart) / TIME_WINDOW_MS;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const xColumn = Math.min(
      plotWidth - 1,
      Math.floor(clampedProgress * (plotWidth - 1))
    );

    // Keep the latest sample for each pixel column
    columns[xColumn] = valueAccessor(entry);
  }

  const points = [];
  for (let x = 0; x < columns.length; x += 1) {
    const value = columns[x];
    if (value !== null) {
      points.push({
        x: x + 1, // 1px inset
        value
      });
    }
  }

  return points;
}

function drawSeries(ctx, entries, color, yMin, yMax, valueAccessor) {
  if (!entries.length) return;

  const { width, height } = getCanvasSize(ctx);
  const range = yMax - yMin;
  const toY = (value) => height - ((value - yMin) / range) * height;

  const points = binSeriesByTime(entries, width, valueAccessor);
  if (points.length < 2) return;

  ctx.save();

  // Clip horizontally so traces do not bleed into the borders.
  // We do NOT clamp y, so peaks can run naturally off the top/bottom.
  ctx.beginPath();
  ctx.rect(1, 0, Math.max(1, width - 2), height);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();

  for (let i = 0; i < points.length; i += 1) {
    const x = points[i].x;
    const y = toY(points[i].value);

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
  // Fixed display scales requested
  drawAxes(accelCtx, -4, 4, 1, (value) => `${value.toFixed(1)} g`);
  drawAxes(gyroCtx, -360, 360, 90, (value) => `${value.toFixed(0)}°/s`);

  if (data.length === 0) return;

  drawSeries(
    accelCtx,
    data,
    "#ff375f",
    -4,
    4,
    (entry) => entry.ax / 9.81
  );
  drawSeries(
    accelCtx,
    data,
    "#32d74b",
    -4,
    4,
    (entry) => entry.ay / 9.81
  );
  drawSeries(
    accelCtx,
    data,
    "#64d2ff",
    -4,
    4,
    (entry) => entry.az / 9.81
  );

  drawSeries(
    gyroCtx,
    data,
    "#ffd60a",
    -360,
    360,
    (entry) => entry.rotationAlpha
  );
  drawSeries(
    gyroCtx,
    data,
    "#ff9f0a",
    -360,
    360,
    (entry) => entry.rotationBeta
  );
  drawSeries(
    gyroCtx,
    data,
    "#bf5af2",
    -360,
    360,
    (entry) => entry.rotationGamma
  );
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

// Save recording as JSON (raw data, not display-clipped)
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

    // Keep raw buffer bounded in memory, but still large
    if (data.length > MAX_BUFFER_POINTS) {
      data.splice(0, data.length - MAX_BUFFER_POINTS);
    }

    updateSessionInfo();
    queueRender();
  },
  { passive: true }
);

updateSessionInfo();
resizeAllCanvases();
