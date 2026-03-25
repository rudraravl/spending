# Transaction amount sign convention (cash-flow)

All stored amounts use one **canonical** meaning:

| Sign | Meaning |
|------|---------|
| **Positive** | Money **in** to the user (income, refunds, interest, deposits). |
| **Negative** | Money **out** (purchases, fees, withdrawals, card charges). |

## Transfers

Transfers are stored as **two** linked rows (`is_transfer = 1`) with the same magnitude:

- **Source account**: **negative** amount (outflow).
- **Destination account**: **positive** amount (inflow).

Do **not** apply bulk sign flips to transfer rows when migrating or normalizing data.

## Imports

CSV adapters must normalize bank-specific columns so that parsed `amount` values match this convention before insert. See `adapters/generic_adapter.py` and per-bank adapters.

## Aggregations

- **Dashboard total income**: signed sum of amounts allocated to the **Income** category only (split-aware), after excluding transfers and **Payments** subcategory rows. Paychecks and similar should use **Income / Paycheck** (or other Income subcategories). Refunds and other positive credits stay in their spend categories and **do not** count here.
- **Dashboard total spending**: **negative** of the signed sum of amounts for **non-Income** categories (split-aware; uncategorized parents count as non-Income), with the same transfer / Payments exclusions. Refunds in those categories reduce this headline (e.g. −50 then +50 in Groceries nets to **0**). The value is positive when you had net outflows and can be **negative** when refunds exceed purchases in the period.
- **Category rollups** (`summarize_by_category`, etc.): signed sums per category so refunds net within the same category.
