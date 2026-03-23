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

- **Gross spending** (dashboard-style): sum of **outflow magnitudes** — typically `sum(-amount)` over rows with `amount < 0` (excluding transfers and payment subcategories as defined in code).
- **Total income**: sum of **inflows** — `sum(amount)` where `amount > 0`.
