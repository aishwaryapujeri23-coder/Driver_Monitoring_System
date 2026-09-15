"""Unit tests for the risk scoring engine (app/services/risk_engine.py)."""

from app.services.risk_engine import (
    DistractionInputs,
    DrowsinessInputs,
    compute_distraction_score,
    compute_drowsiness_score,
    compute_overall_risk,
    max_risk_level,
    risk_level_from_score,
    TemporalRiskAnalyzer,
    TemporalSample,
)


def _safe_drowsiness() -> DrowsinessInputs:
    return DrowsinessInputs(ear=0.30, eye_closed_duration=0.0, is_yawning=False, yawn_duration=0.0)


def _safe_distraction() -> DistractionInputs:
    return DistractionInputs(
        head_yaw=0.0, head_pitch=0.0, distraction_duration=0.0,
        face_absent_duration=0.0, phone_detected=False,
    )


def test_normal_driving_gives_low_score_and_safe_reasons():
    score, reasons = compute_drowsiness_score(_safe_drowsiness())
    assert score < 15
    assert reasons == []


def test_sustained_eye_closure_raises_drowsiness_score_with_reason():
    inputs = DrowsinessInputs(ear=0.10, eye_closed_duration=2.4, is_yawning=False, yawn_duration=0.0)
    score, reasons = compute_drowsiness_score(inputs)
    assert score > 30
    assert any("Eyes closed" in r for r in reasons)


def test_yawning_increases_score():
    inputs = DrowsinessInputs(ear=0.30, eye_closed_duration=0.0, is_yawning=True, yawn_duration=1.5)
    score, reasons = compute_drowsiness_score(inputs)
    assert score >= 25
    assert any("Yawning" in r for r in reasons)


def test_head_turned_and_sustained_triggers_distraction_reason():
    inputs = DistractionInputs(
        head_yaw=35.0, head_pitch=0.0, distraction_duration=2.5,
        face_absent_duration=0.0, phone_detected=False,
    )
    score, reasons = compute_distraction_score(inputs)
    assert score >= 40
    assert any("looking" in r for r in reasons)


def test_phone_detected_adds_to_distraction_score():
    with_phone = DistractionInputs(
        head_yaw=0.0, head_pitch=0.0, distraction_duration=0.0,
        face_absent_duration=0.0, phone_detected=True,
    )
    without_phone = _safe_distraction()
    score_with, _ = compute_distraction_score(with_phone)
    score_without, _ = compute_distraction_score(without_phone)
    assert score_with > score_without


def test_risk_level_bands_are_monotonic():
    assert risk_level_from_score(0) == "SAFE"
    assert risk_level_from_score(20) == "LOW"
    assert risk_level_from_score(45) == "MEDIUM"
    assert risk_level_from_score(70) == "HIGH"
    assert risk_level_from_score(95) == "CRITICAL"


def test_overall_risk_combines_both_scores_and_explains_why():
    drowsy = DrowsinessInputs(ear=0.10, eye_closed_duration=3.0, is_yawning=False, yawn_duration=0.0)
    distracted = DistractionInputs(
        head_yaw=40.0, head_pitch=0.0, distraction_duration=3.0,
        face_absent_duration=0.0, phone_detected=True,
    )
    result = compute_overall_risk(drowsy, distracted)
    assert result.risk_level in {"HIGH", "CRITICAL"}
    assert len(result.reasons) >= 2


def test_max_risk_level_picks_most_severe():
    assert max_risk_level(["SAFE", "HIGH", "LOW"]) == "HIGH"
    assert max_risk_level([]) == "SAFE"
    assert max_risk_level(["CRITICAL", "MEDIUM"]) == "CRITICAL"


def test_temporal_analyzer_tracks_persistent_phone_and_explains_it():
    analyzer = TemporalRiskAnalyzer(window_seconds=30)
    analyzer.update(TemporalSample(0, 0.3, 0.2, 0, 0, phone_detected=True), now=0)
    result = analyzer.update(TemporalSample(1, 0.3, 0.2, 0, 0, phone_detected=True), now=3)
    assert result.distraction_score >= 25
    assert any("persistently" in reason for reason in result.reasons)
