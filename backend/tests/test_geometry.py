"""Unit tests for EAR/MAR calculations (app/utils/geometry.py)."""

import pytest

from app.utils.geometry import eye_aspect_ratio, euclidean_distance, mouth_aspect_ratio


def test_euclidean_distance():
    assert euclidean_distance((0, 0), (3, 4)) == pytest.approx(5.0)


def test_ear_open_eye_is_higher_than_closed_eye():
    # A "wide open" eye: vertical distances comparable to horizontal width.
    open_eye = [(0, 0), (1, -3), (2, -3), (4, 0), (2, 3), (1, 3)]
    # A "closed" eye: vertical distances collapse toward zero.
    closed_eye = [(0, 0), (1, -0.2), (2, -0.2), (4, 0), (2, 0.2), (1, 0.2)]

    open_ear = eye_aspect_ratio(open_eye)
    closed_ear = eye_aspect_ratio(closed_eye)

    assert open_ear > closed_ear
    assert closed_ear < 0.21  # below default EAR_THRESHOLD


def test_ear_requires_six_points():
    with pytest.raises(ValueError):
        eye_aspect_ratio([(0, 0), (1, 1)])


def test_ear_zero_width_returns_zero_not_error():
    degenerate = [(0, 0), (0, -1), (0, -1), (0, 0), (0, 1), (0, 1)]
    assert eye_aspect_ratio(degenerate) == 0.0


def test_mar_wide_open_mouth_exceeds_yawn_threshold():
    yawning_mouth = [(0, 0), (1, -4), (2, -4), (4, 0), (2, 4), (1, 4)]
    mar = mouth_aspect_ratio(yawning_mouth)
    assert mar > 0.6  # default YAWN_THRESHOLD


def test_mar_closed_mouth_is_low():
    closed_mouth = [(0, 0), (1, -0.1), (2, -0.1), (4, 0), (2, 0.1), (1, 0.1)]
    mar = mouth_aspect_ratio(closed_mouth)
    assert mar < 0.2
