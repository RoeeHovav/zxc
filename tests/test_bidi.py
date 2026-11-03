import pytest

from narrator.pdf.bidi import logical_to_visual_string, visual_to_logical


@pytest.mark.parametrize("text,rtl", [
    ("שלום עולם", True),
    ("בשנת 1992 נחקק החוק", True),
    ("החוקרים השתמשו ב-machine learning כדי לנתח", True),
    ("השופט חיים כהן (1911-2002) סבר", True),
    ("ב-17 בספטמבר", True),
    ("The word שלום means peace", False),
    ("Version 3.14 of the model", False),
    ("1.2.3 כותרת משנה", True),
])
def test_visual_to_logical_roundtrip(text, rtl):
    visual = logical_to_visual_string(text, rtl)
    order = visual_to_logical(list(visual), rtl)
    assert "".join(visual[i] for i in order) == text


def test_numbers_keep_ltr_inside_rtl():
    visual = logical_to_visual_string("כ-2500 עולים", True)
    assert "2500" in visual  # digits are never reversed visually
