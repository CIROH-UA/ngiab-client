#id -> uuid
#name -> str
#type -> str
#user -> str
#parameters -> json
#state -> str
#date -> datetime

from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import (
    Column, String, Text, Boolean, DateTime, ForeignKey, Integer,
    Float, ARRAY
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, ARRAY
from sqlalchemy.orm import relationship
import uuid

from .__base import Base

class Node(Base):
    __tablename__ = "node"
