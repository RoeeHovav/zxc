"""Normalization, lexicon, math and segmentation."""
from collections import Counter

import pytest

from narrator.text.normalize import Lexicon, NormOptions, load_builtin, normalize_words
from narrator.text.segment import sentence_type, split_sentences
from narrator.text.math_speech import verbalize
from narrator.text.script import detect_language

LEX = Lexicon(load_builtin("he") + load_builtin("en"))


def norm(text, lang="he", vocab=None, lex=LEX):
    ws = text.split()
    return [t.text for t in normalize_words(ws, [0] * len(ws), NormOptions(lang=lang, vocab=vocab), lex)]


def test_prefix_hyphen_and_punctuation_repairs():
    assert norm("יהיה ב- 90 מעלות למטרה ,") == ["יהיה", "ב-90", "מעלות", "למטרה,"]
    assert norm("גם כ -2500 עולים") == ["גם", "כ-2500", "עולים"]
    assert norm("על- פי החוק") == ["על-פי", "החוק"]
    assert norm("היסוד .אך הדיון") == ["היסוד.", "אך", "הדיון"]


def kinded(text, kind, lang="he"):
    ws = text.split()
    return [t.text for t in normalize_words(ws, [0] * len(ws), NormOptions(lang=lang, kind=kind), LEX)]


def test_spoken_punctuation_cleanups_found_in_a_real_study_booklet():
    # list bullets and footnote asterisks are not read aloud
    assert kinded("* אברהם בנימין היה בן לענף", "list_item")[0] == "אברהם"
    assert kinded("• צום גדליה חל בתשרי", "list_item")[:2] == ["צום", "גדליה"]
    assert "*" not in "".join(kinded("בשנת 1956;* כמו גם", "paragraph"))
    # a year range that a right-to-left page put back to front is read in order; ordinary ranges are left alone
    assert kinded("רב ופוסק (1575-1488) נולד", "paragraph")[2] == "(1488-1575)"
    assert kinded("בין השנים ו-1970-1956 הוא", "paragraph")[2] == "ו-1956-1970"
    assert kinded("בין השנים 1945-1948 הוא", "paragraph")[2] == "1945-1948"
    assert kinded("year range (1575-1488)", "paragraph", lang="en")[2] == "(1575-1488)"  # only Hebrew pages are reversed
    # a bracket stuck to the previous word, a comma stuck to the next number
    assert kinded("הצבאי( 1955) ובו", "paragraph")[:2] == ["הצבאי", "(1955)"]
    assert kinded("סירקין ( 1868-1924) שפרסם", "paragraph")[1] == "(1868-1924)"
    assert kinded("הגדול ,1936-1939) וכן", "paragraph")[:2] == ["הגדול,", "1936-1939)"]


def test_call_out_labels_get_their_pause_and_unpunctuated_blocks_end_like_sentences():
    assert kinded("למחשבה מדוע דגש רב כל כך מושם?", "note")[0] == "למחשבה:"
    assert kinded("שימו לב כי החוק השתנה", "note")[:2] == ["שימו", "לב:"]
    assert kinded("למחשבה מדוע דגש", "paragraph")[0] == "למחשבה"  # only side notes
    assert kinded("1.1 פתיחה", "heading")[-1] == "פתיחה."
    assert kinded("ערבים מוסלמים", "list_item")[-1] == "מוסלמים."
    assert kinded("חוק השיפוט הצבאי.", "list_item")[-1] == "הצבאי."      # already ends the sentence
    assert kinded("הכותרת: ", "heading")[-1] == "הכותרת:"
    assert kinded("הפסקה נמשכת", "paragraph")[-1] == "נמשכת"           # a paragraph may continue on the next page


def test_hebrew_date_days_are_spoken_as_numbers_not_as_letters():
    assert norm("ד' באייר הוא יום") == ["ארבעה", "באייר", "הוא", "יום"]
    assert norm("חל ב-י' באייר")[1:] == ["בעשרה", "באייר"]
    assert norm('חל ב-כ"ט בחשוון, חמישים')[1:3] == ["בעשרים ותשעה", "בחשוון,"]
    assert norm('י"ב בחשוון')[0] == "שנים עשר" and norm('ט"ו בשבט')[0] == "חמישה עשר" and norm("ל' בניסן")[0] == "שלושים"
    assert norm("פרק ד' באמצע")[1] == "ד'" and norm("סעיף ב' לחוק")[1] == "ב'"  # a letter that is not a date day is left alone


def test_acronym_context_rules():
    out = norm('5 מ"מ וגם מ"מ ומ"פ')
    assert out[1] == "מִילִימֶטֶר"          # after a number: millimetre
    assert out[3] == "מֶם מֶם"              # otherwise: platoon commander
    assert out[4] == "וּמֶם פֵּא"             # prefix ו + acronym
    assert norm('בצה"ל')[0] == "בְּצַהַל"
    assert norm('והרמטכ"ל אמר,')[0] == "וְהַרַמַטְכָּל"


def test_unknown_acronym_untouched():
    assert norm('גפ"ה')[0] == 'גפ"ה'


def test_split_word_repair_uses_document_vocabulary():
    v = Counter({"נקודות": 5, "אתה": 9})
    assert norm("במצב זה נקודו ת אחיזה", vocab=v) == ["במצב", "זה", "נקודות", "אחיזה"]
    assert norm("כיצד א תה מבין", vocab=v) == ["כיצד", "אתה", "מבין"]
    # without evidence nothing is merged
    assert norm("כיצד א תה מבין", vocab=Counter()) == ["כיצד", "א", "תה", "מבין"]


def test_leaders_dropped():
    assert norm("פתח דבר ........................ 10") == ["פתח", "דבר", "10"]


def test_english_abbreviations_math_citations():
    out = " ".join(norm("see Fig. 3 , e.g. when α ≤ 3 [12] at https://example.com/a/b", lang="en"))
    assert "Figure 3" in out and "for example" in out
    assert "alpha is less than or equal to 3" in out
    assert "[12]" not in out
    assert "example.com" in out and "https" not in out


def test_math_verbalization():
    assert verbalize("x²+y²=z²", "en") == "x squared plus y squared equals z squared"
    assert verbalize("x²", "he") == "x בְּרִבּוּעַ"
    assert verbalize("a^3", "en") == "a cubed"
    assert "the square root of" in verbalize("√2", "en")
    assert norm("Let f(x) = x² + 1", lang="en") == ["Let", "f of x", "equals", "x squared", "plus", "1"]
    assert norm("f(x) שווה", lang="he")[0] == "f שֶׁל x"


def test_english_hyphenation_join():
    v = Counter({"pronunciation": 3})
    assert norm("correct pro- nunciation matters", lang="en", vocab=v) == ["correct", "pronunciation", "matters"]
    assert norm("a well- known fact", lang="en", vocab=Counter()) == ["a", "well-known", "fact"]


def test_user_phrase_rule_beats_builtin():
    from narrator.text.normalize import LexEntry
    lex = Lexicon([LexEntry("ספר תורה", "סֵפֶר תּוֹרָה", "he", scope="document"), LexEntry('צה"ל', "צָבָא", "he", scope="global")] + load_builtin("he"))
    assert norm('קראו ספר תורה בצה"ל', lex=lex) == ["קראו", "סֵפֶר תּוֹרָה", "בְּצָבָא"]


@pytest.mark.parametrize("text,expected", [
    ("Dr. Smith arrived. He sat down. Was it late?", 3),
    ("The value is 3.14 approx. the same as before.", 1),
    ("e.g. this one, i.e. that one. Next sentence here.", 2),
    ("1. First item ends here.", 1),
    ('הוא אמר שלום. היא ענתה וכו\'. האם הבינו?', 3),
    ("א. סעיף ראשון בתוך רשימה.", 1),
])
def test_sentence_split(text, expected):
    assert len(split_sentences(text.split())) == expected


def test_sentence_types():
    assert sentence_type("Is this significant?", "paragraph") == "question"
    assert sentence_type("We define the error rate as the fraction of errors.", "paragraph") == "definition"
    assert sentence_type("שימו לב: יש לנקות את הנשק.", "paragraph") == "warning"
    assert sentence_type("לסיכום, התוצאות תומכות בהשערה.", "paragraph") == "conclusion"


def test_language_detection():
    assert detect_language("הספר שקניתי אתמול מרתק", "en") == "he"
    assert detect_language("The quick brown fox jumps over the lazy dog", "he") == "en"
    assert detect_language("Le chat est sur la table et il dort tranquillement", "en") == "fr"
    assert detect_language("Мама мыла раму", "en") in ("ru", "uk", "bg")


def test_voice_lab_style_correction_rule_names_the_neighbours():
    """A correction saved as 'left word right' changes only that wording, and the assistant leaves vowelled words alone."""
    from narrator.text.normalize import LexEntry
    from narrator.llm.pronounce import hebrew_words
    lex = Lexicon([LexEntry("הינו שמן של", "הינו שְׁמָן של", "he", scope="global")] + load_builtin("he"))
    out = norm("מקראות ישראל הינו שמן של חוברות", lex=lex)
    assert any("שְׁמָן" in t for t in out)
    other = norm("קניתי שמן זית", lex=lex)
    assert not any("שְׁמָן" in t for t in other)  # oil elsewhere is untouched
    assert [w for _, _, w in hebrew_words(" ".join(out))] == ["מקראות", "ישראל", "של", "חוברות"] or "שְׁמָן" in " ".join(out)
