// Gumptube — motor de análise de frames (portado da 0.3.1, mesma matemática).
(() => {
  const GT = (window.GT = window.GT || {});
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

  let analyzerWindow = null;
  let pendingInit = null;
  const pendingDetections = new Map();
  let requestSeq = 0;

  window.addEventListener('message', (event) => {
    if (event.origin !== EXTENSION_ORIGIN) return;
    const data = event.data;
    if (data?.type === 'ff-init-result' && pendingInit) {
      const pending = pendingInit;
      pendingInit = null;
      if (data.ok) pending.resolve();
      else pending.reject(new Error(data.error || 'Falha ao iniciar o modelo facial.'));
      return;
    }
    if (data?.type !== 'ff-detect-result' || typeof data.id !== 'number') return;
    const pending = pendingDetections.get(data.id);
    if (!pending) return;
    pendingDetections.delete(data.id);
    if (data.ok && data.result) pending.resolve(data.result);
    else pending.reject(new Error(data.error || 'Falha na análise facial.'));
  });

  function getAnalyzerWindow() {
    analyzerWindow ||= new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('analyzer.html');
      frame.style.display = 'none';
      frame.title = 'Gumptube analyzer';
      frame.addEventListener('load', () => (frame.contentWindow ? resolve(frame.contentWindow) : reject(new Error('Janela do analisador indisponível.'))));
      frame.addEventListener('error', () => { analyzerWindow = null; reject(new Error('Não foi possível carregar o analisador da extensão.')); });
      (document.body || document.documentElement).append(frame);
    });
    return analyzerWindow;
  }

  async function initAnalyzer() {
    const win = await getAnalyzerWindow();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingInit = null; reject(new Error('O modelo facial demorou demais para iniciar.')); }, 30000);
      pendingInit = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      };
      win.postMessage({ type: 'ff-init' }, EXTENSION_ORIGIN);
    });
  }

  async function detectFace(canvas) {
    const win = await getAnalyzerWindow();
    const bitmap = await createImageBitmap(canvas);
    const id = ++requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingDetections.delete(id); reject(new Error('A análise facial excedeu o tempo limite.')); }, 20000);
      pendingDetections.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      win.postMessage({ type: 'ff-detect', id, bitmap }, EXTENSION_ORIGIN, [bitmap]);
    });
  }

  function seek(video, time) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao buscar o frame.')), 7000);
      video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true });
      video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
    });
  }

  // 'seeked' só diz que o player chegou no tempo — não que o frame novo já foi desenhado.
  // Capturar nesse instante produz imagem rasgada/embaralhada; aqui esperamos a apresentação real.
  // Resolve com true quando um frame novo foi de fato apresentado; false quando estourou o tempo.
  function nextPresentedFrame(video, timeoutMs = 350) {
    if (typeof video.requestVideoFrameCallback !== 'function') {
      return new Promise((resolve) => setTimeout(() => resolve(false), 40));
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (presented) => { if (!done) { done = true; resolve(presented); } };
      const timer = setTimeout(() => finish(false), timeoutMs);
      video.requestVideoFrameCallback(() => { clearTimeout(timer); finish(true); });
    });
  }

  function drawFrame(video, width) {
    if (!video.videoWidth || !video.videoHeight) throw new Error('O player não expôs uma resolução de vídeo válida.');
    if (video.readyState < 2) throw new Error('O player ainda não tem dados deste trecho.');
    const scale = width ? Math.min(1, width / video.videoWidth) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Captura verificada. Se o player não apresentou frame novo, o resultado vem marcado como
  // 'stale' — a varredura descarta em vez de encher a grade de imagens repetidas ou rasgadas.
  async function captureAt(video, time, width, previousHash) {
    await seek(video, time);
    let presented = await nextPresentedFrame(video);
    let canvas = drawFrame(video, width);
    let hash = aHash(canvas);
    let stale = !presented;

    if (previousHash && hash === previousHash) {
      const retried = await nextPresentedFrame(video, 140);
      const retry = drawFrame(video, width);
      const retryHash = aHash(retry);
      presented = presented || retried;
      if (retryHash !== previousHash) {
        canvas = retry;
        hash = retryHash;
        stale = false;
      } else {
        // Igual ao anterior: só é descarte se o player NÃO apresentou frame novo.
        // Numa cena parada (mesma imagem por segundos), o frame é legítimo e deve entrar.
        stale = !presented;
      }
    } else if (presented) {
      stale = false;
    }

    return { canvas, hash, stale };
  }

  function measureQuality(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const step = 4;
    const { width: w, height: h } = canvas;
    let sum = 0, sumSq = 0, grad = 0, clipped = 0, count = 0, gradCount = 0;
    const lumaAt = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    for (let y = 1; y < h - 1; y += step) {
      for (let x = 1; x < w - 1; x += step) {
        const l = lumaAt(x, y);
        sum += l; sumSq += l * l; count++;
        if (l < 8 || l > 247) clipped++;
        const gx = lumaAt(x + 1, y) - lumaAt(x - 1, y);
        const gy = lumaAt(x, y + 1) - lumaAt(x, y - 1);
        grad += Math.hypot(gx, gy);
        gradCount++;
      }
    }
    if (!count) return { sharpness: 0, brightness: 0, contrast: 0, exposure: 0, clipping: 0, score: 0 };
    const brightness = sum / count;
    const variance = Math.max(0, sumSq / count - brightness * brightness);
    const contrast = Math.sqrt(variance);
    const sharpness = Math.min(100, (grad / Math.max(1, gradCount)) * 2.4);
    const clipping = clipped / count;
    const exposure = Math.round(100 - Math.min(100, Math.abs(brightness - 128) * 0.85) - Math.min(35, clipping * 180));
    const contrastScore = Math.min(100, contrast * 1.9);
    const score = Math.round(GT.clamp01((sharpness * 0.45 + Math.max(0, exposure) * 0.35 + contrastScore * 0.2) / 100) * 100);
    return { sharpness: Math.round(sharpness), brightness: Math.round(brightness), contrast: Math.round(contrast), exposure: Math.max(0, exposure), clipping, score };
  }

  function aHash(canvas) {
    const tiny = document.createElement('canvas');
    tiny.width = tiny.height = 8;
    const ctx = tiny.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const values = [];
    let avg = 0;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] + data[i + 1] + data[i + 2];
      values.push(v); avg += v;
    }
    avg /= values.length;
    return values.map((v) => (v > avg ? '1' : '0')).join('');
  }

  function hashDistance(a, b) {
    let d = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
    return d;
  }

  const EMPTY_FACE = { present: false, confidence: 0, pose: 'unknown', yaw: 0, roll: 0, pitch: 0, eyesOpen: 0, smile: 0, gaze: null, areaRatio: 0, lookingAtCamera: false, cameraScore: 0, score: 0 };

  function blendshapeScore(result, names) {
    const categories = result.faceBlendshapes?.[0]?.categories;
    if (!categories) return null;
    const matches = categories.filter((c) => c.categoryName && names.includes(c.categoryName) && typeof c.score === 'number');
    if (!matches.length) return null;
    return matches.reduce((acc, c) => acc + (c.score ?? 0), 0) / matches.length;
  }

  function analyzeFace(result) {
    const landmarks = result.faceLandmarks[0];
    if (!landmarks || landmarks.length < 400) return EMPTY_FACE;
    const leftOuter = landmarks[33], leftInner = landmarks[133], leftTop = landmarks[159], leftBottom = landmarks[145];
    const rightOuter = landmarks[263], rightInner = landmarks[362], rightTop = landmarks[386], rightBottom = landmarks[374];
    const nose = landmarks[1];
    const eyeCenterX = (leftOuter.x + rightOuter.x) / 2;
    const eyeSpan = Math.abs(rightOuter.x - leftOuter.x) || 1e-6;
    const yaw = (nose.x - eyeCenterX) / eyeSpan;
    const roll = (Math.atan2(rightOuter.y - leftOuter.y, rightOuter.x - leftOuter.x) * 180) / Math.PI;
    const ear = (top, bottom, outer, inner) => Math.abs(bottom.y - top.y) / (Math.abs(inner.x - outer.x) || 1e-6);
    const earAvg = (ear(leftTop, leftBottom, leftOuter, leftInner) + ear(rightTop, rightBottom, rightOuter, rightInner)) / 2;
    const blink = blendshapeScore(result, ['eyeBlinkLeft', 'eyeBlinkRight']);
    const eyesOpen = blink !== null ? GT.clamp01(1 - blink) : GT.clamp01((earAvg - 0.08) / 0.22);
    const smile = GT.clamp01(blendshapeScore(result, ['mouthSmileLeft', 'mouthSmileRight']) ?? 0);
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const areaRatio = GT.clamp01((maxX - minX) * (maxY - minY));
    const absYaw = Math.abs(yaw);
    const pose = absYaw < 0.17 ? 'frontal' : absYaw < 0.45 ? 'three-quarter' : 'profile';

    // Para onde os olhos apontam, independentemente da cabeça (blendshapes do MediaPipe).
    const gazeSide = Math.max(
      blendshapeScore(result, ['eyeLookOutLeft']) ?? 0,
      blendshapeScore(result, ['eyeLookOutRight']) ?? 0,
      blendshapeScore(result, ['eyeLookInLeft']) ?? 0,
      blendshapeScore(result, ['eyeLookInRight']) ?? 0
    );
    const gazeVertical = Math.max(
      blendshapeScore(result, ['eyeLookUpLeft', 'eyeLookUpRight']) ?? 0,
      blendshapeScore(result, ['eyeLookDownLeft', 'eyeLookDownRight']) ?? 0
    );
    const hasGaze = !!result.faceBlendshapes?.[0]?.categories?.length;
    const gaze = GT.clamp01(Math.max(gazeSide, gazeVertical));

    // Inclinação vertical da cabeça: nariz entre a linha dos olhos e o queixo.
    const chin = landmarks[152];
    const eyeMidY = (leftOuter.y + rightOuter.y) / 2;
    const faceSpan = Math.abs(chin.y - eyeMidY) || 1e-6;
    const pitch = (nose.y - eyeMidY) / faceSpan - 0.42;      // 0 ≈ cabeça neutra
    const pitchQuality = GT.clamp01(1 - Math.abs(pitch) / 0.22);

    const confidence = GT.clamp01(0.55 + (eyeSpan > 0.04 ? 0.2 : 0) + Math.min(0.25, areaRatio * 2.5));
    const frontality = GT.clamp01(1 - absYaw / 0.5);
    const strictFrontality = GT.clamp01(1 - absYaw / 0.3);
    const rollQuality = GT.clamp01(1 - Math.abs(roll) / 28);
    const sizeQuality = areaRatio < 0.015 ? areaRatio / 0.015 : areaRatio > 0.55 ? GT.clamp01(1 - (areaRatio - 0.55) / 0.35) : 1;
    const gazeQuality = hasGaze ? GT.clamp01(1 - gaze / 0.5) : 0.6;

    const cameraScore = Math.round(100 * (
      strictFrontality * 0.30 + gazeQuality * 0.26 + eyesOpen * 0.18 +
      pitchQuality * 0.11 + rollQuality * 0.08 + sizeQuality * 0.07
    ));

    // Régua dura: só entra na aba Câmera quem está mesmo encarando a lente.
    const lookingAtCamera = cameraScore >= 72
      && absYaw < 0.14
      && eyesOpen > 0.5
      && Math.abs(roll) < 18
      && Math.abs(pitch) < 0.2
      && areaRatio > 0.012
      && (!hasGaze || gaze < 0.38);

    const score = Math.round((frontality * 0.28 + eyesOpen * 0.22 + gazeQuality * 0.16 + rollQuality * 0.1 + sizeQuality * 0.14 + smile * 0.1) * 100);
    return { present: true, confidence, pose, yaw, roll, pitch, eyesOpen, smile, gaze: hasGaze ? gaze : null, areaRatio, lookingAtCamera, cameraScore, score };
  }

  async function analyzeCanvas(canvas) {
    const quality = measureQuality(canvas);
    const face = analyzeFace(await detectFace(canvas));
    const faceBonus = face.present ? (face.score * 0.38 + (face.lookingAtCamera ? 10 : 0)) * face.confidence : 0;
    const score = Math.round(Math.min(100, quality.score * 0.62 + faceBonus));
    return { quality, face, score };
  }

  function clusterFrames(frames, interval) {
    const out = frames.map((frame) => ({ ...frame }));
    let clusterId = -1;
    let anchor = null;
    for (const frame of out) {
      const sameScene = anchor !== null && hashDistance(anchor.hash, frame.hash) < 10 && frame.time - anchor.time <= interval * 2.5;
      if (!sameScene) { clusterId++; anchor = frame; }
      frame.clusterId = clusterId;
      if (anchor && frame.score > anchor.score) anchor = frame;
    }
    const bestByCluster = new Map();
    for (const frame of out) {
      const best = bestByCluster.get(frame.clusterId);
      if (!best || frame.score > best.score) bestByCluster.set(frame.clusterId, frame);
    }
    for (const frame of out) {
      frame.representative = bestByCluster.get(frame.clusterId)?.id === frame.id;
      frame.similar = !frame.representative;
    }
    return out;
  }

  function diverseRank(frames) {
    const pool = [...frames];
    const picked = [];
    while (pool.length) {
      let bestIdx = 0, bestValue = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        let penalty = 0;
        for (const chosen of picked.slice(0, 8)) {
          const d = hashDistance(chosen.hash, candidate.hash);
          penalty = Math.max(penalty, Math.max(0, (14 - d) / 14) * 22);
        }
        const value = candidate.score - penalty;
        if (value > bestValue) { bestValue = value; bestIdx = i; }
      }
      picked.push(pool.splice(bestIdx, 1)[0]);
    }
    return picked;
  }

  // Segunda passada: o modelo facial roda só nos candidatos escolhidos.
  async function analyzeFaceOf(source) {
    return analyzeFace(await detectFace(source));
  }

  function combinedScore(quality, face) {
    const faceBonus = face.present ? (face.score * 0.38 + (face.lookingAtCamera ? 10 : 0)) * face.confidence : 0;
    return Math.round(Math.min(100, quality.score * 0.62 + faceBonus));
  }

  GT.analysis = {
    initAnalyzer, detectFace, seek, nextPresentedFrame, drawFrame, captureAt,
    measureQuality, aHash, hashDistance, analyzeCanvas, analyzeFace, analyzeFaceOf, combinedScore,
    clusterFrames, diverseRank, EMPTY_FACE
  };
})();
