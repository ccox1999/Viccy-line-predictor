
let samples = [];
let recording = false;

const predictionEl = document.getElementById('prediction');
const detailsEl = document.getElementById('details');

document.getElementById('startBtn').addEventListener('click', async () => {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission === 'granted') {
        startMotionCapture();
      } else {
        alert('Motion permission denied');
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    startMotionCapture();
  }
});

document.getElementById('recordBtn').addEventListener('click', () => {
  recording = !recording;

  if (recording) {
    samples = [];
    predictionEl.innerText = 'Recording...';
  } else {
    predictionEl.innerText = `Recorded ${samples.length} samples`;
    downloadSamples();
  }
});

document.getElementById('predictBtn').addEventListener('click', () => {
  const result = simpleBranchPredictor(samples);
  predictionEl.innerText = result.branch;
  detailsEl.innerText = `Confidence: ${result.confidence}%`;
});

function startMotionCapture() {
  window.addEventListener('devicemotion', (event) => {
    if (!recording) return;

    const sample = {
      time: Date.now(),
      ax: event.accelerationIncludingGravity.x || 0,
      ay: event.accelerationIncludingGravity.y || 0,
      az: event.accelerationIncludingGravity.z || 0,
      rotationAlpha: event.rotationRate?.alpha || 0,
      rotationBeta: event.rotationRate?.beta || 0,
      rotationGamma: event.rotationRate?.gamma || 0
    };

    samples.push(sample);
  });

  predictionEl.innerText = 'Sensors enabled';
}

function simpleBranchPredictor(data) {
  if (data.length < 20) {
    return {
      branch: 'Not enough data',
      confidence: 0
    };
  }

  // Very basic heuristic:
  // Detect stronger lateral movement.
  const avgX = average(data.map(d => d.ax));
  const avgGamma = average(data.map(d => d.rotationGamma));

  // Placeholder model logic.
  // You will calibrate this with real journeys.
  if (avgX + avgGamma > 0) {
    return {
      branch: 'Likely LEFT branch',
      confidence: Math.min(95, Math.round(Math.abs(avgX + avgGamma) * 10))
    };
  }

  return {
    branch: 'Likely RIGHT branch',
    confidence: Math.min(95, Math.round(Math.abs(avgX + avgGamma) * 10))
  };
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function downloadSamples() {
  const blob = new Blob([JSON.stringify(samples, null, 2)], {
    type: 'application/json'
  });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'victoria-line-motion-data.json';
  a.click();
}
