"""
Demo Script - Populate the database with sample data for testing.

This script creates sample accounts, categories, tags, and transactions
to help test the application.
"""

from datetime import date, timedelta
from db.database import init_db, get_session
from db.models import Account, Category, Tag, Transaction


def setup_demo_data():
    """Create demo accounts, categories, tags, and transactions."""
    
    # Initialize database
    print("Initializing database...")
    init_db()
    
    session = get_session()
    
    # Check if data already exists
    if session.query(Account).count() > 0:
        print("Demo data already exists. Skipping...")
        return
    
    print("Creating demo data...")
    
    # === CREATE ACCOUNTS ===
    print("\n📱 Creating accounts...")
    chase = Account(name="Chase Sapphire Preferred", type="credit_card")
    wells = Account(name="Wells Fargo Premium", type="credit_card")
    bilt = Account(name="BILT Mastercard", type="credit_card")
    
    session.add_all([chase, wells, bilt])
    session.commit()
    print(f"  ✓ Created 3 accounts")
    
    # === CREATE CATEGORIES ===
    print("\n🏷️  Creating categories...")
    categories_data = [
        'Food & Dining',
        'Travel',
        'Shopping',
        'Entertainment',
        'Utilities',
        'Groceries',
        'Gas & Transportation',
    ]
    
    categories = {}
    for cat_name in categories_data:
        cat = Category(name=cat_name)
        session.add(cat)
        categories[cat_name] = cat
    
    session.commit()
    print(f"  ✓ Created {len(categories)} categories")
    
    # === CREATE TAGS ===
    print("\n✨ Creating tags...")
    tags_data = {
        'Food & Dining': ['Restaurants', 'Coffee', 'Breakfast'],
        'Travel': ['Flights', 'Hotels', 'Uber/Lyft', 'Gas'],
        'Shopping': ['Clothes', 'Electronics', 'Books'],
        'Entertainment': ['Movies', 'Games', 'Concerts'],
        'Utilities': ['Internet', 'Phone', 'Electricity'],
        'Groceries': ['Whole Foods', 'Trader Joes', 'Costco'],
        'Gas & Transportation': ['Gas Station', 'Parking', 'Public Transit'],
    }
    
    tags = {}
    for cat_name, tag_names in tags_data.items():
        for tag_name in tag_names:
            tag = Tag(name=tag_name, category_id=categories[cat_name].id)
            session.add(tag)
            tags[tag_name] = tag
    
    session.commit()
    total_tags = sum(len(v) for v in tags_data.values())
    print(f"  ✓ Created {total_tags} tags")
    
    # === CREATE TRANSACTIONS ===
    print("\n💰 Creating sample transactions...")
    
    today = date.today()
    merchants = [
        ("Starbucks", tags['Coffee'], 5.50),
        ("Chipotle", tags['Restaurants'], 12.75),
        ("Whole Foods", tags['Whole Foods'], 42.30),
        ("United Airlines", tags['Flights'], 280.00),
        ("Marriott Hotels", tags['Hotels'], 150.00),
        ("Uber", tags['Uber/Lyft'], 18.50),
        ("Shell Gas", tags['Gas Station'], 55.00),
        ("Apple Store", tags['Electronics'], 199.99),
        ("Amazon", tags['Books'], 35.50),
        ("Cinemark", tags['Movies'], 15.00),
        ("Spotify", tags['Entertainment'], 12.99),
        ("Verizon", tags['Phone'], 65.00),
        ("ConEd", tags['Electricity'], 95.00),
        ("Parsons Green Coffee", tags['Coffee'], 6.25),
        ("Balthazar Restaurant", tags['Restaurants'], 85.00),
    ]
    
    transactions_created = 0
    
    # Create transactions for the last 90 days
    for i in range(90):
        current_date = today - timedelta(days=i)
        
        for merchant, tag, amount in merchants:
            if i % (len(merchants)) == merchants.index((merchant, tag, amount)):
                account = [chase, wells, bilt][merchants.index((merchant, tag, amount)) % 3]
                
                transaction = Transaction(
                    date=current_date,
                    amount=amount,
                    merchant=merchant,
                    account_id=account.id,
                    notes=f"Sample transaction - {merchant}",
                )
                transaction.tags = [tag]
                session.add(transaction)
                transactions_created += 1
    
    session.commit()
    print(f"  ✓ Created {transactions_created} sample transactions")
    
    print("\n✅ Demo data setup complete!")
    print(f"\nDatabase initialized with:")
    print(f"  • {3} accounts")
    print(f"  • {len(categories)} categories")
    print(f"  • {total_tags} tags")
    print(f"  • {transactions_created} transactions (90-day history)")
    print("\nYou can now run: streamlit run app.py")


if __name__ == "__main__":
    setup_demo_data()
