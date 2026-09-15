"""Pydantic request/response schemas for the API."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class UserRegister(BaseModel):
    email: EmailStr
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------------------------------------------------------------------------
# Driver calibration
# ---------------------------------------------------------------------------
class CalibrationIn(BaseModel):
    ear_baseline: float = Field(gt=0, lt=1)
    ear_std: float = Field(ge=0, lt=1)
    mar_baseline: float = Field(ge=0, lt=10)
    mar_std: float = Field(ge=0, lt=10)
    head_yaw_baseline: float = Field(ge=-90, le=90)
    head_pitch_baseline: float = Field(ge=-90, le=90)
    head_roll_baseline: float = Field(ge=-90, le=90)
    sample_count: int = Field(ge=1, le=100000)


class CalibrationOut(CalibrationIn):
    calibrated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class SessionCreate(BaseModel):
    """Body is empty on purpose — session start time is set server-side."""
    pass


class DetectionEventIn(BaseModel):
    event_type: str
    timestamp: Optional[datetime] = None
    confidence: float = 1.0
    duration_seconds: float = 0.0
    severity: str = "INFO"
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertEventIn(BaseModel):
    alert_type: str
    level: str
    message: str
    reasons: list[str] = Field(default_factory=list)
    timestamp: Optional[datetime] = None


class SessionStopRequest(BaseModel):
    """
    Client-computed session aggregates + the raw event/alert log, submitted
    when the user stops a session. The backend recomputes / validates the
    risk summary rather than trusting the client blindly (see
    services.risk_engine.summarize_session).
    """

    blink_count: int = 0
    yawn_count: int = 0
    eye_closure_events: int = 0
    drowsiness_events: int = 0
    distraction_events: int = 0
    phone_detection_count: int = 0
    total_drowsiness_duration: float = 0.0
    total_distraction_duration: float = 0.0
    longest_eye_closure: float = 0.0
    longest_distraction: float = 0.0
    risk_score_samples: list[float] = Field(default_factory=list)
    maximum_risk_level: str = "SAFE"

    events: list[DetectionEventIn] = Field(default_factory=list)
    alerts: list[AlertEventIn] = Field(default_factory=list)

    @field_validator("maximum_risk_level")
    @classmethod
    def validate_risk_level(cls, v: str) -> str:
        allowed = {"SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"}
        if v not in allowed:
            raise ValueError(f"maximum_risk_level must be one of {allowed}")
        return v


class SessionOut(BaseModel):
    id: int
    started_at: datetime
    ended_at: Optional[datetime]
    duration_seconds: float
    status: str
    blink_count: int
    yawn_count: int
    eye_closure_events: int
    drowsiness_events: int
    distraction_events: int
    phone_detection_count: int
    total_drowsiness_duration: float
    total_distraction_duration: float
    longest_eye_closure: float
    longest_distraction: float
    average_risk_score: float
    maximum_risk_level: str

    model_config = {"from_attributes": True}


class SessionDetailOut(SessionOut):
    events: list[dict[str, Any]] = Field(default_factory=list)
    alerts: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
class AnalyticsSummary(BaseModel):
    total_sessions: int
    total_driving_time_seconds: float
    total_drowsiness_events: int
    total_distraction_events: int
    total_yawns: int
    total_blinks: int
    total_phone_detections: int
    average_risk_score: float
    highest_risk_level: str


class TimelinePoint(BaseModel):
    session_id: int
    started_at: datetime
    duration_seconds: float
    average_risk_score: float
    maximum_risk_level: str
    drowsiness_events: int
    distraction_events: int


# ---------------------------------------------------------------------------
# Phone / object detection
# ---------------------------------------------------------------------------
class PhoneDetectRequest(BaseModel):
    image_base64: str = Field(description="JPEG/PNG frame, base64-encoded (no data: prefix required)")


class DetectedObject(BaseModel):
    label: str
    confidence: float
    box: list[float]  # [x1, y1, x2, y2] normalized 0-1


class PhoneDetectResponse(BaseModel):
    objects: list[DetectedObject]
    phone_detected: bool
    person_detected: bool
    model_available: bool
    note: str = (
        "Detection indicates a phone is visible in frame; it does not prove "
        "the driver is holding or actively using it."
    )
