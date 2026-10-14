(() => {
  // src/analyzer.ts
  var ALLOWED_ORIGINS = ["https://www.youtube.com", "https://youtube.com", "https://m.youtube.com"];
  var landmarker = null;
  function getLandmarker() {
    landmarker ||= (async () => {
      const mediaPipe = await import(new URL("vendor/vision_bundle.mjs", location.href).href);
      const vision = await mediaPipe.FilesetResolver.forVisionTasks(new URL("wasm", location.href).href);
      return mediaPipe.FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: new URL("models/face_landmarker.task", location.href).href },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: true
      });
    })().catch((error) => {
      landmarker = null;
      throw error;
    });
    return landmarker;
  }
  function toPlainResult(result) {
    return {
      faceLandmarks: (result.faceLandmarks || []).map((face) => face.map((point) => ({ x: point.x, y: point.y }))),
      faceBlendshapes: (result.faceBlendshapes || []).map((shape) => ({
        categories: (shape.categories || []).map((category) => ({ categoryName: category.categoryName, score: category.score }))
      }))
    };
  }
  window.addEventListener("message", async (event) => {
    const source = event.source;
    if (!source || !ALLOWED_ORIGINS.includes(event.origin))
      return;
    const data = event.data;
    if (data?.type === "ff-init") {
      try {
        await getLandmarker();
        source.postMessage({ type: "ff-init-result", ok: true }, event.origin);
      } catch (error) {
        source.postMessage({ type: "ff-init-result", ok: false, error: error instanceof Error ? error.message : String(error) }, event.origin);
      }
      return;
    }
    if (data?.type !== "ff-detect" || typeof data.id !== "number" || !data.bitmap)
      return;
    try {
      const result = (await getLandmarker()).detect(data.bitmap);
      source.postMessage({ type: "ff-detect-result", id: data.id, ok: true, result: toPlainResult(result) }, event.origin);
    } catch (error) {
      source.postMessage({ type: "ff-detect-result", id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) }, event.origin);
    } finally {
      data.bitmap.close();
    }
  });
})();
