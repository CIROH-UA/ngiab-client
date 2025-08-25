import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship
from .__base import Base

class Node(Base):
    __tablename__ = "node"

    # UUID PK; keep the front-end id in `name`
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("workflow.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)    # frontend node id (e.g., 'pre-process', 'teehr-2')
    kind = Column(String(64), nullable=False)     # 'pre-process'|'calibration'|'run ngiab'|'teehr'
    user = Column(String(255), nullable=False)

    config = Column(JSON, nullable=True)          # stored from popup
    status = Column(String(32), nullable=False, default="idle")
    message = Column(Text, nullable=True)

    # layout/presentation (optional)
    order_index = Column(Integer, nullable=True)
    pos_x = Column(Float, nullable=True)
    pos_y = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    workflow = relationship("Workflow", back_populates="nodes")
