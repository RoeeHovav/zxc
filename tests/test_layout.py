"""Extraction accuracy on realistic fixtures (Chrome/Skia PDFs)."""
import re

from conftest import block_texts


def all_text(doc, kinds=("paragraph", "heading", "list_item", "note", "caption", "footnote")):
    out = []
    for n in range(doc.page_count):
        out += [t for k, t in block_texts(doc.page(n)) if k in kinds]
    return "\n".join(out)


def test_hebrew_logical_order_and_niqqud(make_doc, he_pdf):
    d = make_doc(he_pdf)
    text = all_text(d)
    assert "הספר שקניתי אתמול עוסק בלמידה." in text
    assert "הַסֵּפֶר הַזֶּה מְנֻקָּד בַּחֶלְקוֹ." in text  # niqqud attached to the right letters
    assert "ב-17 בספטמבר 1982 התקבלה ההחלטה הסופית." in text  # numbers + prefixes in order
    assert "כ-2500 משתתפים" in text
    assert "בשיטת machine learning כדי" in text  # embedded English run in order
    assert 'המג"ד והמ"פ הציגו את התוכנית לרמטכ"ל' in text


def test_hebrew_structure(make_doc, he_pdf):
    d = make_doc(he_pdf)
    p0 = block_texts(d.page(0))
    kinds = [k for k, _ in p0]
    assert ("heading", "מבוא לחקר הלמידה") in p0
    assert ("heading", "פרק 1: רקע תיאורטי") in p0
    assert kinds.count("list_item") == 3  # bullets drawn as vector shapes
    assert kinds[0] == "header" and kinds[-1] == "page_number"
    assert d.stats().rtl


def test_cross_page_paragraph_continuation(make_doc, he_pdf):
    from narrator.narration.units import UnitIndex
    d = make_doc(he_pdf)
    assert d.continues_from_previous_page(1)
    idx = UnitIndex(d)
    spanning = [u for u in idx.units_on_page(0) if len({p for p, _ in u.words}) == 2]
    assert len(spanning) == 1
    u = spanning[0]
    assert "בשנת 2019. המג\"ד" in u.text() or "2019. המג\"ד" in u.text()
    # page 1 must not start a new unit for the continued paragraph
    assert all(x.page == 1 for x in idx.units_on_page(1))
    assert idx.units_on_page(1)[0].kind == "header"


def test_two_column_reading_order(make_doc, en_pdf):
    d = make_doc(en_pdf)
    text = all_text(d)
    # paragraphs are contiguous (columns not interleaved)
    assert "Reading long documents aloud is demanding. The method was evaluated on three independent datasets." in text
    i_intro = text.index("1. Introduction")
    i_method = text.index("2. Method")
    i_list = text.index("1. Extract text in reading order.")
    i_results = text.index("3. Results")
    i_concl = text.index("4. Conclusion")
    assert i_intro < i_method < i_list < i_results < i_concl
    assert "x² + y² = z²" in text


def test_english_classification(make_doc, en_pdf):
    d = make_doc(en_pdf)
    kinds = {}
    for n in range(d.page_count):
        for k, t in block_texts(d.page(n)):
            kinds.setdefault(k, []).append(t)
    assert any(t.startswith("Figure 1:") for t in kinds["caption"])
    assert "Journal of Narration Studies — Vol. 7" in kinds["header"]
    assert len(kinds["page_number"]) == d.page_count
    assert [t for t in kinds["list_item"] if re.match(r"^[123]\. ", t)]


def test_word_boxes_inside_page(make_doc, he_pdf):
    d = make_doc(he_pdf)
    pg = d.page(0)
    assert pg["words"]
    for w in pg["words"]:
        assert 0 <= w[1] <= w[3] <= pg["w"] + 1
        assert 0 <= w[2] <= w[4] <= pg["h"] + 1


def test_cache_reuse(make_doc, he_pdf, tmp_path):
    from narrator.pdf.document import PdfDocument
    d = make_doc(he_pdf)
    first = d.page(0)
    d2 = PdfDocument(he_pdf, d.cache_dir)
    assert d2.is_page_cached(0)
    assert d2.page(0)["words"] == first["words"]
    d2.close()


def test_concurrent_page_requests_do_not_collide(make_doc, en_pdf):
    """Background processing and on-demand requests may ask for the same page."""
    import threading
    d = make_doc(en_pdf)
    d.stats()
    errors = []

    def worker():
        try:
            for n in range(d.page_count):
                d.page(n)
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
