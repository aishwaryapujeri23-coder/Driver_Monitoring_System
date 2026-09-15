"""
YOLO object detection service.

Used ONLY for the low-frequency phone-detection endpoint (POST
/api/sessions/detect-phone). Face landmarks, EAR/MAR, and head pose are
handled entirely client-side in the browser (frontend/js/face.js) — sending
every frame to a server-side model for that would add latency for no
benefit. Phone detection genuinely needs a real object detector, so a
downsized frame is sampled every few seconds and sent here.

The model (Ultralytics YOLOv8-nano, pretrained on COCO) is loaded lazily on
first use and cached as a module-level singleton — loading it eagerly at
import time would slow down `uvicorn --reload` and every test run that
doesn't need it.

LIMITATION: YOLO detecting a "cell phone" object in frame does NOT prove
the driver is holding or actively using it — it could be in a mount, on the
seat, or held by a passenger. This endpoint reports raw detections; the
risk engine treats it as one signal among several, not proof of misuse.
"""

import base64
import binascii
from pathlib import Path
from typing import Optional

import numpy as np

from app.config import settings
from app.schemas import DetectedObject

_model = None
_model_load_attempted = False
_model_load_error: Optional[str] = None


def _get_model():
    """Lazily load and cache the Ultralytics YOLO model."""
    global _model, _model_load_attempted, _model_load_error

    if _model is not None:
        return _model
    if _model_load_attempted:
        return None  # already tried and failed this process — don't retry every request

    _model_load_attempted = True
    try:
        from ultralytics import YOLO  # imported lazily — heavy dependency

        model_path = Path(settings.YOLO_MODEL_PATH)
        # Ultralytics will auto-download the pretrained weights (e.g.
        # "yolov8n.pt") to this path on first use if it isn't present yet.
        _model = YOLO(str(model_path) if model_path.exists() else "yolov8n.pt")
        return _model
    except Exception as exc:  # noqa: BLE001 — we want to degrade gracefully, not crash the app
        _model_load_error = str(exc)
        return None


def model_is_available() -> bool:
    return _get_model() is not None


def decode_base64_image(image_base64: str) -> Optional[np.ndarray]:
    """Decodes a base64 JPEG/PNG string into a BGR numpy array (OpenCV format)."""
    import cv2

    try:
        if "," in image_base64 and image_base64.strip().startswith("data:"):
            image_base64 = image_base64.split(",", 1)[1]
        raw = base64.b64decode(image_base64, validate=False)
        arr = np.frombuffer(raw, dtype=np.uint8)
        image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return image
    except (binascii.Error, ValueError):
        return None


def detect_objects(image_base64: str) -> tuple[list[DetectedObject], bool]:
    """
    Runs YOLO inference on a base64-encoded frame.

    Returns (detected_objects, model_available). If the model failed to
    load (e.g. no internet on first run to auto-download weights), returns
    an empty list with model_available=False rather than raising — phone
    detection degrading gracefully should never take down the whole session.
    """
    model = _get_model()
    if model is None:
        return [], False

    image = decode_base64_image(image_base64)
    if image is None:
        return [], True

    height, width = image.shape[:2]
    results = model.predict(
        source=image,
        conf=settings.YOLO_CONFIDENCE_THRESHOLD,
        verbose=False,
    )

    detections: list[DetectedObject] = []
    if not results:
        return detections, True

    result = results[0]
    names = result.names  # class id -> label
    for box in result.boxes:
        cls_id = int(box.cls[0])
        label = names.get(cls_id, str(cls_id))
        if label not in settings.YOLO_TARGET_CLASSES:
            continue
        confidence = float(box.conf[0])
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
        detections.append(
            DetectedObject(
                label=label,
                confidence=round(confidence, 3),
                box=[x1 / width, y1 / height, x2 / width, y2 / height],
            )
        )

    return detections, True
