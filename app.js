let recording = false;
let data = [];

// Canvas + contexts
const accelCanvas = document.getElementById("accelChart");
const accelCtx = accelCanvas.getContext("2d");

const gyroCanvas = document.getElementById("gyroChart");
const gyroCtx = gyroCanvas.getContext("2d");

// Resize canvas to device width
function resizeCanvas() {
  accelCanvas.width = accelCanvas.clientWidth;
  gyroCanvas.width = gyroCanvas.clientWidth;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Simple smoothing filter
function smooth(values, factor = 0.2) {
  if (values.length < 2) return values;
  let smoothed = [values[0]];
  for (let i = 1; i < values.length; i++) {
    smoothed.push(smoothed[i - 1] * (1 - factor) + values[i] * factor);
  }
  return smoothed;
}

// Draw a single line graph
function drawGraph(ctx, values, color, scale) {
  ctx.strokeStyle = color;
  ctx.beginPath();

  const maxPoints = 200;
  const slice = values.slice(-maxPoints);
  const smoothed = smooth(slice);

  smoothed.forEach((v, i) => {
    const x = (i / maxPoints) * ctx.canvas.width;
    const y = ctx.canvas.height / 2 - v * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// Render both charts
function renderCharts() {
  accelCtx.clearRect(0, 0, accelCanvas.width, accelCanvas.height);
  gyroCtx.clearRect(0, 0, gyroCanvas.width, gyroCanvas.height);

  const ax = data.map(d => d.ax);
  const ay = data.map(d => d.ay);
  const az = data.map(d => d.az);

  const alpha = data.map(d => d.rotationAlpha);
  const beta = data.map(d => d.rotationBeta);
  const gamma = data.map(d => d.rotationGamma);

  // Accelerometer
  drawGraph(accelCtx, ax, "red", 5);
  drawGraph(accelCtx, ay, "lime", 5);
  drawGraph(accelCtx, az, "cyan", 5);

  // Gyroscope
  drawGraph(gyroCtx, alpha, "yellow", 1);
  drawGraph(gyroCtx, beta, "orange", 1);
  drawGraph(gyroCtx, gamma, "violet", 1);
}

// Motion permission
document.getElementById("startBtn").onclick = async () => {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const permission = await DeviceMotionEvent.requestPermission();
    if (permission !== "granted") {
      alert("Motion permission denied");
      return;
    }
  }
  alert("Motion sensors enabled");
};

// Start/stop recording
document.getElementById("recordBtn").onclick = () => {
  recording = !recording;
  if (recording) {
    data = [];
    document.getElementById("recordBtn").innerText = "Stop Recording";
  } else {
    document.getElementById("recordBtn").innerText = "Start Recording";
  }
};

// Capture motion
window.addEventListener("devicemotion", (event) => {
  if (!recording) return;

  const entry = {
    time: Date.now(),
    ax: event.acceleration.x || 0,
    ay: event.acceleration.y || 0,
    az: event.acceleration.z || 0,
    rotationAlpha: event.rotationRate.alpha || 0,
    rotationBeta: event.rotationRate.beta || 0,
    rotationGamma: event.rotationRate.gamma || 0
  };

  data.push(entry);
  renderCharts();
});
