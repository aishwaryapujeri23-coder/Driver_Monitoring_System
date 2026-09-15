"""SQLAlchemy ORM models: User, DrivingSession, DetectionEvent, AlertEvent."""

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RiskLevel(str, enum.Enum):
    SAFE = "SAFE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class EventType(str, enum.Enum):
    EYE_CLOSED = "EYE_CLOSED"
    BLINK = "BLINK"
    YAWN = "YAWN"
    HEAD_TURN = "HEAD_TURN"
    LOOKING_DOWN = "LOOKING_DOWN"
    FACE_ABSENT = "FACE_ABSENT"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    PHONE_DETECTED = "PHONE_DETECTED"
    DROWSINESS_ALERT = "DROWSINESS_ALERT"
    DISTRACTION_ALERT = "DISTRACTION_ALERT"


class Severity(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    DANGER = "DANGER"
    CRITICAL = "CRITICAL"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    sessions: Mapped[list["DrivingSession"]] = relationship(
        "DrivingSession", back_populates="user", cascade="all, delete-orphan"
    )
    calibration: Mapped["DriverCalibration | None"] = relationship(
        "DriverCalibration", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class DriverCalibration(Base):
    __tablename__ = "driver_calibrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False, index=True)
    ear_baseline: Mapped[float] = mapped_column(Float, nullable=False)
    ear_std: Mapped[float] = mapped_column(Float, default=0.0)
    mar_baseline: Mapped[float] = mapped_column(Float, nullable=False)
    mar_std: Mapped[float] = mapped_column(Float, default=0.0)
    head_yaw_baseline: Mapped[float] = mapped_column(Float, default=0.0)
    head_pitch_baseline: Mapped[float] = mapped_column(Float, default=0.0)
    head_roll_baseline: Mapped[float] = mapped_column(Float, default=0.0)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    calibrated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped["User"] = relationship("User", back_populates="calibration")


class DrivingSession(Base):
    __tablename__ = "driving_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | completed

    blink_count: Mapped[int] = mapped_column(Integer, default=0)
    yawn_count: Mapped[int] = mapped_column(Integer, default=0)
    eye_closure_events: Mapped[int] = mapped_column(Integer, default=0)
    drowsiness_events: Mapped[int] = mapped_column(Integer, default=0)
    distraction_events: Mapped[int] = mapped_column(Integer, default=0)
    phone_detection_count: Mapped[int] = mapped_column(Integer, default=0)

    total_drowsiness_duration: Mapped[float] = mapped_column(Float, default=0.0)
    total_distraction_duration: Mapped[float] = mapped_column(Float, default=0.0)
    longest_eye_closure: Mapped[float] = mapped_column(Float, default=0.0)
    longest_distraction: Mapped[float] = mapped_column(Float, default=0.0)

    average_risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    maximum_risk_level: Mapped[str] = mapped_column(String(20), default=RiskLevel.SAFE.value)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    events: Mapped[list["DetectionEvent"]] = relationship(
        "DetectionEvent", back_populates="session", cascade="all, delete-orphan"
    )
    alerts: Mapped[list["AlertEvent"]] = relationship(
        "AlertEvent", back_populates="session", cascade="all, delete-orphan"
    )


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("driving_sessions.id"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    severity: Mapped[str] = mapped_column(String(20), default=Severity.INFO.value)
    event_metadata: Mapped[dict] = mapped_column(JSON, default=dict)

    session: Mapped["DrivingSession"] = relationship("DrivingSession", back_populates="events")


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("driving_sessions.id"), nullable=False, index=True
    )
    alert_type: Mapped[str] = mapped_column(String(30), nullable=False)
    level: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped["DrivingSession"] = relationship("DrivingSession", back_populates="alerts")
