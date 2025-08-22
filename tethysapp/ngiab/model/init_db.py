from sqlalchemy.orm import sessionmaker
from . import Base

def create_tables(engine, first_time: bool = False):
    """
    Create ORM tables. Compatible with a synchronous Engine.
    If you use an async engine at runtime, you can still pre-create with a sync engine
    (e.g., via Alembic or a startup hook).
    """
    print("Initializing Persistent Storage")
    Base.metadata.create_all(engine)  # single call for all tables
    if first_time:
        SessionMaker = sessionmaker(bind=engine)
        session = SessionMaker()
        session.close()
        print("Finishing Initializing Persistent Storage")
