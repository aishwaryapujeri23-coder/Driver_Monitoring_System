"""Analytics routes: summary totals, timeline series, and a raw event log."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import DetectionEvent, DrivingSession, User
from app.schemas import AnalyticsSummary, TimelinePoint
from app.services.risk_engine import max_risk_level

router = APIRouter()


@router.get("/summary", response_model=AnalyticsSummary)
def analytics_summary(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> AnalyticsSummary:
    sessions = (
        db.query(DrivingSession)
        .filter(DrivingSession.user_id == current_user.id, DrivingSession.status == "completed")
        .all()
    )

    if not sessions:
        return AnalyticsSummary(
            total_sessions=0,
            total_driving_time_seconds=0,
            total_drowsiness_events=0,
            total_distraction_events=0,
            total_yawns=0,
            total_blinks=0,
            total_phone_detections=0,
            average_risk_score=0,
            highest_risk_level="SAFE",
        )

    total_driving_time = sum(s.duration_seconds for s in sessions)
    total_drowsiness = sum(s.drowsiness_events for s in sessions)
    total_distraction = sum(s.distraction_events for s in sessions)
    total_yawns = sum(s.yawn_count for s in sessions)
    total_blinks = sum(s.blink_count for s in sessions)
    total_phone = sum(s.phone_detection_count for s in sessions)
    avg_risk = sum(s.average_risk_score for s in sessions) / len(sessions)
    highest = max_risk_level([s.maximum_risk_level for s in sessions])

    return AnalyticsSummary(
        total_sessions=len(sessions),
        total_driving_time_seconds=total_driving_time,
        total_drowsiness_events=total_drowsiness,
        total_distraction_events=total_distraction,
        total_yawns=total_yawns,
        total_blinks=total_blinks,
        total_phone_detections=total_phone,
        average_risk_score=round(avg_risk, 2),
        highest_risk_level=highest,
    )


@router.get("/timeline", response_model=list[TimelinePoint])
def analytics_timeline(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[TimelinePoint]:
    sessions = (
        db.query(DrivingSession)
        .filter(DrivingSession.user_id == current_user.id, DrivingSession.status == "completed")
        .order_by(DrivingSession.started_at.asc())
        .all()
    )
    return [
        TimelinePoint(
            session_id=s.id,
            started_at=s.started_at,
            duration_seconds=s.duration_seconds,
            average_risk_score=s.average_risk_score,
            maximum_risk_level=s.maximum_risk_level,
            drowsiness_events=s.drowsiness_events,
            distraction_events=s.distraction_events,
        )
        for s in sessions
    ]


@router.get("/events")
def analytics_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 100,
) -> list[dict]:
    events = (
        db.query(DetectionEvent)
        .join(DrivingSession, DetectionEvent.session_id == DrivingSession.id)
        .filter(DrivingSession.user_id == current_user.id)
        .order_by(DetectionEvent.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "session_id": e.session_id,
            "event_type": e.event_type,
            "timestamp": e.timestamp.isoformat(),
            "confidence": e.confidence,
            "duration_seconds": e.duration_seconds,
            "severity": e.severity,
        }
        for e in events
    ]
