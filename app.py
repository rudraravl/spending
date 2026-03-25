"""
Spending - MVP
Local-only spending tracker with CSV import, manual entry, and summaries.
"""

import streamlit as st
import pandas as pd
import plotly.express as px
import os
import shutil
import tempfile
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session

from db.database import init_db, get_session, close_session, SCHEMA_VERSION, DB_PATH
from db.models import Account, Category, Subcategory, Tag, Transaction
from services.trasaction_service import (
    create_transaction,
    update_transaction,
    assign_tags,
    get_transactions,
    get_transaction_by_id,
    delete_transaction,
    count_transactions,
    set_transaction_splits,
)
from services.summary_service import (
    PAYMENT_SUBCATEGORY_NAMES,
    calculate_total,
    calculate_net_spending_excluding_income,
    net_spending_daily_series,
    summarize_by_tag,
    summarize_by_category,
    summarize_by_subcategory,
    export_transactions,
)
from services.import_service import (
    import_csv,
    get_available_adapters,
    ensure_account,
    ensure_category,
    ensure_subcategory,
    ensure_tag,
)
from services.rule_service import (
    ALLOWED_FIELDS,
    ALLOWED_OPERATORS,
    create_rule,
    delete_rule,
    list_rules,
    update_rule,
)
from utils.filters import TransactionFilter
from utils.semester import (
    get_current_semester_range,
    get_current_month_range,
    get_current_year_range,
)
from ui.theme import inject_global_styles, render_page_header, card, section, pill


# === PAGE CONFIG & THEME ===
st.set_page_config(
    page_title="Spending",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded",
)
inject_global_styles()

# === INITIALIZE DATABASE ===
# Backup DB at most once per day when the app script is run (e.g. via `streamlit run app.py`).
if os.path.exists(DB_PATH):
    db_dir = os.path.dirname(DB_PATH)
    today_prefix = f"db_backup_{date.today().isoformat()}_"
    has_today_backup = any(
        name.startswith(today_prefix) and name.endswith(".db")
        for name in os.listdir(db_dir)
    )
    if not has_today_backup:
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        backup_name = f"db_backup_{timestamp}.db"
        backup_path = os.path.join(db_dir, backup_name)
        try:
            shutil.copy2(DB_PATH, backup_path)
        except OSError:
            # Non-fatal; continue without blocking the app
            pass
        else:
            # Cleanup: keep at most 5 backups, delete oldest when above limit
            backups = []
            for name in os.listdir(db_dir):
                if name.startswith("db_backup_") and name.endswith(".db"):
                    path = os.path.join(db_dir, name)
                    if os.path.isfile(path):
                        backups.append(path)

            if len(backups) > 5:
                backups.sort(key=lambda p: os.path.getmtime(p))
                for path in backups[:-5]:
                    try:
                        os.remove(path)
                    except OSError:
                        # Best-effort cleanup; ignore failures
                        pass

if st.session_state.get("db_schema_version") != SCHEMA_VERSION:
    init_db()
    st.session_state.db_schema_version = SCHEMA_VERSION


# === SIDEBAR NAVIGATION ===
with st.sidebar:
    st.markdown(
        '<div class="sp-sidebar-app-title">💰 SPENDING</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="sp-sidebar-app-subtitle">Local-first budget tracking for your semester.</div>',
        unsafe_allow_html=True,
    )

    all_pages = [
        "Dashboard",
        "Import CSV",
        "Add Transaction",
        "Transfer",
        "All Transactions",
        "Views",
        "Summaries",
    ]

    st.markdown(
        '<div class="sp-sidebar-section-label">Navigation</div>',
        unsafe_allow_html=True,
    )
    page = st.radio(
        "Navigation",
        all_pages,
        index=all_pages.index(st.session_state.get("page", "Dashboard"))
        if "page" in st.session_state
        else 0,
        label_visibility="collapsed",
        key="page",
    )

    st.markdown(
        '<div class="sp-sidebar-section-label">Admin</div>',
        unsafe_allow_html=True,
    )
    settings_selected = st.checkbox("Settings", value=(page == "Settings"))
    if settings_selected:
        page = "Settings"

    sidebar_help = {
        "Dashboard": "High-level overview of your spending and the most recent activity.",
        "Import CSV": "Bring in new transactions from your bank or card statements.",
        "Add Transaction": "Quickly record a manual transaction with category and tags.",
        "Transfer": "Move money between accounts without affecting spending totals.",
        "All Transactions": "Edit, correct, or delete any transaction in your history.",
        "Views": "Explore spending using flexible filters and rich charts.",
        "Summaries": "See fast summaries for this month, year, or semester.",
        "Settings": "Manage accounts, categories, subcategories, and tags.",
    }.get(page, "")

    if sidebar_help:
        st.markdown(
            f'<div class="sp-sidebar-help">{sidebar_help}</div>',
            unsafe_allow_html=True,
        )


# === HELPER FUNCTIONS ===
def refresh_session():
    """Refresh the session state."""
    if "session" in st.session_state:
        close_session(st.session_state.session)
    st.session_state.session = get_session()


def get_db_session() -> Session:
    """Get or create database session."""
    if "session" not in st.session_state:
        st.session_state.session = get_session()
    return st.session_state.session


def get_all_accounts(session: Session):
    """Get all accounts from database."""
    return session.query(Account).all()


def get_all_categories(session: Session):
    """Get all categories from database."""
    return session.query(Category).all()


def get_all_tags(session: Session):
    """Get all tags from database."""
    return session.query(Tag).all()


def get_subcategories_by_category(session: Session, category_id: int):
    """Get all subcategories for a given category."""
    return session.query(Subcategory).filter(Subcategory.category_id == category_id).all()


def _pie_from_summary(df: pd.DataFrame, names_col: str, title: str):
    """Build a Plotly pie chart from a summary DataFrame with 'total' and a label column."""
    if df is None or df.empty or names_col not in df.columns or "total" not in df.columns:
        return None
    fig = px.pie(df, values="total", names=names_col, title=title)
    fig.update_layout(margin=dict(t=40, b=20, l=20, r=20), height=320)
    return fig


def _render_summary_tab(session, filters, export_key: str):
    """Render one summary tab: total metric, then By Tag / By Category / By Subcategory stacked, each with table + pie."""
    total = calculate_total(session, filters)
    st.metric("Total Spend", f"${total:.2f}")
    st.divider()

    # --- By Tag (stacked row: table | pie) ---
    st.subheader("By Tag")
    tag_summary = summarize_by_tag(session, filters)
    col_table, col_chart = st.columns([1, 1])
    with col_table:
        if not tag_summary.empty:
            st.dataframe(tag_summary, use_container_width=True)
        else:
            st.info("No tagged transactions.")
    with col_chart:
        if not tag_summary.empty:
            fig = _pie_from_summary(tag_summary, "tag", "Spend by Tag")
            if fig:
                st.plotly_chart(fig, use_container_width=True, key=f"{export_key}_pie_tag")
    st.divider()

    # --- By Category (stacked row: table | pie) ---
    st.subheader("By Category")
    category_summary = summarize_by_category(session, filters)
    col_table, col_chart = st.columns([1, 1])
    with col_table:
        if not category_summary.empty:
            st.dataframe(category_summary, use_container_width=True)
        else:
            st.info("No categorized transactions.")
    with col_chart:
        if not category_summary.empty:
            fig = _pie_from_summary(category_summary, "category", "Spend by Category")
            if fig:
                st.plotly_chart(fig, use_container_width=True, key=f"{export_key}_pie_category")
    st.divider()

    # --- By Subcategory (stacked row: table | pie) ---
    st.subheader("By Subcategory")
    subcategory_summary = summarize_by_subcategory(session, filters)
    col_table, col_chart = st.columns([1, 1])
    with col_table:
        if not subcategory_summary.empty:
            st.dataframe(subcategory_summary, use_container_width=True)
        else:
            st.info("No subcategorized transactions.")
    with col_chart:
        if not subcategory_summary.empty:
            fig = _pie_from_summary(subcategory_summary, "subcategory", "Spend by Subcategory")
            if fig:
                st.plotly_chart(fig, use_container_width=True, key=f"{export_key}_pie_subcategory")


# === PAGE: DASHBOARD ===
if page == "Dashboard":
    render_page_header(
        "💰",
        "Budget Dashboard",
        "See a quick snapshot of your totals and the latest activity.",
    )
    
    session = get_db_session()
    
    # Display overall statistics
    with section("Overview", "Key totals across your entire history"):
        col1, col2, col3 = st.columns(3)

        # Net non-Income outflows (all time), cash-flow sign in DB
        total_spend = calculate_net_spending_excluding_income(session)
        col1.metric("Total All-Time Spending", f"${total_spend:.2f}")

        # Current month net non-Income spending
        month_range = get_current_month_range()
        filters = TransactionFilter(start_date=month_range[0], end_date=month_range[1])
        month_spend = calculate_net_spending_excluding_income(session, filters)
        col2.metric("Current Month", f"${month_spend:.2f}")

        # Total transactions
        total_transactions = session.query(Transaction).count()
        col3.metric("Total Transactions", total_transactions)

    # Headline chart: recent daily spend (last 30 days)
    with section("Recent trend", "Spending over the last 30 days"):
        today = date.today()
        start_30 = today - timedelta(days=30)
        trend_filters = TransactionFilter(start_date=start_30, end_date=today)
        trend_txns = get_transactions(session, filters=trend_filters, include_transfers=False)

        spending_pts = net_spending_daily_series(
            trend_txns,
            exclude_subcategory_names=PAYMENT_SUBCATEGORY_NAMES,
        )
        if spending_pts:
            daily_df = pd.DataFrame(spending_pts)
            daily_df["date"] = pd.to_datetime(daily_df["date"])
            fig = px.bar(
                daily_df,
                x="date",
                y="amount",
                title="Daily net non-Income cash flow (last 30 days)",
                labels={"date": "Date", "amount": "Net outflow ($)"},
            )
            fig.update_layout(
                margin=dict(t=40, b=30, l=40, r=20),
                height=260,
            )
            st.plotly_chart(fig, use_container_width=True, key="dashboard_recent_trend")
        else:
            st.info("No non-Income activity in the last 30 days.")

    # Recent transactions
    with section("Recent activity", "Last 10 transactions across all accounts"):
        recent = get_transactions(session, limit=10, include_transfers=False)
        if recent:
            recent_data = []
            for txn in recent:
                recent_data.append({
                    'Date': txn.date,
                    'Merchant': txn.merchant,
                    'Amount': f"${txn.amount:.2f}",
                    'Category': txn.category.name if txn.category else 'None',
                    'Subcategory': txn.subcategory.name if txn.subcategory else 'None',
                    'Tags': ', '.join([t.name for t in txn.tags]) or 'None',
                    'Notes': txn.notes or '',
                    'Acct': txn.account.name,
                })
            st.dataframe(pd.DataFrame(recent_data), use_container_width=True)
        else:
            st.info(
                "No transactions yet. Import a CSV or add a transaction to see activity here."
            )
    
    close_session(session)


# === PAGE: IMPORT CSV ===
elif page == "Import CSV":
    render_page_header(
        "📥",
        "Import CSV",
        "Bring in transactions from your bank or card statements.",
    )
    
    session = get_db_session()

    uploaded_file = None
    adapter_name = None
    date_col = None
    amount_col = None
    merchant_col = None
    account = None

    left_col, right_col = st.columns([1.1, 1.2])

    with left_col:
        with section("Step 1 · Account", "Choose where these transactions should live."):
            accounts = get_all_accounts(session)
            account_names = [a.name for a in accounts]

            if account_names:
                selected_account = st.selectbox("Account", account_names)
                account = next((a for a in accounts if a.name == selected_account), None)
            else:
                st.warning(
                    "No accounts found. Create an account in Settings before importing."
                )

        with section("Step 2 · Format", "Pick the adapter that matches your CSV layout."):
            adapter_name = st.selectbox("CSV format", get_available_adapters())

        with section("Step 3 · File", "Upload your CSV and (optionally) map columns."):
            if adapter_name == "Generic":
                uploaded_file = st.file_uploader("Upload CSV", type="csv")
                if uploaded_file:
                    sample_df = pd.read_csv(uploaded_file)
                    column_names = list(sample_df.columns)

                    date_col = st.selectbox("Date column", column_names, key="date_col")
                    amount_col = st.selectbox(
                        "Amount column", column_names, key="amount_col"
                    )
                    merchant_col = st.selectbox(
                        "Merchant column", column_names, key="merchant_col"
                    )
                    st.caption("Preview of detected columns from your file:")
                    st.dataframe(sample_df.head(8), use_container_width=True)
            else:
                uploaded_file = st.file_uploader("Upload CSV", type="csv")

    with right_col:
        with section("Preview & import", "Inspect your file before committing it."):
            if uploaded_file and account:
                try:
                    uploaded_file.seek(0)
                    preview_df = pd.read_csv(uploaded_file)
                    uploaded_file.seek(0)

                    total_entries = len(preview_df)
                    parsed_dates = None

                    date_candidates = [
                        col
                        for col in preview_df.columns
                        if "date" in str(col).lower()
                    ]

                    for col in date_candidates:
                        candidate_dates = pd.to_datetime(
                            preview_df[col], errors="coerce"
                        )
                        if candidate_dates.notna().any():
                            parsed_dates = candidate_dates
                            break

                    stats_col1, stats_col2 = st.columns(2)
                    with stats_col1:
                        st.metric("Rows detected", total_entries)
                    with stats_col2:
                        st.markdown("**Date range**")
                        if parsed_dates is not None:
                            min_date = parsed_dates.min().date()
                            max_date = parsed_dates.max().date()
                            st.markdown(
                                f"<div style='font-size: 0.9rem;'>{min_date} → {max_date}</div>",
                                unsafe_allow_html=True,
                            )
                        else:
                            st.markdown(
                                "<div style='font-size: 0.9rem;'>Not detected</div>",
                                unsafe_allow_html=True,
                            )

                    st.dataframe(preview_df.head(20), use_container_width=True)

                    st.caption(
                        "Only a small slice is shown here; all rows will be imported."
                    )

                    if st.button("✅ Confirm import"):
                        if adapter_name == "Generic":
                            kwargs = {
                                "date_col": date_col,
                                "amount_col": amount_col,
                                "merchant_col": merchant_col,
                            }
                        else:
                            kwargs = {}

                        temp_path = None
                        try:
                            uploaded_file.seek(0)
                            with tempfile.NamedTemporaryFile(
                                delete=False, suffix=".csv"
                            ) as temp_file:
                                temp_file.write(uploaded_file.getvalue())
                                temp_path = temp_file.name

                            num_imported, skipped = import_csv(
                                session,
                                temp_path,
                                account.id,
                                adapter_name,
                                **kwargs,
                            )
                        finally:
                            if temp_path and os.path.exists(temp_path):
                                os.remove(temp_path)

                        st.success(f"✅ Imported {num_imported} transactions")
                        if skipped:
                            st.warning(
                                f"⚠️ Skipped {len(skipped)} duplicate transactions"
                            )
                except Exception as e:
                    st.error(f"Error parsing CSV: {str(e)}")
            else:
                st.info("Choose an account, format, and file to see a live preview here.")
    
    close_session(session)


# === PAGE: ADD TRANSACTION ===
elif page == "Add Transaction":
    render_page_header(
        "➕",
        "Add transaction",
        "Capture a single purchase or transfer with full context.",
    )
    
    session = get_db_session()

    # Get accounts, categories, and tags
    accounts = get_all_accounts(session)
    categories = get_all_categories(session)
    all_tags = get_all_tags(session)

    if not accounts:
        st.error("Please create an account in Settings first.")
    elif not categories:
        st.error("Please create a category in Settings first.")
    else:
        basic_col, classify_col = st.columns(2)

        with basic_col:
            with section("Basics", "Core details for the transaction."):
                txn_date = st.date_input("Date", value=date.today())
                amount = st.number_input(
                    "Amount",
                    step=0.01,
                    help="Cash-flow: negative = spending/outflow, positive = income/inflow.",
                )
                merchant = st.text_input("Merchant")

        with classify_col:
            with section("Classification", "Where does this belong in your budget?"):
                account = st.selectbox("Account", [a.name for a in accounts])
                account_id = next((a.id for a in accounts if a.name == account), None)

                selected_category_name = st.selectbox(
                    "Category",
                    [c.name for c in categories],
                    help="Every transaction must have a category.",
                )
                category_id = next(
                    (c.id for c in categories if c.name == selected_category_name),
                    None,
                )

                subcategories = (
                    get_subcategories_by_category(session, category_id)
                    if category_id
                    else []
                )
                if subcategories:
                    selected_subcategory_name = st.selectbox(
                        "Subcategory",
                        [s.name for s in subcategories],
                        help="Subcategories make summaries much more useful.",
                    )
                    subcategory_id = next(
                        (
                            s.id
                            for s in subcategories
                            if s.name == selected_subcategory_name
                        ),
                        None,
                    )
                else:
                    st.warning(
                        f"No subcategories found for '{selected_category_name}'. "
                        "Create at least one in Settings.",
                    )
                    subcategory_id = None

                selected_tags = st.multiselect(
                    "Tags (optional)",
                    [t.name for t in all_tags],
                )
                tag_ids = [t.id for t in all_tags if t.name in selected_tags]

        with section("Notes", "Add any extra context you want to remember."):
            notes = st.text_area("Notes (optional)")

            col_left, col_right = st.columns([3, 1])
            with col_left:
                pill("Required: category & subcategory", muted=True)
            with col_right:
                if st.button("Save transaction", type="primary"):
                    if not subcategory_id:
                        st.error(
                            "Please select a subcategory before saving this transaction."
                        )
                    else:
                        try:
                            create_transaction(
                                session,
                                txn_date,
                                amount,
                                merchant,
                                account_id,
                                category_id,
                                subcategory_id,
                                notes if notes else None,
                                tag_ids if tag_ids else None,
                            )
                            st.success("✅ Transaction added!")
                            st.rerun()
                        except Exception as e:
                            st.error(f"Error: {str(e)}")
    
    close_session(session)


# === PAGE: TRANSFER ===
elif page == "Transfer":
    render_page_header(
        "🔁",
        "Transfer between accounts",
        "Move money between accounts without affecting your spending totals.",
    )

    session = get_db_session()

    accounts = get_all_accounts(session)
    if len(accounts) < 2:
        st.info("You need at least two accounts to record a transfer.")
        close_session(session)
    else:
        with section("Transfer details", "Create a linked pair of transactions."):
            col1, col2 = st.columns(2)
            with col1:
                from_account_name = st.selectbox(
                    "From account",
                    [a.name for a in accounts],
                    key="transfer_from",
                )
            with col2:
                to_account_name = st.selectbox(
                    "To account",
                    [a.name for a in accounts],
                    key="transfer_to",
                )

            amount = st.number_input("Amount", min_value=0.01, step=0.01)
            transfer_date = st.date_input("Date", value=date.today())
            notes = st.text_area("Notes (optional)")

            from_account_id = next(
                (a.id for a in accounts if a.name == from_account_name), None
            )
            to_account_id = next(
                (a.id for a in accounts if a.name == to_account_name), None
            )

            if st.button("Save transfer", type="primary"):
                try:
                    if from_account_id == to_account_id:
                        st.error("From and To accounts must be different.")
                    else:
                        from services.trasaction_service import create_transfer

                        create_transfer(
                            session,
                            from_account_id=from_account_id,
                            to_account_id=to_account_id,
                            amount=amount,
                            date_=transfer_date,
                            notes=notes or None,
                        )
                        st.success("✅ Transfer recorded!")
                        st.rerun()
                except Exception as e:
                    st.error(f"Error creating transfer: {e}")

        close_session(session)


# === PAGE: ALL TRANSACTIONS ===
elif page == "All Transactions":
    render_page_header(
        "📋",
        "All transactions",
        "Search, edit, and clean up any transaction in your history.",
    )

    session = get_db_session()
    all_tags = get_all_tags(session)
    all_categories = get_all_categories(session)
    all_accounts = get_all_accounts(session)

    tag_name_to_id = {tag.name: tag.id for tag in all_tags}
    category_name_to_id = {cat.name: cat.id for cat in all_categories}
    category_id_to_subcategories = {
        cat.id: get_subcategories_by_category(session, cat.id)
        for cat in all_categories
    }
    category_names = sorted([c.name for c in all_categories])
    subcategory_names = sorted(
        {s.name for cat in all_categories for s in category_id_to_subcategories[cat.id]}
    )
    tag_names = sorted(tag_name_to_id.keys())
    account_name_to_id = {acct.name: acct.id for acct in all_accounts}
    account_names = sorted(account_name_to_id.keys())

    def _normalize_tag_list(value):
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        if isinstance(value, str):
            return [v.strip() for v in value.split(',') if v.strip()]
        return []

    # Show flash message from a previous save/delete action
    if "_all_txn_flash" in st.session_state:
        msg, level = st.session_state.pop("_all_txn_flash")
        (st.success if level == "success" else st.error)(msg)

    # Filters 
    st.subheader("Filters")
    st.caption("Narrow down the grid to the rows you care about.")

    f_col1, f_col2, f_col3, f_col4 = st.columns(4)
    with f_col1:
        search_text = st.text_input(
            "Merchant / notes search",
            "",
            help="Searches merchant and notes text.",
        )
    with f_col2:
        f_category = st.selectbox(
            "Category (optional)",
            ["All"] + category_names,
        )
    with f_col3:
        f_tag = st.selectbox(
            "Tag (optional)",
            ["All"] + tag_names,
        )
    with f_col4:
        show_only_recent = st.checkbox(
            "Limit to last 90 days",
            value=False,
        )

    # Base query via existing helper and then filter in-memory for UI-only fields
    filters = None
    if show_only_recent:
        end_d = date.today()
        start_d = end_d - timedelta(days=90)
        filters = TransactionFilter(start_date=start_d, end_date=end_d)

    transactions = get_transactions(session, filters=filters)

    if not transactions:
        st.info("No transactions found.")
    else:
        # In-memory filters
        def _matches_ui_filters(txn: Transaction) -> bool:
            if f_category != "All":
                if not txn.category or txn.category.name != f_category:
                    return False
            if f_tag != "All":
                tag_names_txn = {t.name for t in txn.tags} if txn.tags else set()
                if f_tag not in tag_names_txn:
                    return False
            if search_text:
                needle = search_text.lower()
                haystack = " ".join(
                    [
                        (txn.merchant or ""),
                        (txn.notes or ""),
                    ]
                ).lower()
                if needle not in haystack:
                    return False
            return True

        filtered_txns = [t for t in transactions if _matches_ui_filters(t)]

        table_rows = []
        for txn in filtered_txns:
            has_splits = bool(getattr(txn, "splits", None))
            if has_splits:
                category_display = "(split)"
                subcategory_display = "(split)"
            else:
                category_display = txn.category.name if txn.category else ""
                subcategory_display = txn.subcategory.name if txn.subcategory else ""

            table_rows.append(
                {
                    "id": txn.id,
                    "Date": txn.date,
                    "Merchant": txn.merchant,
                    "Amount": float(txn.amount),
                    "Category": category_display,
                    "Subcategory": subcategory_display,
                    "Tags": [t.name for t in txn.tags] if txn.tags else [],
                    "Notes": txn.notes or "",
                    "Acct": txn.account.name if txn.account else "",
                    "Split": "Split" if has_splits else "",
                    "Delete": False,
                }
            )

        table_df = pd.DataFrame(table_rows)
        transaction_map = {txn.id: txn for txn in transactions}

        # Editor 
        st.subheader("Editor")
        st.caption(
            f"{len(filtered_txns)} of {len(transactions)} transactions shown in the grid."
        )

        with st.form("all_txn_edit_form"):
            edited_df = st.data_editor(
                table_df,
                hide_index=True,
                use_container_width=True,
                height=650,
                disabled=["id"],
                column_config={
                    "id": st.column_config.NumberColumn("id", disabled=True),
                    "Date": st.column_config.DateColumn("Date", format="YYYY-MM-DD"),
                    "Merchant": st.column_config.TextColumn(
                        "Merchant", width="small"
                    ),
                    "Amount": st.column_config.NumberColumn(
                        "Amount", format="$%.2f"
                    ),
                    "Category": st.column_config.SelectboxColumn(
                        "Category", options=category_names
                    ),
                    "Subcategory": st.column_config.SelectboxColumn(
                        "Subcategory", options=subcategory_names
                    ),
                    "Acct": st.column_config.SelectboxColumn(
                        "Account", options=account_names
                    ),
                    "Tags": st.column_config.MultiselectColumn(
                        "Tags", options=tag_names
                    ),
                    "Split": st.column_config.TextColumn(
                        "Split",
                        help="Shows 'Split' when this transaction has one or more splits.",
                        disabled=True,
                        width="small",
                    ),
                    "Delete": st.column_config.CheckboxColumn("Delete"),
                },
                key="all_txn_editor",
            )

            btn_col1, btn_col2, btn_col3, btn_col4 = st.columns([2, 1, 1, 1])
            with btn_col3:
                save_submitted = st.form_submit_button(
                    "💾 Save edits", type="primary"
                )
            with btn_col4:
                delete_submitted = st.form_submit_button("🗑️ Delete checked")

        if save_submitted:
            edited_rows = st.session_state.get("all_txn_editor", {}).get(
                "edited_rows", {}
            )
            data_cols = edited_rows and any(
                col != "Delete"
                for changes in edited_rows.values()
                for col in changes
            )

            if not data_cols:
                st.info("No changes detected.")
            else:
                updated_count = 0
                errors = []

                for row_idx, changes in edited_rows.items():
                    row_idx = int(row_idx)
                    txn_id = int(table_df.iloc[row_idx]["id"])
                    txn = transaction_map.get(txn_id)
                    if not txn:
                        continue

                    # Skip rows where only the Delete checkbox changed
                    field_changes = {
                        k: v for k, v in changes.items() if k != "Delete"
                    }
                    if not field_changes:
                        continue

                    try:
                        updates = {}

                        if "Date" in field_changes:
                            updates["date"] = pd.to_datetime(
                                field_changes["Date"]
                            ).date()

                        if "Amount" in field_changes:
                            updates["amount"] = float(field_changes["Amount"])

                        if "Merchant" in field_changes:
                            updates["merchant"] = str(
                                field_changes["Merchant"]
                            ).strip()

                        if "Notes" in field_changes:
                            raw = str(field_changes["Notes"]).strip()
                            updates["notes"] = raw if raw else None

                        if "Acct" in field_changes:
                            acct_name = str(field_changes["Acct"]).strip()
                            if not acct_name:
                                errors.append(
                                    f"Row {txn_id}: Account is required."
                                )
                                continue
                            acct_id = account_name_to_id.get(acct_name)
                            if not acct_id:
                                errors.append(
                                    f"Row {txn_id}: Unknown account '{acct_name}'."
                                )
                                continue
                            updates["account_id"] = acct_id

                        if (
                            "Category" in field_changes
                            or "Subcategory" in field_changes
                        ):
                            cat_name = field_changes.get(
                                "Category",
                                txn.category.name if txn.category else "",
                            )
                            subcat_name = field_changes.get(
                                "Subcategory",
                                txn.subcategory.name if txn.subcategory else "",
                            )

                            if not cat_name:
                                errors.append(
                                    f"Row {txn_id}: Category is required."
                                )
                                continue
                            cat_id = category_name_to_id.get(cat_name)
                            if not cat_id:
                                errors.append(
                                    f"Row {txn_id}: Unknown category '{cat_name}'."
                                )
                                continue
                            if not subcat_name:
                                errors.append(
                                    f"Row {txn_id}: Subcategory is required."
                                )
                                continue
                            subcats = category_id_to_subcategories.get(cat_id, [])
                            match = next(
                                (s for s in subcats if s.name == subcat_name),
                                None,
                            )
                            if not match:
                                avail = ", ".join(s.name for s in subcats)
                                errors.append(
                                    f"Row {txn_id}: Subcategory '{subcat_name}' invalid "
                                    f"for category '{cat_name}'. Available: {avail}"
                                )
                                continue
                            updates["category_id"] = cat_id
                            updates["subcategory_id"] = match.id

                        if "Tags" in field_changes:
                            selected_tags = _normalize_tag_list(
                                field_changes["Tags"]
                            )
                            unknown = [
                                t for t in selected_tags if t not in tag_name_to_id
                            ]
                            if unknown:
                                errors.append(
                                    f"Row {txn_id}: Unknown tags: {', '.join(unknown)}"
                                )
                                continue
                            new_tag_ids = [
                                tag_name_to_id[t] for t in selected_tags
                            ]
                            updates["tags"] = (
                                session.query(Tag)
                                .filter(Tag.id.in_(new_tag_ids))
                                .all()
                                if new_tag_ids
                                else []
                            )

                        for attr, val in updates.items():
                            setattr(txn, attr, val)
                        updated_count += 1

                    except Exception as e:
                        errors.append(f"Row {txn_id}: {str(e)}")

                if errors:
                    st.error(
                        "Some rows could not be saved. See details below."
                    )
                    for err in errors:
                        st.write(f"- {err}")

                if updated_count > 0:
                    try:
                        session.commit()
                        st.session_state["_all_txn_flash"] = (
                            f"✅ Saved {updated_count} change(s)",
                            "success",
                        )
                        st.rerun()
                    except Exception as e:
                        session.rollback()
                        st.error(f"Failed to commit: {e}")

        if delete_submitted:
            delete_ids = [
                int(row["id"])
                for _, row in edited_df.iterrows()
                if pd.notna(row["Delete"]) and bool(row["Delete"])
            ]
            if delete_ids:
                deleted = 0
                for tid in delete_ids:
                    try:
                        delete_transaction(session, tid)
                        deleted += 1
                    except Exception as e:
                        st.error(f"Error deleting transaction {tid}: {e}")
                if deleted > 0:
                    st.session_state["_all_txn_flash"] = (
                        f"✅ Deleted {deleted} row(s)",
                        "success",
                    )
                    st.rerun()
            else:
                st.info("No rows checked for deletion.")

        # --- Split editor ---
        st.subheader("Splits")
        st.caption(
            "Edit category splits for a single transaction. "
            "Enter an ID from the grid above."
        )

        split_txn_id = st.number_input(
            "Transaction ID to edit splits",
            min_value=1,
            step=1,
            format="%d",
        )

        if split_txn_id:
            txn = get_transaction_by_id(session, int(split_txn_id))
            if not txn:
                st.info("No transaction found with that ID.")
            else:
                st.write(
                    f"Parent transaction: {txn.date} · {txn.merchant} · ${float(txn.amount):.2f}"
                )

                # Load existing splits
                existing_splits = list(txn.splits or [])
                split_rows = [
                    {
                        "Category": s.category.name if hasattr(s, "category") and s.category else "",
                        "Subcategory": s.subcategory.name if s.subcategory else "",
                        "Amount": float(s.amount),
                        "Notes": s.notes or "",
                    }
                    for s in existing_splits
                ]
                if not split_rows:
                    split_rows = [
                        {"Category": "", "Subcategory": "", "Amount": 0.0, "Notes": ""}
                    ]

                split_df = pd.DataFrame(split_rows)
                edited_split_df = st.data_editor(
                    split_df,
                    num_rows="dynamic",
                    use_container_width=True,
                    key="split_editor",
                    column_config={
                        "Category": st.column_config.SelectboxColumn(
                            "Category",
                            options=category_names,
                        ),
                        "Subcategory": st.column_config.SelectboxColumn(
                            "Subcategory",
                            options=subcategory_names,
                        ),
                        "Amount": st.column_config.NumberColumn(
                            "Amount",
                            format="$%.2f",
                        ),
                        "Notes": st.column_config.TextColumn("Notes"),
                    },
                )

                if st.button("Save splits"):
                    try:
                        categories = get_all_categories(session)
                        category_by_name = {c.name: c for c in categories}

                        splits_payload = []
                        for _, row in edited_split_df.iterrows():
                            cat_name = str(row["Category"]).strip()
                            subcat_name = str(row["Subcategory"]).strip()
                            amount = float(row["Amount"])
                            notes = str(row["Notes"]).strip() or None

                            # Skip empty rows
                            if not cat_name and not subcat_name and amount == 0:
                                continue

                            if cat_name not in category_by_name:
                                raise ValueError(f"Unknown category '{cat_name}'")

                            category = category_by_name[cat_name]
                            subcats = get_subcategories_by_category(session, category.id)
                            subcat = next(
                                (s for s in subcats if s.name == subcat_name),
                                None,
                            )
                            if not subcat:
                                raise ValueError(
                                    f"Subcategory '{subcat_name}' not valid for category '{cat_name}'"
                                )

                            splits_payload.append(
                                {
                                    "category_id": category.id,
                                    "subcategory_id": subcat.id,
                                    "amount": amount,
                                    "notes": notes,
                                }
                            )

                        set_transaction_splits(session, int(split_txn_id), splits_payload)
                        st.session_state["_all_txn_flash"] = (
                            "✅ Splits saved",
                            "success",
                        )
                        st.rerun()
                    except Exception as e:
                        st.error(f"Error saving splits: {e}")

    close_session(session)


# === PAGE: CUSTOM DATE RANGE ===
elif page == "Views":
    render_page_header(
        "🔍",
        "Custom views",
        "Mix and match filters to explore your spending from any angle.",
    )
    
    session = get_db_session()

    # Filters 
    st.subheader("Filters")
    st.caption("Start broad, then refine.")

    preset_col, _, _ = st.columns([1.5, 1, 1])
    with preset_col:
        preset = st.radio(
            "Quick range",
            ["Custom", "Last 7 days", "Last 30 days", "Year to date"],
            index=0,
            horizontal=True,
        )

    col1, col2 = st.columns(2)
    with col1:
        start_date = st.date_input("Start date", value=date(2024, 1, 1))
    with col2:
        end_date = st.date_input("End date")

    if preset != "Custom":
        today = date.today()
        if preset == "Last 7 days":
            start_date = today - timedelta(days=7)
            end_date = today
        elif preset == "Last 30 days":
            start_date = today - timedelta(days=30)
            end_date = today
        elif preset == "Year to date":
            start_date = date(today.year, 1, 1)
            end_date = today

    col1, col2, col3, col4 = st.columns(4)

    with col1:
        accounts = get_all_accounts(session)
        account_names = [a.name for a in accounts]
        selected_account = st.selectbox("Account (optional)", ["All"] + account_names)
        account_id = (
            next((a.id for a in accounts if a.name == selected_account), None)
            if selected_account != "All"
            else None
        )

    with col2:
        categories = get_all_categories(session)
        category_names = [c.name for c in categories]
        selected_category = st.selectbox(
            "Category (optional)", ["All"] + category_names
        )
        category_id = (
            next((c.id for c in categories if c.name == selected_category), None)
            if selected_category != "All"
            else None
        )

    with col3:
        subcategories = (
            get_subcategories_by_category(session, category_id)
            if category_id
            else []
        )
        subcategory_names = [s.name for s in subcategories]
        selected_subcategory = st.selectbox(
            "Subcategory (optional)",
            ["All"] + subcategory_names,
            disabled=not category_id,
        )
        subcategory_id = (
            next(
                (s.id for s in subcategories if s.name == selected_subcategory),
                None,
            )
            if selected_subcategory != "All" and subcategories
            else None
        )

    with col4:
        all_tags = get_all_tags(session)
        tag_names = [t.name for t in all_tags]
        selected_tags = st.multiselect("Tags (optional)", tag_names)
        tag_ids = [t.id for t in all_tags if t.name in selected_tags]
        tags_match_any = st.checkbox(
            "Match any tag (OR)",
            value=False,
            help=(
                "If unchecked (default), transactions must have all selected tags. "
                "If checked, transactions with any of the selected tags are included."
            ),
        )

    col1, col2 = st.columns(2)
    with col1:
        min_amount = st.number_input(
            "Min amount (optional)", value=0.0, step=0.01
        )
    with col2:
        max_amount = st.number_input(
            "Max amount (optional)", value=0.0, step=0.01
        )

    filters = TransactionFilter(
        start_date=start_date,
        end_date=end_date,
        account_id=account_id,
        category_id=category_id,
        subcategory_id=subcategory_id,
        tag_ids=tag_ids if tag_ids else None,
        tags_match_any=tags_match_any,
        min_amount=min_amount if min_amount > 0 else None,
        max_amount=max_amount if max_amount > 0 else None,
    )
    
    # Get transactions (exclude transfers from spend views)
    transactions = get_transactions(session, filters=filters, include_transfers=False)
    
    if not transactions:
        st.info("No transactions found matching filters.")
    else:
        top_col1, top_col2 = st.columns([1.1, 1.4])

        with top_col1:
            with section("Summary", "Totals for the current filter set."):
                total = calculate_total(session, filters)
                st.metric("Total", f"${total:.2f}")
                st.caption(
                    f"Across {len(transactions)} matching transactions "
                    f"from {start_date} to {end_date}."
                )

        with top_col2:
            with section("Spending over time", "Daily totals (excluding payments and rent)."):
                exclude_subcategories = {"payments", "rent"}
                daily_txn_rows = []
                for t in transactions:
                    if (
                        t.subcategory
                        and t.subcategory.name
                        and t.subcategory.name.lower() in exclude_subcategories
                    ):
                        continue
                    raw = float(t.amount)
                    if raw < 0:
                        daily_txn_rows.append({"date": t.date, "amount": -raw})
                if daily_txn_rows:
                    daily_df = (
                        pd.DataFrame(daily_txn_rows)
                        .groupby("date", as_index=False)["amount"]
                        .sum()
                        .sort_values("date")
                    )
                    fig_time = px.bar(
                        daily_df,
                        x="date",
                        y="amount",
                        title="Daily spending",
                        labels={"date": "Date", "amount": "Amount ($)"},
                    )
                    fig_time.update_layout(
                        margin=dict(t=40, b=40, l=40, r=40),
                        height=280,
                        xaxis_tickformat="%b %d",
                    )
                    st.plotly_chart(
                        fig_time,
                        use_container_width=True,
                        key="views_spending_over_time",
                    )
                else:
                    st.info("No non-rent/non-payment spending in this range.")

        tabs = st.tabs(["By tag", "By category", "By subcategory"])

        with tabs[0]:
            with section("By tag"):
                tag_summary = summarize_by_tag(session, filters)
                col_table, col_chart = st.columns([1, 1])
                with col_table:
                    if not tag_summary.empty:
                        st.dataframe(tag_summary, use_container_width=True)
                    else:
                        st.info("No tags assigned to transactions in this range.")
                with col_chart:
                    if not tag_summary.empty:
                        fig = _pie_from_summary(tag_summary, "tag", "Spend by tag")
                        if fig:
                            st.plotly_chart(
                                fig,
                                use_container_width=True,
                                key="views_pie_tag",
                            )

        with tabs[1]:
            with section("By category"):
                category_summary = summarize_by_category(session, filters)
                col_table, col_chart = st.columns([1, 1])
                with col_table:
                    if not category_summary.empty:
                        st.dataframe(category_summary, use_container_width=True)
                    else:
                        st.info("No categories assigned to transactions in this range.")
                with col_chart:
                    if not category_summary.empty:
                        fig = _pie_from_summary(
                            category_summary, "category", "Spend by category"
                        )
                        if fig:
                            st.plotly_chart(
                                fig,
                                use_container_width=True,
                                key="views_pie_category",
                            )

        with tabs[2]:
            with section("By subcategory"):
                subcategory_summary = summarize_by_subcategory(session, filters)
                col_table, col_chart = st.columns([1, 1])
                with col_table:
                    if not subcategory_summary.empty:
                        st.dataframe(subcategory_summary, use_container_width=True)
                    else:
                        st.info(
                            "No subcategories assigned to transactions in this range."
                        )
                with col_chart:
                    if not subcategory_summary.empty:
                        fig = _pie_from_summary(
                            subcategory_summary,
                            "subcategory",
                            "Spend by subcategory",
                        )
                        if fig:
                            st.plotly_chart(
                                fig,
                                use_container_width=True,
                                key="views_pie_subcategory",
                            )

        # Transactions table 
        st.subheader("Transactions")
        st.caption("Raw rows behind the summaries above.")
        txn_data = []
        for txn in transactions:
            txn_data.append(
                {
                    "Date": txn.date,
                    "Merchant": txn.merchant,
                    "Amount": f"${txn.amount:.2f}",
                    "Category": txn.category.name if txn.category else "None",
                    "Subcategory": txn.subcategory.name
                    if txn.subcategory
                    else "None",
                    "Tags": ", ".join([t.name for t in txn.tags]) or "None",
                    "Notes": txn.notes or "",
                    "Acct": txn.account.name,
                }
            )

        st.dataframe(pd.DataFrame(txn_data), use_container_width=True)
    
    close_session(session)


# === PAGE: SUMMARIES ===
elif page == "Summaries":
    render_page_header(
        "📊",
        "Summaries",
        "Jump straight to month, year, or semester overviews.",
    )

    session = get_db_session()

    tab1, tab2, tab3 = st.tabs(["Current Month", "Current Year", "Current Semester"])

    with tab1:
        st.subheader("Current Month Summary")
        month_range = get_current_month_range()
        filters = TransactionFilter(start_date=month_range[0], end_date=month_range[1])
        _render_summary_tab(session, filters, "export_tag_month")

    with tab2:
        st.subheader("Current Year Summary")
        year_range = get_current_year_range()
        filters = TransactionFilter(start_date=year_range[0], end_date=year_range[1])
        _render_summary_tab(session, filters, "export_tag_year")

    with tab3:
        st.subheader("Current Semester Summary")
        semester_range = get_current_semester_range()
        filters = TransactionFilter(start_date=semester_range[0], end_date=semester_range[1])
        _render_summary_tab(session, filters, "export_tag_semester")

    close_session(session)


# === PAGE: SETTINGS ===
elif page == "Settings":
    st.title("⚙️ Settings")
    
    session = get_db_session()

    render_page_header(
        "Accounts",
        "",
        "Where your transactions originate.",
    )
    left, right = st.columns(2)

    with left:
        st.markdown("**Create new account**")
        account_name = st.text_input("Account name")
        account_type = st.selectbox(
            "Account type", ["checking", "savings", "credit", "cash", "investment"]
        )

        if st.button("Create account"):
            try:
                account = Account(name=account_name, type=account_type)
                session.add(account)
                session.commit()
                st.success(f"✅ Account '{account_name}' created!")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {str(e)}")

    with right:
        st.markdown("**Existing accounts**")
        accounts = get_all_accounts(session)
        if accounts:
            for account in accounts:
                r1, r2 = st.columns([3, 1])
                with r1:
                    st.write(f"• {account.name} ({account.type})")
                with r2:
                    if st.button(
                        "Delete",
                        key=f"delete_account_{account.id}",
                        help="This will remove the account; transactions will also be affected.",
                    ):
                        session.delete(account)
                        session.commit()
                        st.rerun()
        else:
            st.info("No accounts yet.")

    render_page_header(
        "Categories",
        "",
        "Top-level buckets for your spending.",
    )
    left, right = st.columns(2)

    with left:
        st.markdown("**Create new category**")
        category_name = st.text_input("Category name", key="new_category")

        if st.button("Create category"):
            try:
                category = Category(name=category_name)
                session.add(category)
                session.commit()
                st.success(f"✅ Category '{category_name}' created!")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {str(e)}")

    with right:
        st.markdown("**Existing categories**")
        categories = get_all_categories(session)
        if categories:
            for category in categories:
                r1, r2 = st.columns([3, 1])
                with r1:
                    st.write(f"• {category.name}")
                with r2:
                    if st.button(
                        "Delete",
                        key=f"delete_category_{category.id}",
                        help="Deleting a category also impacts its subcategories and transactions.",
                    ):
                        session.delete(category)
                        session.commit()
                        st.rerun()
        else:
            st.info("No categories yet.")

    render_page_header(
        "Subcategories",
        "",
        "More granular labels nested under each category.",
    )
    left, right = st.columns(2)

    with left:
        st.markdown("**Create new subcategory**")
        categories = get_all_categories(session)
        if categories:
            selected_category_name = st.selectbox(
                "Parent category",
                [c.name for c in categories],
                key="subcategory_category",
            )
            category_id = next(
                (c.id for c in categories if c.name == selected_category_name), None
            )
            subcategory_name = st.text_input(
                "Subcategory name", key="new_subcategory"
            )

            if st.button("Create subcategory"):
                try:
                    subcategory = Subcategory(
                        name=subcategory_name, category_id=category_id
                    )
                    session.add(subcategory)
                    session.commit()
                    st.success(
                        f"✅ Subcategory '{subcategory_name}' created under '{selected_category_name}'!"
                    )
                    st.rerun()
                except Exception as e:
                    st.error(f"Error: {str(e)}")
        else:
            st.info("Create a category first.")

    with right:
        st.markdown("**Existing subcategories**")
        categories = get_all_categories(session)
        if categories:
            for category in categories:
                subcategories = get_subcategories_by_category(session, category.id)
                if subcategories:
                    st.write(f"**{category.name}:**")
                    for subcategory in subcategories:
                        r1, r2 = st.columns([3, 1])
                        with r1:
                            st.write(f"  • {subcategory.name}")
                        with r2:
                            if st.button(
                                "Delete",
                                key=f"delete_subcategory_{subcategory.id}",
                            ):
                                session.delete(subcategory)
                                session.commit()
                                st.rerun()
        else:
            st.info("No categories yet.")

    render_page_header(
        "Tags",
        "",
        "Flat context labels that don’t affect accounting.",
    )
    left, right = st.columns(2)

    with left:
        st.markdown("**Create new tag**")
        st.caption("Use tags for context like people, courses, or projects.")

        tag_name = st.text_input("Tag name", key="new_tag")

        if st.button("Create tag"):
            try:
                tag = Tag(name=tag_name)
                session.add(tag)
                session.commit()
                st.success(f"✅ Tag '{tag_name}' created!")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {str(e)}")

    with right:
        st.markdown("**Existing tags**")
        all_tags = get_all_tags(session)
        if all_tags:
            for tag in all_tags:
                r1, r2 = st.columns([3, 1])
                with r1:
                    st.write(f"• {tag.name}")
                with r2:
                    if st.button("Delete", key=f"delete_tag_{tag.id}"):
                        session.delete(tag)
                        session.commit()
                        st.rerun()
        else:
            st.info("No tags yet.")

    render_page_header(
        "Rules",
        "",
        "Auto-categorize imported transactions (first match wins).",
    )
    left, right = st.columns(2)

    categories = get_all_categories(session)
    category_name_to_id = {c.name: c.id for c in categories}
    category_names = [c.name for c in categories]

    with left:
        st.markdown("**Create new rule**")
        if not categories:
            st.info("Create categories and subcategories first.")
        else:
            rule_priority = st.number_input(
                "Priority (lower runs first)",
                min_value=0,
                value=100,
                step=1,
                key="rule_create_priority",
            )
            rule_field = st.selectbox(
                "Field",
                sorted(list(ALLOWED_FIELDS)),
                key="rule_create_field",
            )
            rule_operator = st.selectbox(
                "Operator",
                sorted(list(ALLOWED_OPERATORS)),
                key="rule_create_operator",
            )
            rule_value = st.text_input("Value", key="rule_create_value")

            rule_category_name = st.selectbox(
                "Category",
                category_names,
                key="rule_create_category",
            )
            rule_category_id = category_name_to_id[rule_category_name]
            rule_subcategories = get_subcategories_by_category(session, rule_category_id)
            rule_subcategory_name = st.selectbox(
                "Subcategory",
                [s.name for s in rule_subcategories] if rule_subcategories else [],
                key="rule_create_subcategory",
            )
            rule_subcategory_id = next(
                (s.id for s in rule_subcategories if s.name == rule_subcategory_name),
                None,
            )

            if st.button("Create rule", key="rule_create_btn", disabled=rule_subcategory_id is None):
                try:
                    create_rule(
                        session,
                        priority=int(rule_priority),
                        field=rule_field,
                        operator=rule_operator,
                        value=rule_value,
                        category_id=int(rule_category_id),
                        subcategory_id=int(rule_subcategory_id),
                    )
                    st.success("✅ Rule created!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Error: {str(e)}")

    with right:
        st.markdown("**Existing rules (sorted by priority)**")
        rules = list_rules(session)
        if not rules:
            st.info("No rules yet.")
        else:
            # Small lookup caches for display.
            cats = {c.id: c.name for c in categories}
            subcats = {
                s.id: (s.name, s.category_id)
                for c in categories
                for s in get_subcategories_by_category(session, c.id)
            }

            for r in rules:
                cat_name = cats.get(r.category_id, f"Category {r.category_id}")
                sub_name = subcats.get(r.subcategory_id, ("", None))[0] or f"Subcategory {r.subcategory_id}"
                label = f"[{r.priority}] {r.field} {r.operator} {r.value} → {cat_name} / {sub_name}"
                with st.expander(label, expanded=False):
                    e1, e2 = st.columns(2)
                    with e1:
                        new_priority = st.number_input(
                            "Priority",
                            min_value=0,
                            value=int(r.priority),
                            step=1,
                            key=f"rule_priority_{r.id}",
                        )
                        new_field = st.selectbox(
                            "Field",
                            sorted(list(ALLOWED_FIELDS)),
                            index=sorted(list(ALLOWED_FIELDS)).index(r.field)
                            if r.field in ALLOWED_FIELDS
                            else 0,
                            key=f"rule_field_{r.id}",
                        )
                        new_operator = st.selectbox(
                            "Operator",
                            sorted(list(ALLOWED_OPERATORS)),
                            index=sorted(list(ALLOWED_OPERATORS)).index(r.operator)
                            if r.operator in ALLOWED_OPERATORS
                            else 0,
                            key=f"rule_operator_{r.id}",
                        )
                        new_value = st.text_input(
                            "Value",
                            value=r.value,
                            key=f"rule_value_{r.id}",
                        )

                    with e2:
                        new_category_name = st.selectbox(
                            "Category",
                            category_names,
                            index=category_names.index(cat_name)
                            if cat_name in category_names
                            else 0,
                            key=f"rule_category_{r.id}",
                        )
                        new_category_id = category_name_to_id[new_category_name]
                        new_subcategories = get_subcategories_by_category(session, new_category_id)
                        new_subcategory_names = [s.name for s in new_subcategories]
                        # If current subcategory not in this category, default to first.
                        current_sub_name = sub_name if sub_name in new_subcategory_names else (new_subcategory_names[0] if new_subcategory_names else "")
                        new_subcategory_name = st.selectbox(
                            "Subcategory",
                            new_subcategory_names,
                            index=new_subcategory_names.index(current_sub_name)
                            if current_sub_name in new_subcategory_names
                            else 0,
                            key=f"rule_subcategory_{r.id}",
                        )
                        new_subcategory_id = next(
                            (s.id for s in new_subcategories if s.name == new_subcategory_name),
                            None,
                        )

                    b1, b2 = st.columns([1, 1])
                    with b1:
                        if st.button("Save changes", key=f"rule_save_{r.id}", disabled=new_subcategory_id is None):
                            try:
                                update_rule(
                                    session,
                                    r.id,
                                    priority=int(new_priority),
                                    field=new_field,
                                    operator=new_operator,
                                    value=new_value,
                                    category_id=int(new_category_id),
                                    subcategory_id=int(new_subcategory_id),
                                )
                                st.success("✅ Rule updated!")
                                st.rerun()
                            except Exception as e:
                                st.error(f"Error: {str(e)}")
                    with b2:
                        if st.button("Delete rule", key=f"rule_delete_{r.id}"):
                            try:
                                delete_rule(session, r.id)
                                st.success("✅ Rule deleted!")
                                st.rerun()
                            except Exception as e:
                                st.error(f"Error: {str(e)}")

    close_session(session)


# === FOOTER ===
st.divider()
st.markdown(
    '<div class="sp-footer">Spending • Local SQLite • v0.1</div>',
    unsafe_allow_html=True,
)


def _backup_db():
    """One-off DB backup utility for manual runs (python app.py)."""
    if not os.path.exists(DB_PATH):
        print(f"No database found at {DB_PATH}, nothing to back up.")
        return

    db_dir = os.path.dirname(DB_PATH)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_name = f"db_backup_{timestamp}.db"
    backup_path = os.path.join(db_dir, backup_name)

    try:
        shutil.copy2(DB_PATH, backup_path)
        print(f"Created backup: {backup_path}")
    except OSError as exc:
        print(f"Failed to create backup: {exc}")
        return

    # Cleanup: keep at most 5 backups, delete oldest when above limit
    backups = []
    for name in os.listdir(db_dir):
        if name.startswith("db_backup_") and name.endswith(".db"):
            path = os.path.join(db_dir, name)
            if os.path.isfile(path):
                backups.append(path)

    if len(backups) > 5:
        backups.sort(key=lambda p: os.path.getmtime(p))
        for path in backups[:-5]:
            try:
                os.remove(path)
                print(f"Deleted old backup: {path}")
            except OSError:
                # Best-effort cleanup; ignore failures
                pass


if __name__ == "__main__":
    _backup_db()
