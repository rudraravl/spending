"""
Spending - MVP
Local-only spending tracker with CSV import, manual entry, and summaries.
"""

import streamlit as st
import pandas as pd
import os
import tempfile
from datetime import date, datetime
from db.database import init_db, get_session, close_session
from db.models import Account, Category, Tag, Transaction
from services.trasaction_service import (
    create_transaction,
    update_transaction,
    assign_tags,
    get_transactions,
    get_transaction_by_id,
    delete_transaction,
    count_transactions,
)
from services.summary_service import (
    calculate_total,
    summarize_by_tag,
    summarize_by_category,
    export_transactions,
)
from services.import_service import (
    import_csv,
    get_available_adapters,
    ensure_account,
    ensure_category,
    ensure_tag,
)
from utils.filters import TransactionFilter
from utils.semester import (
    get_current_semester_range,
    get_current_month_range,
    get_current_year_range,
)
from sqlalchemy.orm import Session


# === PAGE CONFIG ===
st.set_page_config(
    page_title="Spending",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="expanded",
)

# === INITIALIZE DATABASE ===
if not st.session_state.get("db_initialized"):
    init_db()
    st.session_state.db_initialized = True


# === SIDEBAR NAVIGATION ===
st.sidebar.title("📊 Budget Tracker")
page = st.sidebar.radio(
    "Navigation",
    [
        "Dashboard",
        "Import CSV",
        "Add Transaction",
        "All Transactions",
        "Custom Date Range",
        "Summaries",
        "Settings",
    ],
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


# === PAGE: DASHBOARD ===
if page == "Dashboard":
    st.title("💰 Budget Dashboard")
    
    session = get_db_session()
    
    # Display overall statistics
    col1, col2, col3 = st.columns(3)
    
    # Total spend (all time)
    total_spend = calculate_total(session)
    col1.metric("Total All-Time Spending", f"${total_spend:.2f}")
    
    # Current month spend
    month_range = get_current_month_range()
    filters = TransactionFilter(start_date=month_range[0], end_date=month_range[1])
    month_spend = calculate_total(session, filters)
    col2.metric("Current Month", f"${month_spend:.2f}")
    
    # Total transactions
    total_transactions = session.query(Transaction).count()
    col3.metric("Total Transactions", total_transactions)
    
    st.divider()
    
    # Recent transactions
    st.subheader("Recent Transactions")
    recent = get_transactions(session, limit=10)
    if recent:
        recent_data = []
        for txn in recent:
            recent_data.append({
                'Date': txn.date,
                'Merchant': txn.merchant,
                'Amount': f"${txn.amount:.2f}",
                'Category': (
                    sorted({t.category.name for t in txn.tags})[0]
                    if len({t.category.name for t in txn.tags}) == 1
                    else (txn.category.name if txn.category else 'None')
                ),
                'Tags': ', '.join([t.name for t in txn.tags]) or 'None',
                'Notes': txn.notes or '',
                'Acct': txn.account.name,
            })
        st.dataframe(pd.DataFrame(recent_data), use_container_width=True)
    else:
        st.info("No transactions yet. Start by importing a CSV or adding a transaction manually.")
    
    close_session(session)


# === PAGE: IMPORT CSV ===
elif page == "Import CSV":
    st.title("📥 Import CSV")
    
    session = get_db_session()
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("Step 1: Select Account")
        
        accounts = get_all_accounts(session)
        account_names = [a.name for a in accounts]
        
        if account_names:
            selected_account = st.selectbox("Account", account_names)
            account = next((a for a in accounts if a.name == selected_account), None)
        else:
            st.warning("No accounts found. Please create an account in Settings first.")
            account = None
        
        st.subheader("Step 2: Select Adapter")
        adapter_name = st.selectbox("CSV Format", get_available_adapters())
        
        if adapter_name == "generic":
            st.subheader("Step 3: Configure Generic Adapter")
            
            # Get sample columns from uploaded file
            uploaded_file = st.file_uploader("Upload CSV", type="csv")
            if uploaded_file:
                sample_df = pd.read_csv(uploaded_file)
                column_names = list(sample_df.columns)
                
                date_col = st.selectbox("Date Column", column_names, key="date_col")
                amount_col = st.selectbox("Amount Column", column_names, key="amount_col")
                merchant_col = st.selectbox("Merchant Column", column_names, key="merchant_col")
                
                st.info(f"Sample data:\n{sample_df.head()}")
        else:
            st.subheader("Step 3: Upload CSV")
            uploaded_file = st.file_uploader("Upload CSV", type="csv")
            date_col = None
            amount_col = None
            merchant_col = None
    
    with col2:
        if uploaded_file and account:
            st.subheader("Preview")
            
            # Preview the raw uploaded CSV
            try:
                uploaded_file.seek(0)
                preview_df = pd.read_csv(uploaded_file)
                uploaded_file.seek(0)

                total_entries = len(preview_df)
                parsed_dates = None

                date_candidates = [
                    col for col in preview_df.columns
                    if "date" in str(col).lower()
                ]

                for col in date_candidates:
                    candidate_dates = pd.to_datetime(preview_df[col], errors="coerce")
                    if candidate_dates.notna().any():
                        parsed_dates = candidate_dates
                        break

                stats_col1, stats_col2 = st.columns(2)
                with stats_col1:
                    st.metric("Total Entries", total_entries)
                with stats_col2:
                    st.markdown("**Date Range**")
                    if parsed_dates is not None:
                        min_date = parsed_dates.min().date()
                        max_date = parsed_dates.max().date()
                        st.markdown(
                            f"<div style='font-size: 0.95rem;'>{min_date} → {max_date}</div>",
                            unsafe_allow_html=True,
                        )
                    else:
                        st.markdown(
                            "<div style='font-size: 0.95rem;'>Not detected</div>",
                            unsafe_allow_html=True,
                        )

                st.dataframe(preview_df.head(20), use_container_width=True)
                
                # Import button
                if st.button("✅ Confirm Import"):
                    if adapter_name == "generic":
                        kwargs = {
                            'date_col': date_col,
                            'amount_col': amount_col,
                            'merchant_col': merchant_col,
                        }
                    else:
                        kwargs = {}

                    temp_path = None
                    try:
                        uploaded_file.seek(0)
                        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as temp_file:
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
                        st.warning(f"⚠️ Skipped {len(skipped)} duplicate transactions")
            
            except Exception as e:
                st.error(f"Error parsing CSV: {str(e)}")
    
    close_session(session)


# === PAGE: ADD TRANSACTION ===
elif page == "Add Transaction":
    st.title("➕ Add Transaction")
    
    session = get_db_session()
    
    # Get accounts and tags
    accounts = get_all_accounts(session)
    categories = get_all_categories(session)
    all_tags = get_all_tags(session)
    
    if not accounts:
        st.error("Please create an account in Settings first.")
    else:
        col1, col2 = st.columns(2)
        
        with col1:
            txn_date = st.date_input("Date", value=date.today())
            amount = st.number_input("Amount", min_value=0.01, step=0.01)
            merchant = st.text_input("Merchant")
        
        with col2:
            account = st.selectbox("Account", [a.name for a in accounts])
            account_id = next((a.id for a in accounts if a.name == account), None)

            selected_category_name = st.selectbox(
                "Category (optional)",
                ["None"] + [c.name for c in categories],
            )
            category_id = (
                next((c.id for c in categories if c.name == selected_category_name), None)
                if selected_category_name != "None"
                else None
            )
            
            # Tag selection
            selected_tags = st.multiselect(
                "Tags",
                [t.name for t in all_tags],
            )
            tag_ids = [t.id for t in all_tags if t.name in selected_tags]
        
        notes = st.text_area("Notes (optional)")
        
        if st.button("Save Transaction"):
            try:
                create_transaction(
                    session,
                    txn_date,
                    amount,
                    merchant,
                    account_id,
                    category_id,
                    notes if notes else None,
                    tag_ids if tag_ids else None,
                )
                st.success("✅ Transaction added!")
                st.rerun()
            except Exception as e:
                st.error(f"Error: {str(e)}")
    
    close_session(session)


# === PAGE: ALL TRANSACTIONS ===
elif page == "All Transactions":
    st.title("📋 All Transactions")
    
    session = get_db_session()
    all_tags = get_all_tags(session)
    all_categories = get_all_categories(session)
    tag_name_to_id = {tag.name: tag.id for tag in all_tags}
    tag_name_to_category = {tag.name: tag.category.name for tag in all_tags}
    category_to_tag_names = {}
    for tag in all_tags:
        category_to_tag_names.setdefault(tag.category.name, []).append(tag.name)
    category_names = sorted([category.name for category in all_categories])
    tag_names = sorted(tag_name_to_id.keys())

    def normalize_tag_list(value):
        if value is None:
            return []
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        if isinstance(value, str):
            return [v.strip() for v in value.split(',') if v.strip()]
        return []

    # Get all transactions for table view
    transactions = get_transactions(session)
    
    if not transactions:
        st.info("No transactions found.")
    else:
        st.caption("Double-click a cell to edit. Check Delete and click away to remove a row.")

        table_df = pd.DataFrame([
            {
                'id': txn.id,
                'Date': txn.date,
                'Merchant': txn.merchant,
                'Amount': float(txn.amount),
                'Category': (
                    sorted({t.category.name for t in txn.tags})[0]
                    if len({t.category.name for t in txn.tags}) == 1
                    else (txn.category.name if txn.category else "")
                ),
                'Tags': [t.name for t in txn.tags] if txn.tags else [],
                'Notes': txn.notes or "",
                'Acct': txn.account.name if txn.account else "",
                'Delete': False,
            }
            for txn in transactions
        ])

        edited_df = st.data_editor(
            table_df,
            hide_index=True,
            use_container_width=True,
            height=650,
            disabled=['id', 'Acct'],
            column_config={
                'id': st.column_config.NumberColumn('id', disabled=True),
                'Date': st.column_config.DateColumn('Date', format='YYYY-MM-DD'),
                'Merchant': st.column_config.TextColumn('Merchant', width='small'),
                'Amount': st.column_config.NumberColumn('Amount', format='$%.2f'),
                'Category': st.column_config.SelectboxColumn(
                    'Category',
                    options=[""] + category_names,
                    help='Optional: used to constrain selected tags to one category.',
                ),
                'Tags': st.column_config.MultiselectColumn(
                    'Tags',
                    options=tag_names,
                    help='Assign one or more tags to categorize this transaction.',
                ),
                'Delete': st.column_config.CheckboxColumn('Delete'),
            },
            key='all_transactions_editor',
        )

        updated_cells = 0
        deleted_rows = 0
        transaction_map = {txn.id: txn for txn in transactions}

        for _, row in edited_df.iterrows():
            transaction_id = int(row['id'])
            transaction = transaction_map.get(transaction_id)
            if not transaction:
                continue

            should_delete = bool(row['Delete']) if pd.notna(row['Delete']) else False
            if should_delete:
                try:
                    delete_transaction(session, transaction_id)
                    deleted_rows += 1
                except Exception as e:
                    st.error(f"Error deleting row {transaction_id}: {str(e)}")
                continue

            try:
                new_date = pd.to_datetime(row['Date']).date() if pd.notna(row['Date']) else transaction.date
                new_amount = float(row['Amount']) if pd.notna(row['Amount']) else float(transaction.amount)
                new_merchant = str(row['Merchant']).strip() if pd.notna(row['Merchant']) else transaction.merchant
                raw_notes = str(row['Notes']).strip() if pd.notna(row['Notes']) else ""
                new_notes = raw_notes if raw_notes else None

                if new_date != transaction.date:
                    update_transaction(session, transaction_id, 'date', new_date)
                    updated_cells += 1
                if new_amount != float(transaction.amount):
                    update_transaction(session, transaction_id, 'amount', new_amount)
                    updated_cells += 1
                if new_merchant != transaction.merchant:
                    update_transaction(session, transaction_id, 'merchant', new_merchant)
                    updated_cells += 1
                existing_notes = transaction.notes if transaction.notes else None
                if new_notes != existing_notes:
                    update_transaction(session, transaction_id, 'notes', new_notes)
                    updated_cells += 1

                selected_category = str(row['Category']).strip() if pd.notna(row['Category']) else ""
                selected_tags = normalize_tag_list(row['Tags'])
                existing_tags = sorted([t.name for t in transaction.tags])

                selected_categories = {tag_name_to_category[tag_name] for tag_name in selected_tags if tag_name in tag_name_to_category}
                if not selected_category and len(selected_categories) == 1:
                    selected_category = next(iter(selected_categories))

                unknown_tags = [tag_name for tag_name in selected_tags if tag_name not in tag_name_to_id]
                if unknown_tags:
                    st.error(f"Unknown tags on row {transaction_id}: {', '.join(unknown_tags)}")
                    continue

                if selected_category:
                    allowed_tags = set(category_to_tag_names.get(selected_category, []))
                    invalid_tags = [tag_name for tag_name in selected_tags if tag_name not in allowed_tags]
                    if invalid_tags:
                        st.error(
                            f"Row {transaction_id}: selected tags {', '.join(invalid_tags)} do not belong to category '{selected_category}'."
                        )
                        continue

                if selected_category == "" and len(selected_categories) > 1:
                    st.error(
                        f"Row {transaction_id}: choose a single category when using tags from multiple categories."
                    )
                    continue

                existing_category = transaction.category.name if transaction.category else ""
                if selected_category != existing_category:
                    new_category_id = next(
                        (category.id for category in all_categories if category.name == selected_category),
                        None,
                    )
                    update_transaction(session, transaction_id, 'category_id', new_category_id)
                    updated_cells += 1

                if sorted(selected_tags) != existing_tags:
                    assign_tags(
                        session,
                        transaction_id,
                        [tag_name_to_id[tag_name] for tag_name in selected_tags],
                    )
                    updated_cells += 1
            except Exception as e:
                st.error(f"Error updating row {transaction_id}: {str(e)}")

        if deleted_rows > 0:
            st.success(f"✅ Deleted {deleted_rows} row(s)")
            st.rerun()

        if updated_cells > 0:
            st.success(f"✅ Auto-saved {updated_cells} change(s)")
            st.rerun()

    close_session(session)


# === PAGE: CUSTOM DATE RANGE ===
elif page == "Custom Date Range":
    st.title("📅 Custom Date Range")
    
    session = get_db_session()
    
    col1, col2 = st.columns(2)
    
    with col1:
        start_date = st.date_input("Start Date")
    
    with col2:
        end_date = st.date_input("End Date")
    
    st.divider()
    
    # Optional filters
    st.subheader("Filters")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        accounts = get_all_accounts(session)
        account_names = [a.name for a in accounts]
        selected_account = st.selectbox("Account (optional)", ["All"] + account_names)
        account_id = next((a.id for a in accounts if a.name == selected_account), None) if selected_account != "All" else None
    
    with col2:
        categories = get_all_categories(session)
        category_names = [c.name for c in categories]
        selected_category = st.selectbox("Category (optional)", ["All"] + category_names)
        category_id = next((c.id for c in categories if c.name == selected_category), None) if selected_category != "All" else None
    
    with col3:
        all_tags = get_all_tags(session)
        tag_names = [t.name for t in all_tags]
        selected_tags = st.multiselect("Tags (optional)", tag_names)
        tag_ids = [t.id for t in all_tags if t.name in selected_tags]
    
    col1, col2 = st.columns(2)
    
    with col1:
        min_amount = st.number_input("Min Amount (optional)", value=0.0, step=0.01)
    
    with col2:
        max_amount = st.number_input("Max Amount (optional)", value=0.0, step=0.01)
    
    st.divider()
    
    # Create filter
    filters = TransactionFilter(
        start_date=start_date,
        end_date=end_date,
        account_id=account_id,
        category_id=category_id,
        tag_ids=tag_ids if tag_ids else None,
        min_amount=min_amount if min_amount > 0 else None,
        max_amount=max_amount if max_amount > 0 else None,
    )
    
    # Get transactions
    transactions = get_transactions(session, filters=filters)
    
    if not transactions:
        st.info("No transactions found matching filters.")
    else:
        # Display summary
        st.subheader("Summary")
        total = calculate_total(session, filters)
        st.metric("Total", f"${total:.2f}")
        
        st.divider()
        
        # Display tag summary
        st.subheader("By Tag")
        tag_summary = summarize_by_tag(session, filters)
        if not tag_summary.empty:
            st.dataframe(tag_summary, use_container_width=True)
        else:
            st.info("No tags assigned to transactions in this range.")
        
        st.divider()
        
        # Display category summary
        st.subheader("By Category")
        category_summary = summarize_by_category(session, filters)
        if not category_summary.empty:
            st.dataframe(category_summary, use_container_width=True)
        else:
            st.info("No categories assigned to transactions in this range.")
        
        st.divider()
        
        # Display transactions
        st.subheader("Transactions")
        txn_data = []
        for txn in transactions:
            txn_data.append({
                'Date': txn.date,
                'Merchant': txn.merchant,
                'Amount': f"${txn.amount:.2f}",
                'Category': (
                    sorted({t.category.name for t in txn.tags})[0]
                    if len({t.category.name for t in txn.tags}) == 1
                    else (txn.category.name if txn.category else 'None')
                ),
                'Tags': ', '.join([t.name for t in txn.tags]) or 'None',
                'Notes': txn.notes or '',
                'Acct': txn.account.name,
            })
        
        st.dataframe(pd.DataFrame(txn_data), use_container_width=True)
    
    close_session(session)


# === PAGE: SUMMARIES ===
elif page == "Summaries":
    st.title("📊 Summaries")
    
    session = get_db_session()
    
    # Predefined date ranges
    tab1, tab2, tab3 = st.tabs(["Current Month", "Current Year", "Current Semester"])
    
    with tab1:
        st.subheader("Current Month Summary")
        month_range = get_current_month_range()
        filters = TransactionFilter(start_date=month_range[0], end_date=month_range[1])
        
        total = calculate_total(session, filters)
        st.metric("Total Spend", f"${total:.2f}")
        
        st.divider()
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("By Tag")
            tag_summary = summarize_by_tag(session, filters)
            if not tag_summary.empty:
                st.dataframe(tag_summary, use_container_width=True)
                
                if st.button("Export View CSV", key="export_tag_month"):
                    period_transactions = get_transactions(session, filters=filters)
                    export_file = export_transactions(period_transactions, "current_month")
                    st.success(f"✅ Exported to {export_file}")
            else:
                st.info("No tagged transactions.")
        
        with col2:
            st.subheader("By Category")
            category_summary = summarize_by_category(session, filters)
            if not category_summary.empty:
                st.dataframe(category_summary, use_container_width=True)
            else:
                st.info("No categorized transactions.")
    
    with tab2:
        st.subheader("Current Year Summary")
        year_range = get_current_year_range()
        filters = TransactionFilter(start_date=year_range[0], end_date=year_range[1])
        
        total = calculate_total(session, filters)
        st.metric("Total Spend", f"${total:.2f}")
        
        st.divider()
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("By Tag")
            tag_summary = summarize_by_tag(session, filters)
            if not tag_summary.empty:
                st.dataframe(tag_summary, use_container_width=True)
                
                if st.button("Export View CSV", key="export_tag_year"):
                    period_transactions = get_transactions(session, filters=filters)
                    export_file = export_transactions(period_transactions, "current_year")
                    st.success(f"✅ Exported to {export_file}")
            else:
                st.info("No tagged transactions.")
        
        with col2:
            st.subheader("By Category")
            category_summary = summarize_by_category(session, filters)
            if not category_summary.empty:
                st.dataframe(category_summary, use_container_width=True)
            else:
                st.info("No categorized transactions.")
    
    with tab3:
        st.subheader("Current Semester Summary")
        semester_range = get_current_semester_range()
        filters = TransactionFilter(start_date=semester_range[0], end_date=semester_range[1])
        
        total = calculate_total(session, filters)
        st.metric("Total Spend", f"${total:.2f}")
        
        st.divider()
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("By Tag")
            tag_summary = summarize_by_tag(session, filters)
            if not tag_summary.empty:
                st.dataframe(tag_summary, use_container_width=True)
                
                if st.button("Export View CSV", key="export_tag_semester"):
                    period_transactions = get_transactions(session, filters=filters)
                    export_file = export_transactions(period_transactions, "current_semester")
                    st.success(f"✅ Exported to {export_file}")
            else:
                st.info("No tagged transactions.")
        
        with col2:
            st.subheader("By Category")
            category_summary = summarize_by_category(session, filters)
            if not category_summary.empty:
                st.dataframe(category_summary, use_container_width=True)
            else:
                st.info("No categorized transactions.")
    
    close_session(session)


# === PAGE: SETTINGS ===
elif page == "Settings":
    st.title("⚙️ Settings")
    
    session = get_db_session()
    
    # Manage accounts
    st.subheader("📱 Accounts")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.write("**Create New Account**")
        
        account_name = st.text_input("Account Name")
        account_type = st.selectbox("Account Type", ["credit_card", "checking", "savings"])
        
        if st.button("Create Account"):
            try:
                account = Account(name=account_name, type=account_type)
                session.add(account)
                session.commit()
                st.success(f"✅ Account '{account_name}' created!")
            except Exception as e:
                st.error(f"Error: {str(e)}")
    
    with col2:
        st.write("**Existing Accounts**")
        accounts = get_all_accounts(session)
        if accounts:
            for account in accounts:
                col1, col2 = st.columns(2)
                with col1:
                    st.write(f"• {account.name} ({account.type})")
                with col2:
                    if st.button("Delete", key=f"delete_account_{account.id}"):
                        session.delete(account)
                        session.commit()
                        st.rerun()
        else:
            st.info("No accounts yet.")
    
    st.divider()
    
    # Manage categories and tags
    st.subheader("🏷️ Categories & Tags")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.write("**Create New Category**")
        
        category_name = st.text_input("Category Name")
        
        if st.button("Create Category"):
            try:
                category = Category(name=category_name)
                session.add(category)
                session.commit()
                st.success(f"✅ Category '{category_name}' created!")
            except Exception as e:
                st.error(f"Error: {str(e)}")
    
    with col2:
        st.write("**Existing Categories**")
        categories = get_all_categories(session)
        if categories:
            for category in categories:
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.write(f"• {category.name}")
                with col2:
                    if st.button("Delete", key=f"delete_category_{category.id}"):
                        session.delete(category)
                        session.commit()
                        st.rerun()
        else:
            st.info("No categories yet.")
    
    st.divider()
    
    st.write("**Create New Tag**")
    
    col1, col2 = st.columns(2)
    
    with col1:
        tag_name = st.text_input("Tag Name")
    
    with col2:
        categories = get_all_categories(session)
        if categories:
            category = st.selectbox("Category", [c.name for c in categories])
            category_id = next((c.id for c in categories if c.name == category), None)
        else:
            st.error("Please create a category first.")
            category_id = None
    
    if category_id and st.button("Create Tag"):
        try:
            tag = Tag(name=tag_name, category_id=category_id)
            session.add(tag)
            session.commit()
            st.success(f"✅ Tag '{tag_name}' created!")
        except Exception as e:
            st.error(f"Error: {str(e)}")
    
    st.divider()
    
    st.write("**Existing Tags**")
    all_tags = get_all_tags(session)
    if all_tags:
        for tag in all_tags:
            col1, col2, col3 = st.columns([3, 1, 1])
            with col1:
                st.write(f"• {tag.name}")
            with col2:
                st.write(f"Category: {tag.category.name}")
            with col3:
                if st.button("Delete", key=f"delete_tag_{tag.id}"):
                    session.delete(tag)
                    session.commit()
                    st.rerun()
    else:
        st.info("No tags yet.")
    
    close_session(session)


# === FOOTER ===
st.divider()
st.caption("Spending • Local SQLite • v0.1")
