"""Session persistence: creating sessions, recording finalized stats/events/alerts."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session as DBSession

from app.models import AlertEvent, DetectionEvent, DrivingSession
from app.schemas import SessionStopRequest


def create_session(db: DBSession, user_id: int) -> DrivingSession:
    session = DrivingSession(user_id=user_id, status="active")
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def finalize_session(
    db: DBSession, session: DrivingSession, payload: SessionStopRequest
) -> DrivingSession:
    """
    Writes the final aggregate stats plus the full event/alert log for a
    session being stopped. Average risk is recomputed server-side from the
    submitted samples rather than trusted verbatim from the client.
    """
    now = datetime.now(timezone.utc)
    session.ended_at = now
    started_at = session.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    session.duration_seconds = max((now - started_at).total_seconds(), 0.0)
    session.status = "completed"

    session.blink_count = payload.blink_count
    session.yawn_count = payload.yawn_count
    session.eye_closure_events = payload.eye_closure_events
    session.drowsiness_events = payload.drowsiness_events
    session.distraction_events = payload.distraction_events
    session.phone_detection_count = payload.phone_detection_count
    session.total_drowsiness_duration = payload.total_drowsiness_duration
    session.total_distraction_duration = payload.total_distraction_duration
    session.longest_eye_closure = payload.longest_eye_closure
    session.longest_distraction = payload.longest_distraction
    session.maximum_risk_level = payload.maximum_risk_level

    if payload.risk_score_samples:
        session.average_risk_score = round(
            sum(payload.risk_score_samples) / len(payload.risk_score_samples), 2
        )
    else:
        session.average_risk_score = 0.0

    for event_in in payload.events:
        db.add(
            DetectionEvent(
                session_id=session.id,
                event_type=event_in.event_type,
                timestamp=event_in.timestamp or now,
                confidence=event_in.confidence,
                duration_seconds=event_in.duration_seconds,
                severity=event_in.severity,
                event_metadata=event_in.metadata,
            )
        )

    for alert_in in payload.alerts:
        db.add(
            AlertEvent(
                session_id=session.id,
                alert_type=alert_in.alert_type,
                level=alert_in.level,
                message=alert_in.message,
                reasons=alert_in.reasons,
                timestamp=alert_in.timestamp or now,
            )
        )

    db.commit()
    db.refresh(session)
    return session
