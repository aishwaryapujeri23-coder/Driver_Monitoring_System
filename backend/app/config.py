"""
Centralized configuration.

Every tunable value (secrets, thresholds, model paths) is defined here and
sourced from environment variables / a .env file. No other module should
hardcode a threshold or secret.

CALIBRATION NOTE: The EAR/MAR/head-pose thresholds below are reasonable
starting points, NOT universally correct or medically validated. Camera
angle, lighting, and individual facial geometry shift these values. They
exist here, in one place, specifically so they can be tuned without
touching detection logic.
"""

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Driver Drowsiness & Distraction Detection System"
    APP_ENV: str = Field(default="development")
    DEBUG: bool = Field(default=True)

    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:8000", "http://127.0.0.1:8000"]
    )

    DATABASE_URL: str = Field(default="sqlite:///./driver_monitoring.db")

    SECRET_KEY: str = Field(default="CHANGE_ME_INSECURE_DEV_ONLY_SECRET_KEY")
    JWT_ALGORITHM: str = Field(default="HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60 * 12)

    # YOLO — used only for the low-frequency phone-detection endpoint.
    YOLO_MODEL_PATH: str = Field(default="models/yolo/yolov8n.pt")
    YOLO_CONFIDENCE_THRESHOLD: float = Field(default=0.45)
    YOLO_TARGET_CLASSES: List[str] = Field(default=["cell phone", "person"])

    # Drowsiness — EAR
    EAR_THRESHOLD: float = Field(default=0.21)
    EYE_CLOSED_DURATION: float = Field(default=1.5)
    EYE_CLOSED_CRITICAL_DURATION: float = Field(default=2.5)
    BLINK_MIN_DURATION: float = Field(default=0.08)
    BLINK_MAX_DURATION: float = Field(default=0.4)

    # Yawning — MAR
    YAWN_THRESHOLD: float = Field(default=0.6)
    YAWN_DURATION: float = Field(default=1.2)

    # Head pose / distraction
    HEAD_YAW_THRESHOLD: float = Field(default=25.0)
    HEAD_PITCH_THRESHOLD: float = Field(default=20.0)
    DISTRACTION_DURATION: float = Field(default=2.0)
    FACE_ABSENT_DURATION: float = Field(default=2.0)

    # Risk engine
    RISK_WEIGHT_DROWSINESS: float = Field(default=0.6)
    RISK_WEIGHT_DISTRACTION: float = Field(default=0.4)

    # Alerts
    ALERT_COOLDOWN: float = Field(default=5.0)

    # Performance
    PROCESSING_INTERVAL_MS: int = Field(default=150)  # ~6-7 analysis FPS
    PHONE_CHECK_INTERVAL_MS: int = Field(default=3000)  # YOLO sample cadence
    MAX_FRAME_WIDTH: int = Field(default=480)
    TEMPORAL_WINDOW_SECONDS: float = Field(default=30.0)
    SMOOTHING_WINDOW_SAMPLES: int = Field(default=8)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
