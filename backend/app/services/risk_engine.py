"""
Risk scoring engine.

Pure functions only — no I/O, no database, no state — which is what makes
this module independently unit-testable (tests/test_risk_engine.py) and
what the same logic in frontend/js/monitoring.js mirrors for live, in-browser
scoring. The backend copy here is the authoritative reference used to
validate/recompute session summaries when a session is stopped.

Design (mirrors spec section 13):

    drowsiness_score = weighted combination of:
        - sustained eye closure (0-1, scaled by how far past threshold)
        - yawning
        - frequency of drowsiness events so far this session

    distraction_score = weighted combination of:
        - head turned away from forward
        - face absent
        - phone detected

    overall_risk_score = RISK_WEIGHT_DROWSINESS * drowsiness_score
                        + RISK_WEIGHT_DISTRACTION * distraction_score

    overall_risk_score (0-100) maps to a risk LEVEL band.

Every score comes with a `reasons: list[str]` explaining *why* — this is a
deliberate requirement (spec: "the backend should be able to explain WHY it
occurred"), not just a number.
"""

from collections import deque
from dataclasses import dataclass, field
from time import monotonic

from app.config import settings


@dataclass
class DrowsinessInputs:
    ear: float
    eye_closed_duration: float  # seconds eyes have been continuously below EAR_THRESHOLD
    is_yawning: bool
    yawn_duration: float
    drowsiness_event_count: int = 0
    blink_frequency: float = 0.0  # blinks per minute in the rolling window
    yawn_frequency: float = 0.0  # yawns per minute in the rolling window


@dataclass
class DistractionInputs:
    head_yaw: float
    head_pitch: float
    distraction_duration: float  # seconds head has been continuously outside safe range
    face_absent_duration: float
    phone_detected: bool
    phone_duration: float = 0.0


@dataclass
class RiskResult:
    drowsiness_score: float  # 0-100
    distraction_score: float  # 0-100
    overall_risk_score: float  # 0-100
    risk_level: str  # SAFE | LOW | MEDIUM | HIGH | CRITICAL
    reasons: list[str] = field(default_factory=list)


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def compute_drowsiness_score(inputs: DrowsinessInputs) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = 0.0

    # Eye closure contributes up to 60 points, scaling with how far past the
    # "sustained closure" threshold the driver already is. This rewards
    # early detection (small score as soon as closure starts) while ramping
    # sharply toward the critical duration.
    if inputs.eye_closed_duration >= settings.EYE_CLOSED_DURATION:
        overshoot = inputs.eye_closed_duration - settings.EYE_CLOSED_DURATION
        span = max(settings.EYE_CLOSED_CRITICAL_DURATION - settings.EYE_CLOSED_DURATION, 0.01)
        eye_component = 30 + 30 * _clamp(overshoot / span, 0, 1)
        score += eye_component
        reasons.append(f"Eyes closed for {inputs.eye_closed_duration:.1f}s")
    elif inputs.ear < settings.EAR_THRESHOLD:
        # Below threshold but not yet "sustained" — small early contribution.
        score += 8
        reasons.append("Eyes appear partially closed")

    # Yawning contributes up to 25 points.
    if inputs.is_yawning and inputs.yawn_duration >= settings.YAWN_DURATION:
        score += 25
        reasons.append(f"Yawning for {inputs.yawn_duration:.1f}s")

    # Repeated drowsiness events this session raise a baseline concern,
    # up to 15 points — a driver who has already had 3+ events is riskier
    # even in an instantaneous "fine" frame.
    event_component = min(inputs.drowsiness_event_count * 3, 15)
    score += event_component
    if inputs.drowsiness_event_count >= 3:
        reasons.append(f"{inputs.drowsiness_event_count} drowsiness events this session")

    frequency_component = min(inputs.blink_frequency / 12 * 5 + inputs.yawn_frequency / 3 * 10, 15)
    score += frequency_component
    if inputs.yawn_frequency >= 1:
        reasons.append(f"Yawning frequency is {inputs.yawn_frequency:.1f}/min")

    return _clamp(score), reasons


def compute_distraction_score(inputs: DistractionInputs) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = 0.0

    head_off_axis = (
        abs(inputs.head_yaw) > settings.HEAD_YAW_THRESHOLD
        or abs(inputs.head_pitch) > settings.HEAD_PITCH_THRESHOLD
    )

    if head_off_axis and inputs.distraction_duration >= settings.DISTRACTION_DURATION:
        score += 40
        direction = "left" if inputs.head_yaw < -settings.HEAD_YAW_THRESHOLD else (
            "right" if inputs.head_yaw > settings.HEAD_YAW_THRESHOLD else
            ("down" if inputs.head_pitch > settings.HEAD_PITCH_THRESHOLD else "up")
        )
        reasons.append(
            f"Driver looking {direction} for {inputs.distraction_duration:.1f}s"
        )
    elif head_off_axis:
        score += 10
        reasons.append("Driver momentarily looking away")

    if inputs.face_absent_duration >= settings.FACE_ABSENT_DURATION:
        score += 35
        reasons.append(f"Face not detected for {inputs.face_absent_duration:.1f}s")

    if inputs.phone_detected:
        score += 25
        reasons.append("Phone persistently detected" if inputs.phone_duration >= 2 else "Phone detected in frame")

    return _clamp(score), reasons


def risk_level_from_score(score: float) -> str:
    if score < 15:
        return "SAFE"
    if score < 35:
        return "LOW"
    if score < 60:
        return "MEDIUM"
    if score < 80:
        return "HIGH"
    return "CRITICAL"


def compute_overall_risk(
    drowsiness: DrowsinessInputs, distraction: DistractionInputs
) -> RiskResult:
    drowsiness_score, drowsiness_reasons = compute_drowsiness_score(drowsiness)
    distraction_score, distraction_reasons = compute_distraction_score(distraction)

    overall = (
        settings.RISK_WEIGHT_DROWSINESS * drowsiness_score
        + settings.RISK_WEIGHT_DISTRACTION * distraction_score
    )
    overall = _clamp(overall)
    level = risk_level_from_score(overall)

    reasons = drowsiness_reasons + distraction_reasons
    if not reasons:
        reasons = ["Normal eye activity", "Driver looking forward"]

    return RiskResult(
        drowsiness_score=drowsiness_score,
        distraction_score=distraction_score,
        overall_risk_score=overall,
        risk_level=level,
        reasons=reasons,
    )


RISK_LEVEL_ORDER = ["SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def max_risk_level(levels: list[str]) -> str:
    """Returns the most severe risk level from a list, defaulting to SAFE."""
    if not levels:
        return "SAFE"
    return max(levels, key=lambda lvl: RISK_LEVEL_ORDER.index(lvl) if lvl in RISK_LEVEL_ORDER else 0)


@dataclass
class TemporalSample:
    timestamp: float
    ear: float | None
    mar: float | None
    head_yaw: float
    head_pitch: float
    head_roll: float = 0.0
    face_present: bool = True
    phone_detected: bool = False
    eye_closed: bool = False
    yawning: bool = False
    blink: bool = False
    yawn: bool = False


class TemporalRiskAnalyzer:
    """Small stateful rolling-window adapter around the pure scoring functions."""

    def __init__(self, window_seconds: float | None = None, max_samples: int = 240):
        self.window_seconds = window_seconds or settings.TEMPORAL_WINDOW_SECONDS
        self.samples: deque[TemporalSample] = deque(maxlen=max_samples)
        self.eye_closed_since: float | None = None
        self.off_axis_since: float | None = None
        self.phone_since: float | None = None
        self.face_absent_since: float | None = None

    def update(self, sample: TemporalSample, now: float | None = None) -> RiskResult:
        current = now if now is not None else (sample.timestamp or monotonic())
        self.samples.append(sample)
        while self.samples and current - self.samples[0].timestamp > self.window_seconds:
            self.samples.popleft()

        if sample.eye_closed:
            self.eye_closed_since = current if self.eye_closed_since is None else self.eye_closed_since
        else:
            self.eye_closed_since = None
        off_axis = abs(sample.head_yaw) > settings.HEAD_YAW_THRESHOLD or abs(sample.head_pitch) > settings.HEAD_PITCH_THRESHOLD
        if off_axis:
            self.off_axis_since = current if self.off_axis_since is None else self.off_axis_since
        else:
            self.off_axis_since = None
        if sample.phone_detected:
            self.phone_since = current if self.phone_since is None else self.phone_since
        else:
            self.phone_since = None
        if not sample.face_present:
            self.face_absent_since = current if self.face_absent_since is None else self.face_absent_since
        else:
            self.face_absent_since = None

        window_start = self.samples[0].timestamp if self.samples else current
        minutes = max((current - window_start) / 60, 1 / 60)
        def transitions(attribute: str) -> int:
            previous = False
            count = 0
            for item in self.samples:
                active = bool(getattr(item, attribute))
                if active and not previous:
                    count += 1
                previous = active
            return count

        return compute_overall_risk(
            DrowsinessInputs(
                ear=sample.ear or 0.0,
                eye_closed_duration=current - self.eye_closed_since if self.eye_closed_since is not None else 0.0,
                is_yawning=sample.yawning,
                yawn_duration=0.0,
                drowsiness_event_count=transitions("eye_closed"),
                blink_frequency=sum(s.blink for s in self.samples) / minutes,
                yawn_frequency=sum(s.yawn for s in self.samples) / minutes,
            ),
            DistractionInputs(
                head_yaw=sample.head_yaw,
                head_pitch=sample.head_pitch,
                distraction_duration=current - self.off_axis_since if self.off_axis_since is not None else 0.0,
                face_absent_duration=current - self.face_absent_since if self.face_absent_since is not None else 0.0,
                phone_detected=sample.phone_detected,
                phone_duration=current - self.phone_since if self.phone_since is not None else 0.0,
            ),
        )
