
# Victoria Line Branch Predictor

This is a lightweight iPhone-compatible web app / PWA that:

- Uses accelerometer + gyroscope data
- Records motion between Stockwell and Brixton
- Predicts whether the train took the left or right branch

## How to use

1. Upload the folder to:
   - GitHub Pages
   - Netlify
   - Vercel

2. Open in Safari on iPhone

3. Tap:
   - Enable Motion Sensors
   - Start Recording

4. Ride the Victoria line between Stockwell and Brixton

5. Stop recording and export the JSON

6. Label datasets:
   - left-branch
   - right-branch

7. Train a better model later using:
   - TensorFlow.js
   - Python/scikit-learn

## Why this works

The tunnel geometry and switching curve produce slightly different:
- lateral acceleration
- rotational movement
- vibration signatures

Modern iPhones can detect this surprisingly well.

## Next upgrade ideas

- Add CoreML-style classifier in browser
- Use TensorFlow.js
- Live confidence graph
- GPS fallback above ground
- Apple Watch sensor fusion
