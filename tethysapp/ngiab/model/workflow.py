import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.types import JSON
from sqlalchemy.orm import relationship
from .__base import Base

class Workflow(Base):
    __tablename__ = "workflow"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    user = Column(String(255), nullable=False)

    # foreign to template, if any
    template_id = Column(UUID(as_uuid=True), ForeignKey("workflow_template.id", ondelete="SET NULL"), nullable=True)

    graph = Column(JSON, nullable=True)      # raw nodes/edges payload from UI
    layers = Column(JSON, nullable=True)

    status = Column(String(32), nullable=False, default="idle")   # idle|queued|running|success|error
    message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_run_at = Column(DateTime(timezone=True), nullable=True)

    # relationships
    template = relationship("WorkflowTemplate")
    nodes = relationship("Node", back_populates="workflow", cascade="all, delete-orphan")
