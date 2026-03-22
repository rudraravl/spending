"""
Semester utility for determining academic semester date ranges.

Semester definitions:
- Spring: Jan 1 – May 31
- Summer: Jun 1 – Aug 15
- Fall: Aug 16 – Dec 31

Auto-detects based on current date.
"""

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
    Determine the current academic semester based on today's date.
    
    Returns:
        Semester enum value
    """
    today = date.today()
    month = today.month
    day = today.day
    
    if 1 <= month <= 5:
        return Semester.SPRING
    elif month == 8 and day >= 16:
        return Semester.FALL
    elif 6 <= month <= 8:
        return Semester.SUMMER
    else:  # September to December
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
        return date(year, 1, 1), date(year, 5, 31)
    elif semester == Semester.SUMMER:
        return date(year, 6, 1), date(year, 8, 15)
    elif semester == Semester.FALL:
        return date(year, 8, 16), date(year, 12, 31)
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
