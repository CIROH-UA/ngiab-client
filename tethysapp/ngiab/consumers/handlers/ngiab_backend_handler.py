import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..backend_actions import BackendActions
from .model_run_handler import ModelBackendHandler as MBH
from ...model import Workflow, Node

logger = logging.getLogger(__name__)


class NgiabBackendHandler(MBH):
    """
    Receives actions from the frontend and coordinates persistence + orchestration.
    Replace the stubbed Argo calls with real REST calls when ready.
    """

    @property
    def receiving_actions(self) -> dict[BackendActions | str, callable]:
        return {
            BackendActions.RUN_WORKFLOW: self.receive_run_workflow,
            BackendActions.RUN_NODE: self.receive_run_node,
            BackendActions.REQUEST_LAST_RUN: self.receive_request_last_run,
            # Optional direct node-type runs:
            BackendActions.RUN_PREPROCESS: self.receive_run_preprocess,
            BackendActions.RUN_CALIBRATION: self.receive_run_calibration,
            BackendActions.RUN_NGIAB: self.receive_run_ngiab,
            BackendActions.RUN_TEERH: self.receive_run_teehr,
        }

    # --------------------------- helpers -------------------------------------

    def _current_username(self) -> str:
        user = self.backend_consumer.scope.get("user")
        return getattr(user, "username", "anonymous")

    async def _simulate_argo_call(self, description: str, payload: dict[str, Any] | None = None) -> None:
        """
        Placeholder to integrate Argo Workflows REST API (non-blocking). :contentReference[oaicite:5]{index=5}
        """
        logger.info("Argo call: %s | payload=%s", description, payload)
        await asyncio.sleep(0.1)  # non-blocking stub

    async def _emit_status(self, node_id: str, status: str, message: str = "") -> None:
        await self.send_action(
            BackendActions.NODE_STATUS,
            {"nodeId": node_id, "status": status, "message": message},
        )

    # ---------------------------- actions ------------------------------------

    @MBH.action_handler
    async def receive_run_workflow(self, event, action, data, session: AsyncSession):
        """
        Persist workflow + nodes and simulate orchestration.
        Incoming payload shape from frontend:
          { "workflow": { "layers":[...], "nodes":[{id,label},...], "edges":[...] } }
        """
        wf_data = data.get("workflow") or {}
        if not wf_data:
            raise ValueError("Missing 'workflow' in payload.")

        username = self._current_username()

        # Create workflow record
        wf = Workflow(
            name=wf_data.get("name") or f"wf-{datetime.now(timezone.utc).isoformat(timespec='seconds')}",
            user=username,
            status="queued",
            graph=wf_data,        # store raw nodes/edges/layers
            layers=wf_data.get("layers", []),
        )
        session.add(wf)
        await session.flush()  # assign wf.id

        # Create node records bound to this workflow
        created_nodes = []
        for n in wf_data.get("nodes", []):
            node = Node(
                workflow_id=wf.id,
                name=n.get("id"),
                kind=n.get("label"),      # 'pre-process' / 'calibration' / etc
                user=username,
                config={},                # will be filled via config popup later
                status="idle",
            )
            session.add(node)
            created_nodes.append(node)

        await session.commit()
        await self.send_acknowledge("workflow persisted", action, data, {"workflow_id": str(wf.id)})

        # Simulate orchestration and send status changes
        for node in created_nodes:
            await self._emit_status(node_id=str(node.id), status="running", message="started")
            await self._simulate_argo_call(f"run {node.kind}", {"node_id": str(node.id)})
            await self._emit_status(node_id=str(node.id), status="success", message="ok")

        # Mark workflow complete
        await self._simulate_argo_call("complete workflow", {"workflow_id": str(wf.id)})
        await self.send_acknowledge("workflow complete", action, data, {"workflow_id": str(wf.id)})

    @MBH.action_handler
    async def receive_run_node(self, event, action, data, session: AsyncSession):
        """
        Run a single node: { nodeId, label, config }
        """
        node_id = data.get("nodeId")
        if not node_id:
            raise ValueError("Missing 'nodeId' in payload.")

        # Update config/status
        await session.execute(
            update(Node)
            .where(Node.id == node_id)
            .values(config=data.get("config") or {}, status="running", updated_at=datetime.now(timezone.utc))
        )
        await session.commit()

        await self._emit_status(node_id=node_id, status="running", message="started")
        await self._simulate_argo_call("run node", {"node_id": node_id, "label": data.get("label")})
        await self._emit_status(node_id=node_id, status="success", message="ok")

    @MBH.action_handler
    async def receive_request_last_run(self, event, action, data, session: AsyncSession):
        """
        Return a simple playback log for the most recent workflow for the current user.
        """
        username = self._current_username()
        result = await session.execute(
            select(Workflow).where(Workflow.user == username).order_by(Workflow.updated_at.desc()).limit(1)
        )
        wf = result.scalar_one_or_none()
        if not wf:
            # no workflows yet; send empty list
            await self.send_action(BackendActions.LAST_RUN_LOG, {"events": []})
            return

        # gather nodes for this workflow and produce a naive event stream
        result = await session.execute(select(Node).where(Node.workflow_id == wf.id).order_by(Node.created_at.asc()))
        nodes = list(result.scalars())

        events = []
        t = 0
        for n in nodes:
            events.append({"nodeId": str(n.id), "status": "running", "message": "started", "timestampMs": t}); t += 800
            final = "success" if n.status in (None, "idle", "running", "success") else "error"
            events.append({"nodeId": str(n.id), "status": final, "message": "ok" if final == "success" else "failed", "timestampMs": t}); t += 1000

        await self.send_action(BackendActions.LAST_RUN_LOG, {"events": events})

    # ---- optional typed runs (stubs) -----------------------------------------

    @MBH.action_handler
    async def receive_run_preprocess(self, event, action, data, session: AsyncSession):
        await self._simulate_argo_call("run preprocess", data)
        await self.send_acknowledge("preprocess queued", action, data)

    @MBH.action_handler
    async def receive_run_calibration(self, event, action, data, session: AsyncSession):
        await self._simulate_argo_call("run calibration", data)
        await self.send_acknowledge("calibration queued", action, data)

    @MBH.action_handler
    async def receive_run_ngiab(self, event, action, data, session: AsyncSession):
        await self._simulate_argo_call("run ngiab", data)
        await self.send_acknowledge("ngiab queued", action, data)

    @MBH.action_handler
    async def receive_run_teehr(self, event, action, data, session: AsyncSession):
        await self._simulate_argo_call("run teehr", data)
        await self.send_acknowledge("teehr queued", action, data)
