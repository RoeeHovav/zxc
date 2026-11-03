from narrator.narration.align import Boundary, align


def toks(text):
    out, pos = [], 0
    for i, w in enumerate(text.split()):
        out.append((pos, pos + len(w), i, i))
        pos += len(w) + 1
    return out


def test_exact_boundaries_with_offsets():
    text = "alpha beta gamma"
    b = [Boundary(0.1, 0.3, "alpha", 0), Boundary(0.5, 0.3, "beta", 6), Boundary(0.9, 0.4, "gamma", 11)]
    words, q = align(text, toks(text), b, 1.5, (0, 3))
    assert q == "word"
    assert [w[1] for w in words] == [0.1, 0.5, 0.9]


def test_boundaries_by_text_with_niqqud_and_punctuation():
    text = 'הַסֵּפֶר הזה, "מרתק".'
    b = [Boundary(0.0, 0.4, "הספר"), Boundary(0.5, 0.2, "הזה"), Boundary(0.8, 0.4, "מרתק")]
    words, q = align(text, toks(text), b, 1.4, (0, 3))
    assert q == "word"
    assert [w[1] for w in words] == [0.0, 0.5, 0.8]


def test_missing_boundaries_are_interpolated_and_flagged():
    text = "one two three four five six"
    words, q = align(text, toks(text), [], 3.0, (0, 6))
    assert q == "estimated"
    starts = [w[1] for w in words]
    assert starts == sorted(starts) and starts[-1] < 3.0


def test_merged_token_maps_to_multiple_words():
    text = "בְּצַהַל אמר"
    tokens = [(0, 8, 0, 1), (9, 12, 2, 2)]  # first spoken token covers two source words
    b = [Boundary(0.0, 0.6, "בצהל"), Boundary(0.7, 0.3, "אמר")]
    words, q = align(text, tokens, b, 1.2, (0, 3))
    assert [w[0] for w in words] == [0, 1, 2]
    assert words[0][1] == 0.0 and words[1][1] >= 0.29 and words[2][1] == 0.7
