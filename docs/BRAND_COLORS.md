# Keep — brand and UI colors

## Brand

| Token | Hex (default) | Role |
|--------|----------------|------|
| `--brand` | `#3B82F6` at default `217 91% 60%` | Single source for primary actions, links, focus rings, sidebar selection, header bar, first chart series |

**Change the brand everywhere:** edit the **`--brand`** line in [`frontend/src/index.css`](../frontend/src/index.css) under `:root` (three numbers: hue, saturation `%`, lightness `%` — **space-separated, no commas**, e.g. `265 91% 58%`. Commas break the header glow and any `hsl(var(--brand) / opacity)` usage.)

Tailwind: `text-brand`, `bg-brand`, `from-brand/20`, `shadow-brand/40`, etc. (`primary`, `ring`, and `sidebar-primary` all reference `var(--brand)`.)

UI **warnings** use `--warning` (semantic amber), not `--brand`.

## Page defaults (light)

| Role | Hex |
|------|-----|
| Body text (onyx) | `#141519` |
| Page background (bright snow) | `#F7FAF9` |

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
