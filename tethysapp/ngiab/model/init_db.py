from sqlalchemy.orm import sessionmaker
from . import Base 
from .node import Node
from .workflow import Workflow

def create_tables(engine, first_time):
    print("Initializing Persistent Storage")
    Base.metadata.create_all(engine)  # single call
    if first_time:
        SessionMaker = sessionmaker(bind=engine)
        session = SessionMaker()
        session.close()
        print("Finishing Initializing Persistent Storage")