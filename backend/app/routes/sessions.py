"""Session lifecycle routes + the phone-detection sampling endpoint."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import DrivingSession, User
from app.schemas import (
    PhoneDetectRequest,
    PhoneDetectResponse,
    SessionDetailOut,
    SessionOut,
    SessionStopRequest,
)
from app.services import session_service, yolo_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> SessionOut:
    session = session_service.create_session(db, current_user.id)
    logger.info("Session %s started for user %s", session.id, current_user.email)
    return SessionOut.model_validate(session)


@router.post("/{session_id}/stop", response_model=SessionOut)
def stop_session(
    session_id: int,
    payload: SessionStopRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionOut:
    session = _get_owned_session(db, session_id, current_user.id)
    if session.status == "completed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already stopped")

    session = session_service.finalize_session(db, session, payload)
    logger.info(
        "Session %s stopped for user %s — risk=%s avg_score=%.1f",
        session.id, current_user.email, session.maximum_risk_level, session.average_risk_score,
    )
    return SessionOut.model_validate(session)


@router.get("", response_model=list[SessionOut])
def list_sessions(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[SessionOut]:
    sessions = (
        db.query(DrivingSession)
        .filter(DrivingSession.user_id == current_user.id)
        .order_by(DrivingSession.started_at.desc())
        .all()
    )
    return [SessionOut.model_validate(s) for s in sessions]


@router.get("/{session_id}", response_model=SessionDetailOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionDetailOut:
    session = _get_owned_session(db, session_id, current_user.id)
    base = SessionOut.model_validate(session).model_dump()
    base["events"] = [
        {
            "event_type": e.event_type,
            "timestamp": e.timestamp.isoformat(),
            "confidence": e.confidence,
            "duration_seconds": e.duration_seconds,
            "severity": e.severity,
        }
        for e in session.events
    ]
    base["alerts"] = [
        {
            "alert_type": a.alert_type,
            "level": a.level,
            "message": a.message,
            "reasons": a.reasons,
            "timestamp": a.timestamp.isoformat(),
        }
        for a in session.alerts
    ]
    return SessionDetailOut(**base)


@router.post("/detect-phone", response_model=PhoneDetectResponse)
def detect_phone(
    payload: PhoneDetectRequest, current_user: User = Depends(get_current_user)
) -> PhoneDetectResponse:
    """
    Low-frequency (every few seconds, not per-frame) phone/person detection
    on a client-sampled frame. See services/yolo_service.py for the
    detection logic and its stated limitations.
    """
    objects, model_available = yolo_service.detect_objects(payload.image_base64)
    phone_detected = any(o.label == "cell phone" for o in objects)
    person_detected = any(o.label == "person" for o in objects)

    return PhoneDetectResponse(
        objects=objects,
        phone_detected=phone_detected,
        person_detected=person_detected,
        model_available=model_available,
    )


def _get_owned_session(db: Session, session_id: int, user_id: int) -> DrivingSession:
    session = db.get(DrivingSession, session_id)
    if session is None or session.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session
