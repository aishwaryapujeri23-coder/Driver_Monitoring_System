"""
Geometry helpers for facial-landmark-based metrics.

These are the Python reference implementations of the same formulas used
live in the browser (frontend/js/face.js). They exist here so the core
math is unit-testable (see tests/test_geometry.py) independent of any
webcam/UI plumbing, and so the algorithm is documented in one clear place.

Eye Aspect Ratio (EAR)
-----------------------
Given 6 points around an eye, ordered as:

    p1 -- p2 -- p3
    |            |
    p6 -- p5 -- p4     (roughly; p1/p4 are the eye corners)

    EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)

The numerator sums the two vertical eye-opening distances; the denominator
is the (constant) horizontal eye width. When the eye is open, the vertical
distances are large relative to the width, giving EAR roughly 0.25-0.35.
As the eyelid closes, the vertical distances shrink toward zero while the
horizontal width stays roughly constant, so EAR drops sharply — that sharp,
mostly person-independent drop is what makes EAR useful for closure
detection, versus e.g. raw eyelid pixel distance which varies by face size.

Mouth Aspect Ratio (MAR)
-------------------------
Same idea applied to the mouth: vertical mouth-opening distance(s) over
horizontal mouth width. A sustained large MAR indicates the mouth is open
wide for a sustained period — characteristic of a yawn, as opposed to
speaking (which produces short, low-amplitude MAR fluctuations).
"""

import math
from typing import Sequence

Point = tuple[float, float]


def euclidean_distance(p1: Point, p2: Point) -> float:
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def eye_aspect_ratio(eye_points: Sequence[Point]) -> float:
    """
    eye_points must be 6 (x, y) points ordered:
    [p1 (left corner), p2, p3, p4 (right corner), p5, p6]
    matching the classic Soukupova & Cech EAR formulation.
    """
    if len(eye_points) != 6:
        raise ValueError("eye_aspect_ratio requires exactly 6 landmark points")

    p1, p2, p3, p4, p5, p6 = eye_points
    vertical_1 = euclidean_distance(p2, p6)
    vertical_2 = euclidean_distance(p3, p5)
    horizontal = euclidean_distance(p1, p4)

    if horizontal == 0:
        return 0.0

    return (vertical_1 + vertical_2) / (2.0 * horizontal)


def mouth_aspect_ratio(mouth_points: Sequence[Point]) -> float:
    """
    mouth_points must be 6 (x, y) points ordered:
    [p1 (left corner), p2, p3 (top-inner), p4 (right corner), p5, p6 (bottom-inner)]
    Same structural idea as EAR — vertical mouth opening over horizontal mouth width.
    """
    if len(mouth_points) != 6:
        raise ValueError("mouth_aspect_ratio requires exactly 6 landmark points")

    p1, p2, p3, p4, p5, p6 = mouth_points
    vertical_1 = euclidean_distance(p2, p6)
    vertical_2 = euclidean_distance(p3, p5)
    horizontal = euclidean_distance(p1, p4)

    if horizontal == 0:
        return 0.0

    return (vertical_1 + vertical_2) / (2.0 * horizontal)


def average_ear(left_eye_points: Sequence[Point], right_eye_points: Sequence[Point]) -> float:
    return (eye_aspect_ratio(left_eye_points) + eye_aspect_ratio(right_eye_points)) / 2.0
