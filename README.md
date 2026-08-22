# Coffee Atlas

**[sungurerdim.github.io/kahve-atlasi](https://sungurerdim.github.io/kahve-atlasi/)**

Every drink you order at a café — 41 of them — with its exact coffee, milk and water ratio,
dose, ideal roast and the right cup, plus a step-by-step brew guide. For baristas and coffee
lovers. English and Turkish.

The whole thing is one `index.html`. No build step, no package manager, no dependencies, and no
external origin: the page loads nothing from anyone else's server, so visiting it tells no third
party that you did.

## What's in it

| Category | Drinks |
|---|---|
| Espresso-based | 16 — ristretto through vienna |
| Cold coffees | 6 — cold brew, freddo espresso, nitro, dalgona and the iced builds |
| Filter & manual | 6 — V60, Chemex, French press, AeroPress, moka pot, drip |
| Cezve-brewed | 4 — Turkish, Bosnian, Greek, Cypriot |
| Regional coffee cultures | 9 — from café de olla to cà phê trứng |

Each card draws the drink layer by layer in its own vessel, and opens into dose, ratio, roast,
grind, temperature, time, cup and a full procedure.

## How it is built

Everything renders from a single bilingual source of truth inside the page. Each drink is one
record; there is no separate translation file to drift out of sync.

Brew steps are **not** stored per drink. They are generated per method by the functions in the
`steps*` family and routed through the `STEP_ROUTES` table, so a drink's procedure always reflects
its own dose, grind, temperature and volumes rather than a copy that can go stale.

## Accuracy

Ratios and procedures are checked against the recognised standard for each drink — SCA figures
where a measurable standard exists (Golden Cup 55 g/L ±10%, espresso 1:2), and the authoritative
traditional method where the drink is culturally defined. Espresso records carry two figures on
purpose: the traditional cup volume, and the gravimetric brew ratio by weight.

Where sources genuinely disagree, the divergence is recorded rather than silently resolved.

## Running the checks

```sh
bash scripts/quality.sh
```

Two gates, both dependency-free — they use only `python3` and `node`:

- **`scripts/check-html.py`** — document skeleton, encoding, root language, share metadata,
  self-containment (no external origin), and a secret scan.
- **`scripts/check-data.mjs`** — evaluates the page's own script in an isolated context and asserts
  the dataset's invariants: required fields, complete `{tr, en}` pairs, unique ids, an inventory
  floor, every layer key having a colour and a label, every vessel being nameable, in-page nav
  resolving to real sections, ratio labels matching their own numbers, and every drink rendering a
  usable procedure in both languages with nothing like `undefined` leaking into the copy.

A formatter and a type checker are deliberately absent: adding either would mean adding a package
manager, which would cost the buildless architecture more than it is worth. The gate says so rather
than pretending those checks pass.

## Adding a drink

1. Add the record to the right category's `drinks` array. Copy the shape of a neighbour; the gate
   will tell you precisely what is missing.
2. If it needs a procedure of its own, write a `steps*` function and register it in `STEP_ROUTES`.
   Skip this only if it is a straightforward espresso build — invariant I6 will stop anything else
   from quietly inheriting espresso instructions.
3. Raise `MIN_DRINKS` in `scripts/check-data.mjs`.
4. Run `bash scripts/quality.sh`.

Cite a source for any ratio or procedure you add.

## Licence

See [LICENSE](LICENSE).
