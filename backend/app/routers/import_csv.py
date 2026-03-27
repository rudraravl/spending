from __future__ import annotations

import os
import tempfile
import csv
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.app.deps import get_db_session
from backend.app.schemas import CsvImportResult, CsvInferredDateRange, CsvPreviewResponse
from backend.app.transfer_helpers import transfer_pair_to_candidate_out
from services.import_service import get_available_adapters, import_csv, preview_csv
from services.transfer_matching_service import find_transfer_match_candidates


router = APIRouter(tags=["import"])


def _read_csv_for_preview(file_path: str) -> pd.DataFrame:
    """
    Read CSV defensively for UI preview.
    Some bank exports include ragged trailing commas on data rows, which can
    misalign columns under strict parsing.
    """
    with open(file_path, newline="", encoding="utf-8-sig") as csv_file:
        reader = csv.reader(csv_file)
        header = next(reader, [])
        header = [str(col).strip() for col in header]
        if len(header) == 0:
            return pd.DataFrame()

        rows: list[list[str]] = []
        for row in reader:
            if len(row) < len(header):
                row = row + [""] * (len(header) - len(row))
            elif len(row) > len(header):
                row = row[: len(header)]
            rows.append(row)

    return pd.DataFrame(rows, columns=header)


def _jsonify_df_value(value: Any) -> object:
    # Pandas uses numpy scalars; JSON encoders often don't like those.
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass

    if isinstance(value, (int, float, str, bool)):
        return value

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass

    return str(value)


def _rows_to_preview_records(df: pd.DataFrame, limit: int) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for row in df.head(limit).to_dict(orient="records"):
        records.append({k: _jsonify_df_value(v) for k, v in row.items()})
    return records


async def _save_upload_to_temp_csv(upload: UploadFile) -> str:
    fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    contents = await upload.read()
    with open(temp_path, "wb") as f:
        f.write(contents)
    return temp_path


@router.get("/api/import/adapters", response_model=list[str])
def list_adapters() -> list[str]:
    return get_available_adapters()


@router.post(
    "/api/import/preview",
    response_model=CsvPreviewResponse,
    status_code=status.HTTP_200_OK,
)
async def preview_import_csv(
    file: UploadFile = File(...),
    adapter_name: str = Form(...),
    # Optional, only needed when the UI wants to validate mapping early.
    date_col: str | None = Form(default=None),
    amount_col: str | None = Form(default=None),
    merchant_col: str | None = Form(default=None),
) -> CsvPreviewResponse:
    """
    Return raw CSV preview + inferred date range.

    Note: We don't rely on adapter parsing for the date-range inference;
    inference runs directly on raw CSV columns.
    """

    temp_path = await _save_upload_to_temp_csv(file)
    try:
        try:
            preview_df = _read_csv_for_preview(temp_path)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"CSV parse error: {e}") from e

        total_entries = len(preview_df)
        columns = [str(c) for c in preview_df.columns]

        parsed_dates = None
        date_candidates = [col for col in preview_df.columns if "date" in str(col).lower()]
        for col in date_candidates:
            # Avoid per-element dateutil fallback + UserWarning; bank CSVs mix 2- and 4-digit years.
            candidate_dates = pd.to_datetime(preview_df[col], errors="coerce", format="mixed")
            if candidate_dates.notna().any():
                parsed_dates = candidate_dates
                break

        inferred = None
        if parsed_dates is not None:
            min_date = parsed_dates.min().date()
            max_date = parsed_dates.max().date()
            inferred = CsvInferredDateRange(min_date=min_date, max_date=max_date)

        preview_rows = _rows_to_preview_records(preview_df, limit=20)

        # Optional: validate Generic mapping existence early (doesn't affect response).
        # Validate Generic mapping only if all mapping fields were provided.
        if adapter_name == "Generic" and date_col and amount_col and merchant_col:
            _ = preview_csv(
                temp_path,
                adapter_name,
                date_col=date_col,
                amount_col=amount_col,
                merchant_col=merchant_col,
            )

        return CsvPreviewResponse(
            rows_detected=total_entries,
            raw_columns=columns,
            preview_rows=preview_rows,
            inferred_date_range=inferred,
        )
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


@router.post(
    "/api/import/csv",
    response_model=CsvImportResult,
    status_code=status.HTTP_200_OK,
)
async def import_csv_endpoint(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    adapter_name: str = Form(...),
    # Generic adapter mapping
    date_col: str | None = Form(default=None),
    amount_col: str | None = Form(default=None),
    merchant_col: str | None = Form(default=None),
    session: Session = Depends(get_db_session),
) -> CsvImportResult:
    temp_path = await _save_upload_to_temp_csv(file)
    try:
        kwargs: dict[str, Any] = {}
        if adapter_name == "Generic":
            kwargs = {
                "date_col": date_col,
                "amount_col": amount_col,
                "merchant_col": merchant_col,
            }
            if not all([date_col, amount_col, merchant_col]):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Generic adapter requires date_col, amount_col, merchant_col",
                )

        try:
            outcome = import_csv(
                session,
                temp_path,
                account_id,
                adapter_name,
                **kwargs,
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

        candidates = (
            find_transfer_match_candidates(
                session,
                seed_transaction_ids=outcome.imported_transaction_ids,
            )
            if outcome.imported_transaction_ids
            else []
        )
        return CsvImportResult(
            num_imported=outcome.num_imported,
            skipped=outcome.skipped,
            imported_transaction_ids=outcome.imported_transaction_ids,
            transfer_match_candidates=[
                transfer_pair_to_candidate_out(session, p) for p in candidates
            ],
        )
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

