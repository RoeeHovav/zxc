"""Speak mathematical notation as words (English and Hebrew).

The goal is not a full math-to-speech system (MathML/LaTeX are not present in
most PDFs) but to read the linear notation that *is* found in PDF text layers
(``f(x) = x² + 2x − 1``, ``a ≤ b``, ``√2``, ``Σ``, ``α``) the way a teacher would,
instead of letting a speech engine skip or mangle the symbols.
"""
from __future__ import annotations

import re
from typing import Dict, List

SUPERSCRIPTS = {"⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
                "⁺": "+", "⁻": "-", "ⁿ": "n", "ⁱ": "i"}
SUBSCRIPTS = {"₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
              "ₙ": "n", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₓ": "x"}

GREEK = {
    "α": ("alpha", "אַלְפָא"), "β": ("beta", "בֵּטָא"), "γ": ("gamma", "גַּמָּא"), "δ": ("delta", "דֶּלְתָּא"),
    "ε": ("epsilon", "אֶפְּסִילוֹן"), "ζ": ("zeta", "זֵטָא"), "η": ("eta", "אֵטָא"), "θ": ("theta", "תֵּטָא"),
    "κ": ("kappa", "קַפָּא"), "λ": ("lambda", "לַמְבְּדָא"), "μ": ("mu", "מְיוּ"), "ν": ("nu", "נְיוּ"),
    "ξ": ("xi", "קְסִי"), "π": ("pi", "פַּאי"), "ρ": ("rho", "רוֹ"), "σ": ("sigma", "סִיגְמָא"), "τ": ("tau", "טָאוּ"),
    "φ": ("phi", "פִי"), "χ": ("chi", "חִי"), "ψ": ("psi", "פְּסִי"), "ω": ("omega", "אוֹמֶגָה"),
    "Δ": ("delta", "דֶּלְתָּא"), "Σ": ("sigma", "סִיגְמָא"), "Ω": ("omega", "אוֹמֶגָה"), "Π": ("pi", "פַּאי"),
    "Φ": ("phi", "פִי"), "Γ": ("gamma", "גַּמָּא"), "Λ": ("lambda", "לַמְבְּדָא"), "Θ": ("theta", "תֵּטָא"),
}

# operator -> (english, hebrew)
OPS: Dict[str, tuple] = {
    "=": ("equals", "שָׁוֶה"),
    "≠": ("is not equal to", "שׁוֹנֶה מִ"),
    "≈": ("is approximately", "שָׁוֶה בְּעֵרֶךְ"),
    "≡": ("is equivalent to", "שָׁקוּל לְ"),
    "<": ("is less than", "קָטָן מִ"),
    ">": ("is greater than", "גָּדוֹל מִ"),
    "≤": ("is less than or equal to", "קָטָן אוֹ שָׁוֶה לְ"),
    "≥": ("is greater than or equal to", "גָּדוֹל אוֹ שָׁוֶה לְ"),
    "+": ("plus", "וְעוֹד"),
    "−": ("minus", "פָּחוֹת"),
    "±": ("plus or minus", "פְּלוּס מִינוּס"),
    "×": ("times", "כָּפוּל"),
    "·": ("times", "כָּפוּל"),
    "∙": ("times", "כָּפוּל"),
    "÷": ("divided by", "חֶלְקֵי"),
    "√": ("the square root of", "שֹׁרֶשׁ שֶׁל"),
    "∞": ("infinity", "אֵינְסוֹף"),
    "∑": ("the sum of", "סְכוּם"),
    "∫": ("the integral of", "אִינְטֶגְרָל שֶׁל"),
    "∂": ("partial", "חֶלְקִי"),
    "∈": ("is in", "שַׁיָּךְ לְ"),
    "∉": ("is not in", "לֹא שַׁיָּךְ לְ"),
    "⊂": ("is a subset of", "תַּת קְבוּצָה שֶׁל"),
    "∪": ("union", "אִיחוּד"),
    "∩": ("intersection", "חִיתּוּךְ"),
    "→": ("goes to", "שׁוֹאֵף לְ"),
    "⇒": ("implies", "גּוֹרֵר"),
    "⇔": ("if and only if", "אִם וְרַק אִם"),
    "∀": ("for all", "לְכָל"),
    "∃": ("there exists", "קַיָּם"),
    "∝": ("is proportional to", "פְּרוֹפּוֹרְצְיוֹנָלִי לְ"),
    "°": ("degrees", "מַעֲלוֹת"),
    "‰": ("per mille", "פְּרוֹמִיל"),
}

MATH_CHARS = set("=≠≈≡≤≥±×÷√∞∑∫∂∈∉⊂∪∩⇒⇔∀∃∝^") | set(SUPERSCRIPTS) | set(SUBSCRIPTS) | set(GREEK) | {"·", "∙"}
_MATH_TOKEN_RE = re.compile(r"[A-Za-z0-9]\s*[+\-−*/^=<>]\s*[A-Za-z0-9(]")


_FUNC_RE = re.compile(r"^[A-Za-z]\([A-Za-z0-9]{1,3}(,[A-Za-z0-9]{1,3})*\)$")


def looks_like_math(token: str) -> bool:
    if any(c in MATH_CHARS for c in token):
        return True
    if _FUNC_RE.match(token):  # f(x), g(t), P(A)
        return True
    if _MATH_TOKEN_RE.search(token) and not re.fullmatch(r"\d{1,4}-\d{1,4}", token):
        # e.g. "a+b", "2x=4" but not year ranges "1911-2002"
        return any(c in "+=^*<>" for c in token) or "−" in token
    return False


def _power_words(exp: str, lang: str) -> str:
    if lang == "he":
        if exp == "2":
            return "בְּרִבּוּעַ"
        if exp == "3":
            return "בִּשְׁלִישִׁית"
        return f"בְּחֶזְקַת {exp}"
    if exp == "2":
        return "squared"
    if exp == "3":
        return "cubed"
    if exp == "-1":
        return "to the minus one"
    return f"to the power of {exp}"


def verbalize(token: str, lang: str) -> str:
    """Turn one math-bearing token into speakable words."""
    he = lang == "he"
    out: List[str] = []
    i = 0
    s = token.replace("−", "−")
    n = len(s)
    while i < n:
        ch = s[i]
        if ch in SUPERSCRIPTS:
            j = i
            exp = ""
            while j < n and s[j] in SUPERSCRIPTS:
                exp += SUPERSCRIPTS[s[j]]
                j += 1
            out.append(_power_words(exp, lang))
            i = j
            continue
        if ch == "^":
            j = i + 1
            exp = ""
            if j < n and s[j] == "(":
                k = s.find(")", j)
                k = n if k < 0 else k
                exp = s[j + 1:k]
                j = k + 1
            else:
                while j < n and (s[j].isalnum() or (s[j] in "-−" and not exp)):
                    exp += s[j]
                    j += 1
            out.append(_power_words(exp.replace("−", "-"), lang))
            i = j
            continue
        if ch in SUBSCRIPTS:
            j = i
            sub = ""
            while j < n and s[j] in SUBSCRIPTS:
                sub += SUBSCRIPTS[s[j]]
                j += 1
            out.append(("סַאבּ " if he else "sub ") + sub)
            i = j
            continue
        if ch in GREEK:
            out.append(GREEK[ch][1 if he else 0])
            i += 1
            continue
        if ch in OPS:
            out.append(OPS[ch][1 if he else 0])
            i += 1
            continue
        if ch == "-" and i > 0 and i + 1 < n and (s[i - 1].isalnum() or s[i - 1] == ")") and (s[i + 1].isalnum() or s[i + 1] == "("):
            out.append(OPS["−"][1 if he else 0])
            i += 1
            continue
        if ch == "*":
            out.append(OPS["×"][1 if he else 0])
            i += 1
            continue
        if ch == "/" and i > 0:
            out.append("חֶלְקֵי" if he else "over")
            i += 1
            continue
        if ch == "(" and i > 0 and s[i - 1].isalpha() and (i < 2 or not s[i - 2].isalpha()):
            # function application f(x)
            k = s.find(")", i)
            if k > i:
                inner = verbalize(s[i + 1:k], lang)
                out.append(("שֶׁל " if he else "of ") + inner)
                i = k + 1
                continue
        if ch in "()[]{}":
            i += 1
            continue
        # run of plain characters
        j = i
        while j < n and s[j] not in SUPERSCRIPTS and s[j] not in SUBSCRIPTS and s[j] not in GREEK \
                and s[j] not in OPS and s[j] not in "^*/()[]{}" and not (s[j] == "-" and j > i):
            j += 1
        chunk = s[i:j]
        # "2x" -> "2 x"
        chunk = re.sub(r"(\d)([A-Za-z])", r"\1 \2", chunk)
        if chunk:
            out.append(chunk)
        i = max(j, i + 1)
    text = " ".join(p for p in out if p)
    return re.sub(r"\s+", " ", text).strip()
