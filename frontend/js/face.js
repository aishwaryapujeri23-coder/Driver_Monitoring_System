/**
 * Face landmark analysis, running entirely in the browser via MediaPipe's
 * Face Landmarker (Tasks Vision API, WebAssembly) loaded from CDN — no
 * npm install, no build step, no server round trip for landmarks. This is
 * the "browser does the heavy per-frame CV" half of the hybrid architecture
 * described in the README; the backend only sees a throttled frame sample
 * for phone detection (see monitoring.js).
 *
 * -------------------------------------------------------------------------
 * Eye Aspect Ratio (EAR):
 *
 *     EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
 *
 * p1/p4 are the eye's horizontal corners, p2/p3 and p5/p6 are two pairs of
 * upper/lower eyelid points. As the eye closes, the vertical distances
 * (numerator) shrink toward zero while eye width (denominator) stays
 * roughly constant, so EAR drops sharply — a clear, largely person-
 * independent signal for closure.
 *
 * Mouth Aspect Ratio (MAR) uses the identical structural idea applied to
 * six mouth landmarks (corners + two upper/lower point pairs).
 *
 * Landmark indices below are the standard MediaPipe Face Mesh (468-point)
 * indices commonly used for EAR/MAR in the CV community.
 *
 * -------------------------------------------------------------------------
 * Head pose (yaw/pitch/roll):
 *
 * This MVP uses a lightweight GEOMETRIC HEURISTIC rather than a full
 * cv2.solvePnP 3D pose fit (that needs a 3D face model + camera intrinsics,
 * and is done server-side in the fuller architecture described in the
 * project docs). The heuristic:
 *
 *   - roll  = angle of the line between the two outer eye corners vs.
 *             horizontal — directly measurable and fairly accurate.
 *   - yaw   = horizontal offset of the nose tip from the midpoint of the
 *             two eye-corners, normalized by inter-eye distance, scaled to
 *             degrees. Turning the head left/right shifts the nose tip
 *             sideways relative to the (roughly fixed) eye baseline.
 *   - pitch = vertical offset of the nose tip from the eye-to-chin midline,
 *             normalized by face height, scaled to degrees.
 *
 * This is stable enough to classify "forward / left / right / up / down"
 * for a demo, but it is an approximation — it will drift with unusual face
 * geometry or extreme angles, exactly the kind of limitation a full
 * solvePnP + 3D model would reduce. That tradeoff is intentional for the
 * 3-hour MVP scope.
 */

const FACE_LANDMARKS = {
  // 6-point EAR sets: [outer corner, upper1, upper2, inner corner, lower2, lower1]
  LEFT_EYE: [362, 385, 387, 263, 373, 380],
  RIGHT_EYE: [33, 160, 158, 133, 153, 144],
  // 6-point MAR set: [left corner, upper-left, upper-right, right corner, lower-right, lower-left]
  MOUTH: [61, 39, 269, 291, 405, 181],
  NOSE_TIP: 1,
  CHIN: 152,
  FOREHEAD: 10,
  LEFT_EYE_OUTER: 263,
  RIGHT_EYE_OUTER: 33,
};

class FaceAnalyzer {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.loadError = null;
  }

  async init() {
    try {
      const vision = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
      );
      const { FaceLandmarker, FilesetResolver } = vision;

      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        runningMode: "VIDEO",
        numFaces: 2, // detect up to 2 so we can flag "multiple faces"
      });
      this.ready = true;
      return { ok: true };
    } catch (err) {
      this.loadError = err;
      return {
        ok: false,
        message:
          "Could not load the face-detection model (requires internet on first load). " +
          "Check your connection and refresh.",
      };
    }
  }

  /**
   * Runs detection on the current video frame.
   * Returns { faceCount, landmarks, ear, mar, headPose } or
   * { faceCount: 0 } if no face is visible.
   */
  analyze(videoEl, timestampMs) {
    if (!this.ready || !videoEl.videoWidth) return { faceCount: 0 };

    const result = this.landmarker.detectForVideo(videoEl, timestampMs);
    const faces = result.faceLandmarks || [];
    if (faces.length === 0) return { faceCount: 0 };

    const landmarks = faces[0]; // primary face for metrics
    const toPoint = (idx) => [landmarks[idx].x, landmarks[idx].y];

    const leftEyePts = FACE_LANDMARKS.LEFT_EYE.map(toPoint);
    const rightEyePts = FACE_LANDMARKS.RIGHT_EYE.map(toPoint);
    const mouthPts = FACE_LANDMARKS.MOUTH.map(toPoint);

    const leftEar = eyeAspectRatio(leftEyePts);
    const rightEar = eyeAspectRatio(rightEyePts);
    const avgEar = (leftEar + rightEar) / 2;
    const mar = mouthAspectRatio(mouthPts);

    const headPose = estimateHeadPose(landmarks);

    return {
      faceCount: faces.length,
      landmarks,
      allLandmarkSets: faces,
      ear: avgEar,
      leftEar,
      rightEar,
      mar,
      headPose,
    };
  }
}

function eyeAspectRatio(pts) {
  const [p1, p2, p3, p4, p5, p6] = pts;
  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);
  return horizontal === 0 ? 0 : (vertical1 + vertical2) / (2 * horizontal);
}

function mouthAspectRatio(pts) {
  const [p1, p2, p3, p4, p5, p6] = pts;
  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);
  return horizontal === 0 ? 0 : (vertical1 + vertical2) / (2 * horizontal);
}

function estimateHeadPose(landmarks) {
  const nose = landmarks[FACE_LANDMARKS.NOSE_TIP];
  const chin = landmarks[FACE_LANDMARKS.CHIN];
  const forehead = landmarks[FACE_LANDMARKS.FOREHEAD];
  const leftOuter = landmarks[FACE_LANDMARKS.LEFT_EYE_OUTER];
  const rightOuter = landmarks[FACE_LANDMARKS.RIGHT_EYE_OUTER];

  const eyeMidX = (leftOuter.x + rightOuter.x) / 2;
  const eyeMidY = (leftOuter.y + rightOuter.y) / 2;
  const interEyeDist = euclideanDistance([leftOuter.x, leftOuter.y], [rightOuter.x, rightOuter.y]) || 0.001;
  const faceHeight = euclideanDistance([forehead.x, forehead.y], [chin.x, chin.y]) || 0.001;

  // Yaw: sideways nose offset relative to eye baseline, scaled to ~degrees.
  const yaw = (((nose.x - eyeMidX) / interEyeDist) * -90);

  // Pitch: vertical nose offset relative to the eye->chin midline, scaled to ~degrees.
  const expectedNoseY = (eyeMidY + chin.y) / 2;
  const pitch = (((nose.y - expectedNoseY) / faceHeight) * 90);

  // Roll: tilt of the eye-to-eye line from horizontal.
  const roll =
    (Math.atan2(rightOuter.y - leftOuter.y, rightOuter.x - leftOuter.x) * 180) / Math.PI;

  return { yaw: clamp(yaw, -90, 90), pitch: clamp(pitch, -90, 90), roll: clamp(roll, -90, 90) };
}

/** Draws a lightweight landmark overlay (eyes + mouth outline) for visual feedback. */
function drawFaceOverlay(ctx, canvas, videoEl, analysis) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!analysis || analysis.faceCount === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  const drawRing = (indices, color) => {
    ctx.beginPath();
    indices.forEach((idx, i) => {
      const pt = analysis.landmarks[idx];
      const x = pt.x * w;
      const y = pt.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const cfg = getEffectiveMonitoringConfig();
  const eyeColor = analysis.ear < cfg.EAR_THRESHOLD ? "#ff6b4a" : "#33d17a";
  drawRing(FACE_LANDMARKS.LEFT_EYE, eyeColor);
  drawRing(FACE_LANDMARKS.RIGHT_EYE, eyeColor);

  const mouthColor = analysis.mar > cfg.YAWN_THRESHOLD ? "#f5a623" : "#4da3ff";
  drawRing(FACE_LANDMARKS.MOUTH, mouthColor);
}
