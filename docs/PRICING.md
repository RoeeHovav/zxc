# Pricing engine specification

Source: `src/domain/pricing/engine.ts` · Tests: `src/domain/pricing/engine.test.ts`

## Internal cost vs customer price vs realized profit

- **Estimated cost** — what the engine expects the job to cost the business (material, machine, labor,
  allowances, packing, shipping, payment fees). Never shown to customers.
- **Customer price** — net amount charged (excluding VAT). VAT is a liability collected for the tax
  authority, so it is **not revenue** and is excluded from profit.
- **Realized profit** — after fulfillment: revenue minus *actual* cost (actual grams, actual machine time,
  failed prints, actual labor). Reports compare estimated vs actual ("pricing variance").

## Markup vs margin

| | Formula | 100 cost → price |
|---|---|---|
| Markup on cost `m` | `price = cost × (1 + m)`, `m = profit ÷ cost` | 50% markup → 150 |
| Gross margin on sales `g` | `price = cost ÷ (1 − g)`, `g = profit ÷ price` | 50% margin → 200 |

Conversion: `g = m ÷ (1 + m)`, `m = g ÷ (1 − g)`. A 100% markup is a 50% margin. A margin of 100% is
impossible (division by zero) and is rejected.

## Line cost (print services)

Per line with quantity `q`, units per batch `b`, batches `B = ceil(q ÷ b)`:

| Component | Formula |
|---|---|
| Model grams | `grams/unit × q` |
| Material waste | `model grams × waste%` (material override or global) |
| Purge grams | `purge/batch × B` |
| Material cost | `(model + waste + purge) g × price/kg ÷ 1000` |
| Support material | `(support/unit × q) × (1 + waste%) × support price/kg ÷ 1000` (support material defaults to the primary) |
| Machine hours | `print minutes/unit × q ÷ 60` |
| Machine rate / h | printer override **or** `purchase ÷ lifetime h` + `watts ÷ 1000 × tariff` + maintenance/h + consumables/h; missing components are **warned** and excluded; no printer or no data at all → default machine rate **with a warning** |
| Setup labor | `setup minutes/batch × B ÷ 60 × labor cost/h` |
| Post-processing labor | `post minutes/unit × q ÷ 60 × labor cost/h` |
| Extras | `extra cost/unit × q` (inserts, magnets, paint…) |
| Failure allowance | `(material + support + machine) × failure%` |
| Contingency | `subtotal × contingency%` |
| **Production cost** | sum, **rounded to 0.01** |

Suggested unit price = policy(`production cost ÷ q`), noise below 1e-6 removed, then rounded to the
commercial step (e.g. ₪1) — `UP` (default, protects margin) or `NEAREST` — then to 0.01.
A **manual unit price** replaces it only with a recorded reason (≥ 3 chars); below-cost overrides warn.

## Services (one-time per line — never multiplied by quantity)

- Modeling: `HOURLY` → `hours × modeling rate`; `FIXED` → fixed fee. Internal cost = hours × labor cost
  (warning if hours unknown for a fixed fee). **Waived** when re-ordering an existing design.
- Scanning: `scan h × scanning rate + cleanup h × cleanup rate + reverse-engineering h × RE rate`.
  Internal cost = all hours × labor cost + scan hours × scanner cost/h.
- Service billing rates are customer prices (no markup applied); production is priced by policy.

## Line → order totals (explicit order of operations)

1. `line gross = unit price × q + service fees`
2. Line discount (percent of gross, or amount capped at gross) → **rounded 0.01** → `line net`
3. `items net = Σ line net`
4. Order discount (percent of items net, or amount capped) → **rounded 0.01**. Not applied to shipping.
5. Minimum order charge: if `items net − order discount < minimum`, add the difference.
6. `+ shipping charge` → **taxable amount**
7. VAT = `taxable × VAT rate`, **rounded once** on the total (not per line). `EXEMPT` dealer mode or a
   VAT-exempt customer → 0.
8. `total = taxable + VAT`; deposit = `total × deposit%` **rounded 0.01**.
9. Order cost = Σ line cost + shipping cost + packing (physical orders only) + estimated transaction
   fee (`total × fee% + fixed`).
10. Gross profit = taxable − order cost; margin = profit ÷ taxable; markup = profit ÷ cost.

Warnings (never silent): low margin vs policy minimum, below-cost lines/orders, capped discounts,
missing printer cost data, default machine rate, unknown modeling cost.
Errors (line incomplete, totals withheld): missing material/price, non-positive grams or print time,
invalid quantity, service-only quantity ≠ 1, missing modeling/scanning hours, invalid discounts,
override without reason, invalid policy.

## Snapshots

Each quote/order stores `pricingContext` (all rates, policy, VAT captured at pricing time). Each line
stores `pricingInput` (fully resolved: material label & price/kg, printer cost components) and
`pricingResult`. Editing a draft keeps using the snapshot unless the user presses **Re-price with
current rates**, or changes the line's material/printer (which re-resolves that line only).

## Worked example (unit-tested)

4 × part, 42.5 g + 6 g support, purge 3 g/batch, 2 per batch (2 batches), 95 min/unit, PLA ₪80/kg,
printer ₪5000 / 5000 h, 120 W at ₪0.64/kWh, maintenance ₪0.25/h, consumables ₪0.15/h, setup 10 min/batch,
post-processing 5 min/unit at ₪60/h, waste 5%, failure 8%, contingency 3%, markup 100%, step ₪1 up.

| Item | Value |
|---|---|
| Material: (170 + 8.5 + 6) g × 80/kg | 14.76 |
| Support: (24 + 1.2) g × 80/kg | 2.02 (2.016) |
| Machine: 6.3333 h × 1.4768/h | 9.35 |
| Setup 20.00 + post-processing 20.00 | 40.00 |
| Failure 8% of 26.129 | 2.09 |
| Subtotal / contingency 3% | 68.22 / 2.05 |
| **Production cost** | **70.27** |
| Unit cost → ×2 → round up | 17.5675 → 35.135 → **36.00** |
| Line net / profit / margin / markup | 144.00 / 73.73 / 51.20% / 104.92% |
