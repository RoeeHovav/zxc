# Segment plan and state (no book content — page ranges and process state only)

Each chapter is authored in *segments* of at most ~12 book pages (one author agent each, ids `f<seg>…`, `l<seg>…`, `q<seg>…`).
Pipeline per segment: **author** → expand/validate/coverage (0 errors, 0 warnings, no uncovered core unit) → **blind second reading** of every
transcribed image text → **completeness critic** (claims in the source that no fact captures) → **independent verification** (batches ≤ 90 questions,
`make-batches.mjs <ch> 90 --seg <s>`) → `apply-verdicts` → fixlist → **repair** → **re-verification of changed ids** (`make-repair-batches.mjs <ch> <round> <ids> 90 <s>`)
until every item is `verified` (or explicitly `flagged` for human review). State legend: `—` not started · `A` authored · `V` validated · `R1…` verification rounds done ·
`OK` everything verified.

| Chapter | Segment | Pages | State |
|---|---|---|---|
| ch1 | (single) | 13–23 | OK – everything verified |
| ch2 | a | 24–36 (to the end of the Christians paragraph) | OK – everything verified (R1–R4) |
| ch2 | b | 36–46 (from p036.u02) | author running |
| ch2 | c | 47–52 | — |
| ch3 | a | 53–64 | A V R1 R2 R3 repaired; R4 (3 items) running |
| ch3 | b | 65–75 | author running |
| ch3 | c | 76–81 | — |
| ch4 | a | 82–89 | author running |
| ch4 | b | 90–96 | — |
| ch5 | a | 97–107 | A V; R1 partly done – PAUSED (chapter locked in the app as "עובדים על זה") |
| ch5 | b | 108–117 | — |
| ch6 | a | 118–128 | — |
| ch6 | b | 129–139 | — |
| ch6 | c | 140–150 | — |
| ch6 | d | 151–161 | — |
| ch6 | e | 162–171 | — |
| ch7 | a | 172–182 | — |
| ch7 | b | 183–194 | — |
| ch7 | c | 195–206 | — |
| ch8 | a | 207 (blank map — image) | — |
| ch9 | a | 208–214 | — |
| ch9 | b | 215–220 | — |
| ch10 | a | 221–231 | — |
| ch10 | b | 232–242 | — |
| ch11 | a | 243–247 | — |
| ch12 | a | 248–254 | — |
| ch12 | b | 255–260 | — |
| ch13 | a | 261–271 | — |
| ch13 | b | 272–282 | — |
| ch13 | c | 283–293 | — |
| ch13 | d | 294–304 | — |
| ch13 | e | 305–314 | — |

Priority (user request): chapters 1–4 first; chapters 5 and on are visible but locked in the app (`pipeline/availability.json`) and their existing work is preserved in `private/`.

Concurrency rule: at most 3–4 agents at a time (a burst of 12 triggered the account rate limit and killed all running agents). Everything is resumable: output lives in
`private/content/<ch>/{src,verdicts,…}`; scripts are idempotent.
