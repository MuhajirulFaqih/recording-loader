(() => {
  const svg = document.querySelector("#recordSvg");
  const center = svg?.querySelector(".record-center");
  const lights = svg ? [...svg.querySelectorAll(".record-light")] : [];
  const blurNodes = svg ? [...svg.querySelectorAll("filter feGaussianBlur")] : [];

  const startBtn = document.querySelector("[data-action='start']");
  const stopBtn = document.querySelector("[data-action='stop']");
  const demoBtn = document.querySelector("[data-action='demo']");
  const statusEl = document.querySelector("[data-status]");
  const energyBar = document.querySelector("[data-meter='energy']");
  const lowBar = document.querySelector("[data-meter='low']");
  const midBar = document.querySelector("[data-meter='mid']");
  const highBar = document.querySelector("[data-meter='high']");

  if (!svg || !center || lights.length === 0) {
    console.warn("SVG record elements were not found.");
    return;
  }

  const baseBlur = blurNodes.map((node) => Number(node.getAttribute("stdDeviation")) || 14);

  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let micStream = null;
  let frequencyData = null;
  let rafId = null;
  let mode = "idle";

  const state = {
    energy: 0,
    low: 0,
    mid: 0,
    high: 0,
    angle: 0
  };

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setMeters({ energy, low, mid, high }) {
    if (energyBar) energyBar.style.setProperty("--value", `${Math.round(energy * 100)}%`);
    if (lowBar) lowBar.style.setProperty("--value", `${Math.round(low * 100)}%`);
    if (midBar) midBar.style.setProperty("--value", `${Math.round(mid * 100)}%`);
    if (highBar) highBar.style.setProperty("--value", `${Math.round(high * 100)}%`);
  }

  function setButtons(running) {
    if (startBtn) startBtn.disabled = running;
    if (demoBtn) demoBtn.disabled = running && mode === "mic";
    if (stopBtn) stopBtn.disabled = !running;
  }

  function averageFrequencyRange(fromHz, toHz) {
    if (!audioContext || !analyser || !frequencyData) return 0;

    const nyquist = audioContext.sampleRate / 2;
    const startIndex = Math.max(0, Math.floor((fromHz / nyquist) * frequencyData.length));
    const endIndex = Math.min(frequencyData.length - 1, Math.ceil((toHz / nyquist) * frequencyData.length));

    let sum = 0;
    let count = 0;

    for (let i = startIndex; i <= endIndex; i++) {
      sum += frequencyData[i];
      count += 1;
    }

    return count ? sum / count / 255 : 0;
  }

  function updateVisual(input, now) {
    const target = {
      energy: clamp(Math.pow(input.energy, 0.82)),
      low: clamp(input.low),
      mid: clamp(input.mid),
      high: clamp(input.high)
    };

    // Smoothing keeps the motion premium and prevents jitter.
    state.energy = lerp(state.energy, target.energy, 0.18);
    state.low = lerp(state.low, target.low, 0.16);
    state.mid = lerp(state.mid, target.mid, 0.20);
    state.high = lerp(state.high, target.high, 0.14);

    const t = now * 0.001;
    const pulseNoise = Math.sin(t * 9.5) * 0.006 * state.energy;

    // Main image: mostly responds to voice presence + mid frequencies.
    const centerScale = 1 + state.energy * 0.075 + state.mid * 0.05 + pulseNoise;
    center.style.transform = `scale(${centerScale.toFixed(4)})`;
    center.style.opacity = (0.94 + state.energy * 0.06).toFixed(3);

    // Blur lights: low = bloom radius, mid = movement, high = flicker/brightness.
    lights.forEach((light, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      const phase = t * (0.58 + index * 0.11 + state.energy * 0.72) + index * 1.87;
      const radius = 7 + state.low * 24 + state.energy * 12 + index * 1.5;

      const x = Math.cos(phase * 1.23 + index) * radius;
      const y = Math.sin(phase * 1.08 + index * 0.6) * radius;
      const rotation = direction * (phase * 72 + state.high * 55 + index * 18);
      const lightScale = 0.92 + state.energy * 0.28 + state.low * 0.08 + index * 0.015;
      const lightOpacity = clamp(0.42 + state.energy * 0.44 + state.high * 0.18 - index * 0.025, 0.28, 1);

      light.style.transform = `rotate(${rotation.toFixed(2)}deg) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${lightScale.toFixed(4)})`;
      light.style.opacity = lightOpacity.toFixed(3);
    });

    blurNodes.forEach((node, index) => {
      const blur = baseBlur[index] + state.energy * 5.5 + state.high * 3.5 + state.low * 1.5;
      node.setAttribute("stdDeviation", blur.toFixed(2));
    });

    setMeters(state);
  }

  function renderMic(now) {
    analyser.getByteFrequencyData(frequencyData);

    // Frequency bands tuned for voice:
    // low  = fundamental warmth / boom
    // mid  = strongest speech presence
    // high = breath / consonant detail
    const low = averageFrequencyRange(70, 250);
    const mid = averageFrequencyRange(250, 1600);
    const high = averageFrequencyRange(1600, 5200);

    // Weighted total energy. Mid gets more weight because speech mostly lives there.
    const energy = clamp(low * 0.28 + mid * 0.52 + high * 0.20);

    updateVisual({ energy, low, mid, high }, now);
    rafId = requestAnimationFrame(renderMic);
  }

  function renderDemo(now) {
    const t = now * 0.001;

    // Fake speech-like movement so you can preview without microphone access.
    const low = clamp(0.2 + Math.sin(t * 2.0) * 0.18 + Math.sin(t * 5.3) * 0.08);
    const mid = clamp(0.34 + Math.sin(t * 3.1) * 0.24 + Math.sin(t * 9.4) * 0.07);
    const high = clamp(0.16 + Math.sin(t * 7.8) * 0.16 + Math.sin(t * 13.2) * 0.06);
    const energy = clamp(low * 0.26 + mid * 0.56 + high * 0.18);

    updateVisual({ energy, low, mid, high }, now);
    rafId = requestAnimationFrame(renderDemo);
  }

  async function startMic() {
    try {
      stopAll(false);

      mode = "mic";
      svg.classList.add("audio-reactive");
      setStatus("Requesting microphone permission...");
      setButtons(true);

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        }
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;

      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      sourceNode = audioContext.createMediaStreamSource(micStream);
      sourceNode.connect(analyser);

      setStatus("Listening — speak near the microphone.");
      rafId = requestAnimationFrame(renderMic);
    } catch (error) {
      console.error(error);
      setStatus("Microphone blocked/unavailable. Try Demo Mode or run from HTTPS/localhost.");
      stopAll();
    }
  }

  function startDemo() {
    stopAll(false);

    mode = "demo";
    svg.classList.add("audio-reactive");
    setStatus("Demo mode — simulated voice frequency.");
    setButtons(true);

    rafId = requestAnimationFrame(renderDemo);
  }

  function resetVisual() {
    svg.classList.remove("audio-reactive");

    center.style.transform = "";
    center.style.opacity = "";

    lights.forEach((light) => {
      light.style.transform = "";
      light.style.opacity = "";
    });

    blurNodes.forEach((node, index) => {
      node.setAttribute("stdDeviation", baseBlur[index]);
    });

    state.energy = 0;
    state.low = 0;
    state.mid = 0;
    state.high = 0;

    setMeters(state);
  }

  function stopAll(reset = true) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    if (sourceNode) sourceNode.disconnect();
    sourceNode = null;

    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }
    micStream = null;

    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
    }
    audioContext = null;
    analyser = null;
    frequencyData = null;

    mode = "idle";
    setButtons(false);
    setStatus("Idle animation. Click microphone to connect real voice frequency.");

    if (reset) resetVisual();
  }

  startBtn?.addEventListener("click", startMic);
  demoBtn?.addEventListener("click", startDemo);
  stopBtn?.addEventListener("click", () => stopAll(true));

  window.addEventListener("beforeunload", () => stopAll(false));
  setButtons(false);
  setMeters(state);
})();
