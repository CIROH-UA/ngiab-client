# id   -> uuid
# name -> str
# user -> str
# graph -> json (nodes/edges as sent by frontend)
# layers -> json
# status -> str
# message -> str
# created_at / updated_at / last_run_at

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship

from .__base import Base


class Workflow(Base):
    __tablename__ = "workflow"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    user = Column(String(255), nullable=False)

    graph = Column(JSON, nullable=True)     # raw nodes/edges payload
    layers = Column(JSON, nullable=True)

    status = Column(String(32), nullable=False, default="idle")
    message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_run_at = Column(DateTime(timezone=True), nullable=True)

    # relationship to nodes
    nodes = relationship("Node", back_populates="workflow", cascade="all, delete-orphan")
