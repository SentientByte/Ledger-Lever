import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

_db_path = os.getenv("LEDGER_DB_PATH")
if _db_path:
    DATABASE_URL = f"sqlite:///{_db_path}"
else:
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////data/portfolio.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
