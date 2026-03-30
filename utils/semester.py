"""
Semester utility for determining academic semester date ranges.

Semester definitions:
- Spring: Jan 12 – May 9
- Summer: Jun 1 – Aug 15
- Fall: Aug 24 – Dec 14

Auto-detects based on current date.
"""

from calendar import monthrange
from datetime import date, timedelta
from typing import Tuple
from enum import Enum


class Semester(Enum):
    """Academic semester enum."""
    SPRING = 'spring'
    SUMMER = 'summer'
    FALL = 'fall'


def get_current_semester() -> Semester:
    """
    Determine the current academic semester based on today's date
    using exact semester date boundaries:
    - Spring: Jan 12 – May 9
    - Summer: Jun 1 – Aug 15
    - Fall: Aug 24 – Dec 14

    Returns:
        Semester enum value
    """
    today = date.today()
    year = today.year

    spring_start = date(year, 1, 12)
    spring_end = date(year, 5, 9)
    summer_start = date(year, 6, 1)
    summer_end = date(year, 8, 15)
    fall_start = date(year, 8, 24)
    fall_end = date(year, 12, 14)

    if spring_start <= today <= spring_end:
        return Semester.SPRING
    elif summer_start <= today <= summer_end:
        return Semester.SUMMER
    elif fall_start <= today <= fall_end:
        return Semester.FALL
    else:
        # Handle edge periods outside semester ranges:
        # Before Jan 12 → previous year's Fall
        # Between May 10 – May 31 → Spring (just ended, or summer break, handle as Spring)
        # Between Aug 16 – Aug 23 → Summer just ended, treat as Summer
        # After Dec 14 → current year's Fall

        if today < spring_start:
            return Semester.FALL  # Assign to previous Fall
        elif spring_end < today < summer_start:
            return Semester.SPRING
        elif summer_end < today < fall_start:
            return Semester.SUMMER
        elif today > fall_end:
            return Semester.FALL
        else:
            # Unexpected date, but default to Fall
            return Semester.FALL


def get_semester_range(
    semester: Semester,
    year: int,
) -> Tuple[date, date]:
    """
    Get start and end date for a given semester and year.
    
    Args:
        semester: Semester enum value
        year: Year
        
    Returns:
        Tuple of (start_date, end_date)
    """
    if semester == Semester.SPRING:
        return date(year, 1, 12), date(year, 5, 9)
    elif semester == Semester.SUMMER:
        return date(year, 6, 1), date(year, 8, 15)
    elif semester == Semester.FALL:
        return date(year, 8, 24), date(year, 12, 14)
    else:
        raise ValueError(f"Unknown semester: {semester}")


def get_current_semester_range() -> Tuple[date, date]:
    """
    Get start and end date for the current academic semester.
    
    Returns:
        Tuple of (start_date, end_date)
    """
    today = date.today()
    current_semester = get_current_semester()
    
    # For spring, use current year
    # For summer and fall, use current year
    year = today.year
    
    return get_semester_range(current_semester, year)


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
