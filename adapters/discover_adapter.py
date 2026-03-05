"""
Discover Adapter - Parser for Discover card CSV exports.

Expects columns: Trans. Date, Amount, Description
Discover format: Charges are positive, payments/credits are negative.
This matches our convention, so no transformation needed.
"""

from adapters.generic_adapter import GenericAdapter


class DiscoverAdapter(GenericAdapter):
    """Discover card statement adapter."""
    
    def __init__(self):
        # Discover exports currently use two-digit years like "1/1/26",
        # so we parse with %y instead of %Y to avoid dropping all rows.
        super().__init__(
            date_col='Trans. Date',
            amount_col='Amount',
            merchant_col='Description',
            date_format='%m/%d/%y',
            has_header=True,
            auto_category='Category',
        )
