let recording = false;
let data = [];
let startTime = null;

// DOM elements
const sensorBtn = document.getElementById("sensorBtn");
const recordBtn = document.getElementById("recordBtn");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");

const sensorStatus = document.getElementById("sensorStatus");
const sessionState = document.getElementById("sessionState");
const sampleCountEl = document.getElementById("sampleCount");
const durationEl = document.getElementById("duration");

// Canvas setup with high DPI
const accelCanvas = document.getElementById("accelChart");
const accelCtx = accelCanvas.getContext("2d");
const gyroCanvas = document.getElementById("gyroChart");
const gyroCtx = gyroCanvas.getContext("2d");

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
}

function resizeAllCanvases() {
  resizeCanvas(accelCanvas);
  resizeCanvas(gyroCanvas);
  renderCharts();
}

window.addEventListener("resize", resizeAllCanvases);
resizeAllCanvases();

// Utility: smoothing
function smooth(values, factor = 0.2) {
  if (values.length < 2) return values;
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(out[i - 1] * (1 - factor) + values[i] * factor);
  }
  return out;
}

// Draw axes with g-force ticks
function drawAxes(ctx, yMin, yMax, majorStep, minorStep, labelFn) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  ctx.translate(0.5, 0.5); // crisp lines

  // Background
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = "#1b1e2a";
  ctx.lineWidth = 1;

  const range = yMax - yMin;
  const toY = v => height - ((v - yMin) / range) * height;

  // Minor ticks
  for (let v = yMin; v <= yMax + 1e-6; v += minorStep) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Major ticks + labels
  ctx.strokeStyle = "#2a2d3a";
  ctx.fillStyle = "#a0a4b8";
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px -apple-system, system-ui`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let v = yMin; v <= yMax + 1e-6; v += majorStep) {
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    const label = labelFn(v);
    ctx.fillText(label, 8 * (window.devicePixelRatio || 1), y);
  }

  ctx.restore();
}

// Draw line series
function drawSeries(ctx, values, color, yMin, yMax) {
  const { width, height } = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;

  const maxPoints = 300;
  const slice = values.slice(-maxPoints);
  const smoothed = smooth(slice, 0.25);

  const range = yMax - yMin;
  const toY = v => height - ((v - yMin) / range) * height;

  ctx.save();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = color;
  ctx.beginPath();

  smoothed.forEach((v, i) => {
    const x = (i / Math.max(1, maxPoints - 1)) * width;
    const y = toY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
  ctx.restore();
}

// Render charts
function renderCharts() {
  if (data.length === 0) {
    drawAxes(accelCtx, -3, 3, 1, 0.25, v => `${v.toFixed(1)} g`);
    drawAxes(gyroCtx, -180, 180, 60, 15, v => `${v.toFixed(0)}°/s`);
    return;
  }

  const ax = data.map(d => d.ax / 9.81); // convert m/s² to g
  const ay = data.map(d => d.ay / 9.81);
  const az = data.map(d => d.az / 9.81);

  const alpha = data.map(d => d.rotationAlpha);
  const beta = data.map(d => d.rotationBeta);
  const gamma = data.map(d => d.rotationGamma);

  // Accel: fixed ±3g range
  drawAxes(accelCtx, -3, 3, 1, 0.25, v => `${v.toFixed(1)} g`);
  drawSeries(accelCtx, ax, "#ff375f", -3, 3);
  drawSeries(accelCtx, ay, "#32d74b", -3, 3);
  drawSeries(accelCtx, az, "#64d2ff", -3, 3);

  // Gyro: dynamic range but clamped
  const gyroAll = alpha.concat(beta, gamma);
  const maxAbs = Math.max(60, Math.min(360, Math.max(...gyroAll.map(v => Math.abs(v)) || 60)));
  const gyroRange = maxAbs;

  drawAxes(gyroCtx, -gyroRange, gyroRange, gyroRange / 3, gyroRange / 12,
           v => `${v.toFixed(0)}°/s`);
  drawSeries(gyroCtx, alpha, "#ffd60a", -gyroRange, gyroRange);
  drawSeries(gyroCtx, beta, "#ff9f0a", -gyroRange, gyroRange);
  drawSeries(gyroCtx, gamma, "#bf5af2", -gyroRange, gyroRange);
}

// Update session info
function updateSessionInfo() {
  sampleCountEl.textContent = data.length.toString();
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
  sessionState.textContent = "Requesting permission…";

  try {
    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {

      const response = await DeviceMotionEvent.requestPermission();

      if (response !== "granted") {
        sensorStatus.textContent = "Motion permission: Denied";
        sensorStatus.className = "status-pill status-pill--denied";
        sessionState.textContent = "Permission denied";
        return;
      }
    }

    // If we reach here, permission is granted
    sensorStatus.textContent = "Motion permission: Granted";
    sensorStatus.className = "status-pill status-pill--granted";
    sessionState.textContent = "Sensors enabled";

    // Enable recording button
    recordBtn.disabled = false;

    // Disable the sensor button (no need to press again)
    sensorBtn.disabled = true;
    sensorBtn.textContent = "Sensors Enabled";

  } catch (err) {
    sensorStatus.textContent = "Motion permission: Error";
    sensorStatus.className = "status-pill status-pill--denied";
    sessionState.textContent = "Error requesting permission";
  }
};


// Start/stop recording
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
  } else {
    recordBtn.textContent = "Start Recording";
    recordBtn.classList.remove("btn-primary");
    recordBtn.classList.add("btn-secondary");
    sessionState.textContent = data.length ? "Recorded" : "Idle";
    saveBtn.disabled = data.length === 0;
    clearBtn.disabled = data.length === 0;
  }
};

// Save recording as JSON
saveBtn.onclick = () => {
  if (!data.length) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `motion-recording-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  renderCharts();
};

// Capture motion
window.addEventListener("devicemotion", (event) => {
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
  renderCharts();
});
