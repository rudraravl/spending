"""Calendar date-range helpers used by report and dashboard endpoints."""

from calendar import monthrange
from datetime import date, timedelta
from typing import Tuple


def get_current_month_range() -> Tuple[date, date]:
    """
    Get start and end date for the current month.
    
    Returns:
        Tuple of (start_date, end_date)
    """
    today = date.today()
    start = date(today.year, today.month, 1)
    
    # Get last day of month by getting first day of next month and subtracting 1 day
    if today.month == 12:
        next_month_first = date(today.year + 1, 1, 1)
    else:
        next_month_first = date(today.year, today.month + 1, 1)
    
    end = next_month_first - timedelta(days=1)
    
    return start, end


def get_current_year_range() -> Tuple[date, date]:
    """
    Get start and end date for the current year (Jan 1 to today).
    
    Returns:
        Tuple of (start_date, end_date)
    """
    today = date.today()
    return date(today.year, 1, 1), today


def get_last_month_range() -> Tuple[date, date]:
    """
    First and last calendar day of the month before today's month.
    """
    today = date.today()
    first_this_month = date(today.year, today.month, 1)
    end_prev = first_this_month - timedelta(days=1)
    start_prev = date(end_prev.year, end_prev.month, 1)
    return start_prev, end_prev


def shift_calendar_month(year: int, month: int, delta: int) -> Tuple[int, int]:
    """Return (year, month) after moving ``delta`` months (negative allowed)."""
    m = month - 1 + delta
    y = year + m // 12
    m = m % 12 + 1
    return y, m


def get_calendar_month_range(year: int, month: int) -> Tuple[date, date]:
    """
    Inclusive first and last calendar day of the given month.
    """
    start = date(year, month, 1)
    last_day = monthrange(year, month)[1]
    end = date(year, month, last_day)
    return start, end
