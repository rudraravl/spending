# Keep — brand and UI colors

## Brand

| Token | Hex (default) | Role |
|--------|----------------|------|
| `--brand` | `#2A6BE0` at default `218 80% 52%` (dark mode: `214 90% 62%`) | Single source for primary actions, links, focus rings, the home spending chart, first chart series |

**Change the brand everywhere:** edit the **`--brand`** line in [`frontend/src/index.css`](../frontend/src/index.css) under `:root` (three numbers: hue, saturation `%`, lightness `%` — **space-separated, no commas**, e.g. `265 91% 58%`. Commas break the header glow and any `hsl(var(--brand) / opacity)` usage.)

Tailwind: `text-brand`, `bg-brand`, `from-brand/20`, etc. (`primary` and `ring` reference `var(--brand)`.)

UI **warnings** use `--warning` (semantic amber), not `--brand`.

## Page defaults (light)

| Role | Hex |
|------|-----|
| Body text | `#141821` |
| Page background | `#F6F7F9` |
| Cards | `#FFFFFF` with a hairline border and `shadow-card` |

## Money values (standardized)

Signed amounts: **positive** = inflow, **negative** = outflow (see [AMOUNT_CONVENTION.md](./AMOUNT_CONVENTION.md)).

| Semantic | Light mode hex | Tailwind / CSS |
|----------|----------------|------------------|
| **Income / positive** | `#059669` | `text-income`, `hsl(var(--income))`, `--money-income` |
| **Expense / negative** | `#DC2626` | `text-expense`, `hsl(var(--expense))`, `--money-expense` |

**Dark mode** (higher luminance for contrast on dark surfaces):

| Semantic | Approx. hex |
|----------|-------------|
| Income | `#34D399` |
| Expense | `#F87171` |

Destructive UI (errors, delete) uses the same red family as `--expense` in light mode for a coherent “negative / danger” read.

## Category colors

Categories use the validated categorical palette in `--cat-1` … `--cat-8` (light and dark steps in
`index.css`). `lib/categoryStyle.ts` maps a category **id** to a slot, so a category keeps its color
regardless of rank or filters. Don't reuse these for status (income/expense/warning).

## Layout primitives

- `.page` — standard page frame (max width, gutters, vertical padding). Every routed page uses it.
- `.surface` — card surface (rounded-2xl, hairline border, soft shadow).
- `.eyebrow` — small uppercase section label.
- `PageHeader` component — page title, one-line description, right-aligned actions.
