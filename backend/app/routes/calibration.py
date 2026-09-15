"""Authenticated driver calibration profile endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import DriverCalibration, User
from app.schemas import CalibrationIn, CalibrationOut

router = APIRouter()


@router.get("", response_model=CalibrationOut | None)
def get_calibration(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> CalibrationOut | None:
    return db.query(DriverCalibration).filter(DriverCalibration.user_id == current_user.id).first()


@router.put("", response_model=CalibrationOut)
def save_calibration(
    payload: CalibrationIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalibrationOut:
    calibration = db.query(DriverCalibration).filter(
        DriverCalibration.user_id == current_user.id
    ).first()
    if calibration is None:
        calibration = DriverCalibration(user_id=current_user.id)
        db.add(calibration)

    for field, value in payload.model_dump().items():
        setattr(calibration, field, value)
    db.commit()
    db.refresh(calibration)
    return calibration