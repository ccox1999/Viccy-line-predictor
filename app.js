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
const sessionState = document.getElementById("sessionState") || { textContent: "" };
const sampleCountEl = document.getElementById("sampleCount");
const durationEl = document.getElementById("duration");

// Canvas setup
const accelCanvas = document.getElementById("accelChart");
const accelCtx = accelCanvas.getContext("2d", { alpha: false });
const gyroCanvas = document.getElementById("gyroChart");
const gyroCtx = gyroCanvas.getContext("2d", { alpha: false });

// Display settings
const TIME_WINDOW_MS = 8000;      // visible time span
const MAX_BUFFER_POINTS = 20000;  // raw history retained for export

function getDpr() {
  return window.devicePixelRatio || 1;
}

function resizeCanvas(canvas, ctx) {
  const dpr = getDpr();

  // More stable than getBoundingClientRect on iPhone Safari
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

  // Draw using CSS-pixel coordinates over a high-resolution backing store
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

function lerp(a, b, t) {
  return a + (b - a) * t;
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
 * Create visible points based on a fixed rolling time window.
 * Includes a synthetic point exactly at the left boundary when the window
 * cuts through a segment so the trace exits smoothly rather than wobbling.
 */
function buildVisibleSamples(entries, valueAccessor) {
  if (entries.length < 2) return [];

  const latestTime = entries[entries.length - 1].time;
  const windowStart = latestTime - TIME_WINDOW_MS;
  const windowEnd = latestTime;

  let firstVisibleIndex = entries.findIndex((e) => e.time >= windowStart);
  if (firstVisibleIndex === -1) return [];

  const visible = [];

  // Interpolate exact left-edge sample if the window boundary cuts a segment
  if (firstVisibleIndex > 0) {
    const prev = entries[firstVisibleIndex - 1];
    const next = entries[firstVisibleIndex];

    if (prev.time < windowStart && next.time > windowStart) {
      const t = (windowStart - prev.time) / (next.time - prev.time);
      visible.push({
        time: windowStart,
        value: lerp(valueAccessor(prev), valueAccessor(next), t)
      });
    }
  } else {
    visible.push({
      time: entries[0].time,
      value: valueAccessor(entries[0])
    });
  }

  for (let i = firstVisibleIndex; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.time > windowEnd) break;
    if (entry.time >= windowStart) {
      visible.push({
        time: entry.time,
        value: valueAccessor(entry)
      });
    }
  }

  return visible;
}

/**
 * Collapse visible samples so there is at most one plotted point per x column.
 * This stops same-column stacking / smearing.
 */
function samplesToPlotPoints(samples, width) {
  const plotWidth = Math.max(2, Math.floor(width - 2)); // 1px inset both sides
  if (samples.length < 2) return [];

  const startTime = samples[0].time;
  const endTime = startTime + TIME_WINDOW_MS;

  const cols = new Array(plotWidth).fill(null);

  for (const sample of samples) {
    const progress = (sample.time - startTime) / (endTime - startTime);
    const xCol = Math.min(
      plotWidth - 1,
      Math.max(0, Math.floor(progress * (plotWidth - 1)))
    );

    // Keep the latest sample for that x-column
    cols[xCol] = sample.value;
  }

  const points = [];
  for (let x = 0; x < cols.length; x += 1) {
    const value = cols[x];
    if (value !== null) {
      points.push({
        x: x + 1,
        value
      });
    }
  }

  return points;
}

// Cohen–Sutherland line clipping
const INSIDE = 0;
const LEFT = 1;
const RIGHT = 2;
const BOTTOM = 4;
const TOP = 8;

function computeOutCode(x, y, xmin, ymin, xmax, ymax) {
  let code = INSIDE;

  if (x < xmin) code |= LEFT;
  else if (x > xmax) code |= RIGHT;

  if (y < ymin) code |= TOP;
  else if (y > ymax) code |= BOTTOM;

  return code;
}

/**
 * Clip a line segment to the plot rectangle.
 * Important behaviour:
 * - If both endpoints are above the plot, the segment is rejected entirely
 *   instead of drawing a smear along the top.
 * - Same for below/left/right.
 * This is what removes top/bottom boundary smears.
 */
function clipSegment(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let outCode0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
  let outCode1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);

  while (true) {
    if (!(outCode0 | outCode1)) {
      // Both inside
      return { x0, y0, x1, y1 };
    }

    if (outCode0 & outCode1) {
      // Both endpoints share an outside region -> fully invisible
      return null;
    }

    const outCodeOut = outCode0 ? outCode0 : outCode1;
    let x;
    let y;

    if (outCodeOut & TOP) {
      x = x0 + ((x1 - x0) * (ymin - y0)) / (y1 - y0);
      y = ymin;
    } else if (outCodeOut & BOTTOM) {
      x = x0 + ((x1 - x0) * (ymax - y0)) / (y1 - y0);
      y = ymax;
    } else if (outCodeOut & RIGHT) {
      y = y0 + ((y1 - y0) * (xmax - x0)) / (x1 - x0);
      x = xmax;
    } else {
      y = y0 + ((y1 - y0) * (xmin - x0)) / (x1 - x0);
      x = xmin;
    }

    if (outCodeOut === outCode0) {
      x0 = x;
      y0 = y;
      outCode0 = computeOutCode(x0, y0, xmin, ymin, xmax, ymax);
    } else {
      x1 = x;
      y1 = y;
      outCode1 = computeOutCode(x1, y1, xmin, ymin, xmax, ymax);
    }
  }
}

function drawSeries(ctx, entries, color, yMin, yMax, valueAccessor) {
  if (entries.length < 2) return;

  const { width, height } = getCanvasSize(ctx);
  const range = yMax - yMin;
  const toY = (value) => height - ((value - yMin) / range) * height;

  const visibleSamples = buildVisibleSamples(entries, valueAccessor);
  const points = samplesToPlotPoints(visibleSamples, width);
  if (points.length < 2) return;

  const xmin = 1;
  const xmax = Math.max(1, width - 1);
  const ymin = 0;
  const ymax = height;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let pathOpen = false;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];

    const x0 = prev.x;
    const y0 = toY(prev.value);
    const x1 = curr.x;
    const y1 = toY(curr.value);

    const clipped = clipSegment(x0, y0, x1, y1, xmin, ymin, xmax, ymax);

    if (!clipped) {
      if (pathOpen) {
        ctx.stroke();
        pathOpen = false;
      }
      continue;
    }

    if (!pathOpen) {
      ctx.beginPath();
      ctx.moveTo(clipped.x0, clipped.y0);
      ctx.lineTo(clipped.x1, clipped.y1);
      pathOpen = true;
    } else {
      // If segment does not continue exactly from the previous point, start a new path
      const currentPoint = ctx.__lastPoint;
      if (
        !currentPoint ||
        Math.abs(currentPoint.x - clipped.x0) > 0.01 ||
        Math.abs(currentPoint.y - clipped.y0) > 0.01
      ) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(clipped.x0, clipped.y0);
      }
      ctx.lineTo(clipped.x1, clipped.y1);
    }

    ctx.__lastPoint = { x: clipped.x1, y: clipped.y1 };
  }

  if (pathOpen) {
    ctx.stroke();
  }

  ctx.__lastPoint = null;
  ctx.restore();
}

function renderCharts() {
  // Fixed display scales requested
  drawAxes(accelCtx, -4, 4, 1, (value) => `${value.toFixed(1)} g`);
  drawAxes(gyroCtx, -360, 360, 90, (value) => `${value.toFixed(0)}°/s`);

  if (data.length < 2) return;

  drawSeries(accelCtx, data, "#ff375f", -4, 4, (entry) => entry.ax / 9.81);
  drawSeries(accelCtx, data, "#32d74b", -4, 4, (entry) => entry.ay / 9.81);
  drawSeries(accelCtx, data, "#64d2ff", -4, 4, (entry) => entry.az / 9.81);

  drawSeries(gyroCtx, data, "#ffd60a", -360, 360, (entry) => entry.rotationAlpha);
  drawSeries(gyroCtx, data, "#ff9f0a", -360, 360, (entry) => entry.rotationBeta);
  drawSeries(gyroCtx, data, "#bf5af2", -360, 360, (entry) => entry.rotationGamma);
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

    // Keep memory bounded without changing export fidelity too quickly
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
