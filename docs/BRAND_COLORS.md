# Keep — brand and UI colors

## Brand (use sparingly)

| Token | Hex | Role |
|--------|-----|------|
| Azure blue | `#3B82F6` | Primary actions, links, focus rings, sidebar logo key |
| Golden orange | `#F59E0B` | Accent highlights, sidebar ring token, warnings |

CSS: `--brand-azure`, `--brand-golden` in [`frontend/src/index.css`](../frontend/src/index.css). Tailwind: `text-brand-azure`, `bg-brand-golden`, etc.

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
