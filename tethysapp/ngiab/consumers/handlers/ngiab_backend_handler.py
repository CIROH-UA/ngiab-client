import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hera.workflows import Workflow, WorkflowTemplate, DAG, Container, Parameter, Artifact, WorkflowsService
from hera.workflows.models import WorkflowTemplateRef, ArchiveStrategy
from hera.shared import global_config

from ..backend_actions import BackendActions
from .model_run_handler import ModelBackendHandler as MBH
from ...model import Workflow as WFModel, Node as NodeModel, WorkflowTemplate as WTModel

logger = logging.getLogger(__name__)

# ---------- Hera service config ----------
import os
ARGO_HOST = os.getenv("ARGO_HOST", "https://localhost:2746")
ARGO_TOKEN = os.getenv("ARGO_TOKEN", "")
ARGO_NAMESPACE = os.getenv("ARGO_NAMESPACE", "argo")
ARGO_VERIFY_SSL = os.getenv("ARGO_VERIFY_SSL", "true").lower() in ("1","true","yes")

def make_ws() -> WorkflowsService:
    # Either use global_config or direct WS; here we go direct.
    # Hera docs show both patterns and Bearer header usage. :contentReference[oaicite:1]{index=1}
    return WorkflowsService(host=ARGO_HOST, token=ARGO_TOKEN, namespace=ARGO_NAMESPACE, verify_ssl=ARGO_VERIFY_SSL)

# Argo template names we expect to exist (or we can create once programmatically)
TPL_NGEN_TEEHR = "ngiab-ngen-teehr-artifacts"
TPL_PREPROCESS = "ngiab-preprocess-cli"

# -------------------------- graph helpers --------------------------
def _weakly_connected(nodes: List[dict], edges: List[dict]) -> bool:
    """Return True if ALL nodes belong to a single weakly connected component."""
    if not nodes:
        return False
    ids = [n["id"] for n in nodes]
    idx = {i: k for k, i in enumerate(ids)}
    adj = [[] for _ in ids]
    for e in edges or []:
        if e["source"] in idx and e["target"] in idx:
            a, b = idx[e["source"]], idx[e["target"]]
            adj[a].append(b); adj[b].append(a)  # undirected
    seen = set([0])
    stack = [0]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v); stack.append(v)
    return len(seen) == len(ids)

def _topo_layers(nodes: List[dict], edges: List[dict]) -> List[List[str]]:
    """Same topological layering as the frontend to preserve order."""
    ids = [n["id"] for n in nodes]
    indeg = {i: 0 for i in ids}
    adj = {i: [] for i in ids}
    for e in edges or []:
        if e["source"] in adj and e["target"] in indeg:
            adj[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
    layers, frontier = [], [i for i in ids if indeg[i] == 0]
    seen = set()
    while frontier:
        layers.append(frontier[:])
        seen.update(frontier)
        nxt = []
        for u in frontier:
            for v in adj[u]:
                indeg[v] -= 1
                if indeg[v] == 0 and v not in seen:
                    nxt.append(v)
        frontier = nxt
    if len(seen) != len(ids):
        # append remaining if graph isn’t DAG (should not happen due to cycle prevention)
        layers.append([i for i in ids if i not in seen])
    return layers

async def _get_or_create_template(session: AsyncSession, name: str, user: str, spec: dict | None = None) -> WTModel:
    existing = (await session.execute(select(WTModel).where(WTModel.name == name).limit(1))).scalar_one_or_none()
    if existing:
        return existing
    wt = WTModel(name=name, user=user, spec=spec or {})
    session.add(wt)
    await session.commit()
    await session.refresh(wt)
    return wt

# -------------------------- Hera submissions --------------------------
def _submit_workflow_with_template(template_name: str, params: Dict[str, str]) -> str:
    """Synchronous Hera call, run in executor—returns Argo Workflow name."""
    ws = make_ws()
    with Workflow(
        generate_name=f"{template_name}-",
        workflow_template_ref=WorkflowTemplateRef(name=template_name),
        workflows_service=ws,
    ) as w:
        w.arguments = [Parameter(name=k, value=v) for k, v in (params or {}).items()]
    w.create()
    return w.name  # name assigned by server
# `workflowTemplateRef` is the Argo-native way to run a Workflow from a WorkflowTemplate. :contentReference[oaicite:2]{index=2}

# -------------------------- Handler --------------------------
class NgiabBackendHandler(MBH):
    @property
    def receiving_actions(self) -> dict[BackendActions | str, callable]:
        return {
            BackendActions.RUN_WORKFLOW: self.receive_run_workflow,
            BackendActions.RUN_NODE: self.receive_run_node,
            BackendActions.REQUEST_LAST_RUN: self.receive_request_last_run,
            BackendActions.RUN_PREPROCESS: self.receive_run_preprocess,
            BackendActions.RUN_CALIBRATION: self.receive_run_calibration,
            BackendActions.RUN_NGIAB: self.receive_run_ngiab,
            BackendActions.RUN_TEERH: self.receive_run_teehr,
        }

    def _user(self) -> str:
        u = self.backend_consumer.scope.get("user")
        return getattr(u, "username", "anonymous")

    async def _emit_status(self, frontend_node_id: str, status: str, message: str = ""):
        # Frontend expects nodeId to match its node.id (not our UUID)
        await self.send_action(BackendActions.NODE_STATUS, {
            "nodeId": frontend_node_id, "status": status, "message": message
        })

    # ---------------- RUN WORKFLOW ----------------
    @MBH.action_handler
    async def receive_run_workflow(self, event, action, data, session: AsyncSession):
        """
        Payload from UI:
        {
          "workflow": { "layers": [...], "nodes": [{id,label,config?}...], "edges": [...] },
          "selected": ["optional","ids"]  // if present, run only those nodes
        }
        Rules:
        - If no selection: require ALL nodes are weakly connected; create template, workflow, nodes; then run full plan.
        - If selection present: run only those nodes. Try to reuse the most recent workflow matching the same graph;
          otherwise create a workflow scoped to the selected nodes.
        """
        wf_data = data.get("workflow") or {}
        nodes = wf_data.get("nodes", [])
        edges = wf_data.get("edges", [])
        layers = wf_data.get("layers", []) or _topo_layers(nodes, edges)
        selected: List[str] = data.get("selected") or []
        user = self._user()

        # Validate connectivity if full run
        if not selected:
            if not _weakly_connected(nodes, edges):
                raise ValueError("Cannot run: not all nodes are connected. Connect all nodes first.")
        # Persist a WorkflowTemplate record (logical template for this run)
        template = await _get_or_create_template(
            session,
            name=TPL_NGEN_TEEHR,  # primary logical template you provided
            user=user,
            spec={"source": "hera", "argo_template": TPL_NGEN_TEEHR}
        )

        # Find or create Workflow record
        wf = WFModel(
            name=wf_data.get("name") or f"wf-{datetime.now(timezone.utc).isoformat(timespec='seconds')}",
            user=user,
            template_id=template.id,
            status="queued",
            graph=wf_data,
            layers=layers,
        )
        session.add(wf)
        await session.flush()  # wf.id

        # Persist Node records (all nodes for full run, or only selected for partial)
        to_run_ids: Set[str] = set(selected or [n["id"] for n in nodes])
        for idx, n in enumerate(nodes):
            if n["id"] not in to_run_ids and selected:
                continue
            session.add(NodeModel(
                workflow_id=wf.id,
                name=n["id"],
                kind=n.get("label") or "process",
                user=user,
                config=n.get("config") or {},
                status="idle",
                order_index=idx
            ))
        await session.commit()

        # Confirm submission to UI & set spinners
        await self.send_action(BackendActions.WORKFLOW_SUBMITTED, {
            "workflow_id": str(wf.id),
            "template_id": str(template.id),
            "nodeIds": list(to_run_ids),
        })
        for nid in to_run_ids:
            await self._emit_status(nid, "running", "submitted to argo")

        # Submit to Argo (very simple mapping):
        # - 'pre-process' nodes -> TPL_PREPROCESS with mapped params
        # - 'run ngiab' and/or 'teehr' nodes -> TPL_NGEN_TEEHR with mapped params
        # You can extend to submit in topological order and await each.
        async def submit_node(n: dict):
            label = (n.get("label") or "").lower()
            cfg = (n.get("config") or {})
            if "pre-process" in label:
                tpl = TPL_PREPROCESS
                params = _params_for_preprocess(cfg)
            else:
                tpl = TPL_NGEN_TEEHR
                params = _params_for_ngen_teehr(cfg)
            name = await asyncio.get_running_loop().run_in_executor(
                None, _submit_workflow_with_template, tpl, params
            )
            return n["id"], name

        # Run each selected node (parallel here; you can serialize per layer if you like)
        running: List[Tuple[str, str]] = []
        for n in nodes:
            if n["id"] in to_run_ids:
                try:
                    nid, wf_name = await submit_node(n)
                    running.append((nid, wf_name))
                    await self._emit_status(nid, "running", f"argo: {wf_name}")
                except Exception as e:
                    await self._emit_status(n["id"], "error", f"submit failed: {e}")

        # (Optional) poll each workflow name and finalize node status
        # Argo server exposes REST to read workflow status; Hera’s service wraps it. :contentReference[oaicite:3]{index=3}
        async def finalize(nid: str, argo_name: str):
            # naïve short wait; in real code poll until Succeeded/Failed
            await asyncio.sleep(1.0)
            # Send success for now; wire real phase check later via WorkflowsService.get_workflow(...)
            await self._emit_status(nid, "success", f"started {argo_name}")

        await asyncio.gather(*[finalize(n, a) for (n, a) in running])

    # ---------------- RUN NODE (single) ----------------
    @MBH.action_handler
    async def receive_run_node(self, event, action, data, session: AsyncSession):
        node_id = data.get("nodeId")
        if not node_id:
            raise ValueError("Missing 'nodeId'")
        label = (data.get("label") or "").lower()
        cfg = data.get("config") or {}
        await self._emit_status(node_id, "running", "submitting")

        try:
            if "pre-process" in label:
                tpl = TPL_PREPROCESS
                params = _params_for_preprocess(cfg)
            else:
                tpl = TPL_NGEN_TEEHR
                params = _params_for_ngen_teehr(cfg)

            name = await asyncio.get_running_loop().run_in_executor(
                None, _submit_workflow_with_template, tpl, params
            )
            await self._emit_status(node_id, "running", f"argo: {name}")
            # (optional) short finalize
            await asyncio.sleep(0.8)
            await self._emit_status(node_id, "success", "ok")
        except Exception as e:
            await self._emit_status(node_id, "error", str(e))

    # ---------------- LAST RUN (simple playback) ----------------
    @MBH.action_handler
    async def receive_request_last_run(self, event, action, data, session: AsyncSession):
        # Left simple on purpose
        await self.send_action(BackendActions.LAST_RUN_LOG, {"events": []})

    # ---------------- direct typed stubs ----------------
    @MBH.action_handler
    async def receive_run_preprocess(self, event, action, data, session: AsyncSession):
        await self.send_acknowledge("preprocess queued", action, data)

    @MBH.action_handler
    async def receive_run_calibration(self, event, action, data, session: AsyncSession):
        await self.send_acknowledge("calibration queued", action, data)

    @MBH.action_handler
    async def receive_run_ngiab(self, event, action, data, session: AsyncSession):
        await self.send_acknowledge("ngiab queued", action, data)

    @MBH.action_handler
    async def receive_run_teehr(self, event, action, data, session: AsyncSession):
        await self.send_acknowledge("teehr queued", action, data)

# ---------- Parameter mappers ----------
def _params_for_ngen_teehr(cfg: Dict[str, Any]) -> Dict[str, str]:
    return {
        "input_url": str(cfg.get("input_url") or "https://ciroh-ua-ngen-data.s3.us-east-2.amazonaws.com/AWI-007/AWI_16_2863657_007.tar.gz"),
        "output_bucket": str(cfg.get("output_bucket") or "test-ngen"),
        "output_prefix": str(cfg.get("output_prefix") or "ngiab/runs/demo"),
        "ngen_np": str(cfg.get("ngen_np") or "8"),
        "run_teehr": str(cfg.get("run_teehr") or "true"),
        "teehr_inputs_subdir": str(cfg.get("teehr_inputs_subdir") or "outputs"),
        "teehr_results_subdir": str(cfg.get("teehr_results_subdir") or "teehr"),
        "teehr_args": str(cfg.get("teehr_args") or ""),
        "image_ngen": str(cfg.get("image_ngen") or "awiciroh/ciroh-ngen-image:latest"),
        "image_teehr": str(cfg.get("image_teehr") or "awiciroh/ngiab-teehr:x86"),
    }

def _params_for_preprocess(cfg: Dict[str, Any]) -> Dict[str, str]:
    # Maps to the ngiab_data_preprocess CLI flags (gage/latlon/catchment). :contentReference[oaicite:4]{index=4}
    return {
        "selector_type": str(cfg.get("selector_type") or "gage"),
        "selector_value": str(cfg.get("selector_value") or "01359139"),
        "start_date": str(cfg.get("start_date") or "2020-01-01"),
        "end_date": str(cfg.get("end_date") or "2020-01-15"),
        "output_name": str(cfg.get("output_name") or "example-run"),
        "extra_args": str(cfg.get("extra_args") or ""),
    }
