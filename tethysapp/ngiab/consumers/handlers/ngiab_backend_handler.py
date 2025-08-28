import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from importlib import resources

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hera.workflows import Workflow, WorkflowTemplate, DAG, Task, Parameter, WorkflowsService
from hera.workflows.models import WorkflowTemplateRef, TemplateRef, Arguments
from hera.shared import global_config

from ..backend_actions import BackendActions
from .model_run_handler import ModelBackendHandler as MBH
from ...model import Workflow as WFModel, Node as NodeModel, WorkflowTemplate as WTModel

log = logging.getLogger(__name__)

# ---------- Argo / Hera config ----------
ARGO_HOST = os.getenv("ARGO_HOST", "https://localhost:2746")
ARGO_TOKEN = os.getenv("ARGO_TOKEN", "")
ARGO_NAMESPACE = os.getenv("ARGO_NAMESPACE", "argo")
ARGO_VERIFY_SSL = os.getenv("ARGO_VERIFY_SSL", "false").lower() in ("1", "true", "yes")
ARGO_FORCE_TEMPLATE_UPDATE = os.getenv("ARGO_FORCE_TEMPLATE_UPDATE", "false").lower() in ("1", "true", "yes")

POLL_SEC = float(os.getenv("ARGO_POLL_SEC", "3.0"))
POLL_TIMEOUT_SEC = float(os.getenv("ARGO_POLL_TIMEOUT_SEC", "21600"))  # 6h

_TEMPLATE_FILES = {
    "ngiab-data-preprocess": "ngiab-data-preprocess.yaml",
    "ngiab-calibration": "ngiab-calibration.yaml",
    "ngiab-run": "ngiab-run.yaml",
    "ngiab-teehr": "ngiab-teehr.yaml",
}

_TERMINAL = {"Succeeded", "Failed", "Error", "Terminated"}


def _phase_to_ui(phase: str | None) -> str:
    p = (phase or "").strip() or "Pending"
    if p == "Succeeded":
        return "success"
    if p in {"Failed", "Error", "Terminated"}:
        return "error"
    return "running"


def make_ws() -> WorkflowsService:
    global_config.host = ARGO_HOST
    global_config.token = ARGO_TOKEN
    global_config.namespace = ARGO_NAMESPACE
    global_config.verify_ssl = ARGO_VERIFY_SSL
    return WorkflowsService(
        host=ARGO_HOST,
        token=ARGO_TOKEN,
        namespace=ARGO_NAMESPACE,
        verify_ssl=ARGO_VERIFY_SSL,
    )


# ---------- template upsert helpers ----------
def _load_template_yaml_text(name: str) -> str:
    pkg = "tethysapp.ngiab.consumers.templates"
    filename = _TEMPLATE_FILES.get(name)
    if not filename:
        raise ValueError(f"No YAML file mapped for template '{name}'")
    with resources.files(pkg).joinpath(filename).open("r", encoding="utf-8") as f:
        return f.read()


def _ensure_template_exists_or_create(name: str) -> None:
    ws = make_ws()
    try:
        exists = True
        try:
            ws.get_workflow_template(name=name, namespace=ARGO_NAMESPACE)
        except Exception:
            exists = False

        if exists and not ARGO_FORCE_TEMPLATE_UPDATE:
            return

        if exists and ARGO_FORCE_TEMPLATE_UPDATE:
            try:
                ws.delete_workflow_template(name=name, namespace=ARGO_NAMESPACE)
                log.info("Deleted existing WorkflowTemplate '%s' for update.", name)
            except Exception as e:
                log.warning("Could not delete WorkflowTemplate '%s': %s", name, e)

        yaml_text = _load_template_yaml_text(name)
        wt = WorkflowTemplate.from_yaml(yaml_text)
        wt.create()
        log.info("Created/updated WorkflowTemplate '%s'.", name)
    except Exception as e:
        msg = str(e)
        if "already exists" in msg or "409" in msg:
            log.info("Template '%s' exists (409), continuing.", name)
            return
        raise ValueError(
            f"Template check failed: Could not verify or create WorkflowTemplate "
            f"'{name}' in namespace '{ARGO_NAMESPACE}': {e}"
        ) from e


# ---------- small graph helpers ----------
def _weakly_connected(nodes: List[dict], edges: List[dict]) -> bool:
    if not nodes:
        return False
    ids = [n["id"] for n in nodes]
    idx = {i: k for k, i in enumerate(ids)}
    adj = [[] for _ in ids]
    for e in edges or []:
        if e["source"] in idx and e["target"] in idx:
            a, b = idx[e["source"]], idx[e["target"]]
            adj[a].append(b)
            adj[b].append(a)
    seen = {0}
    stack = [0]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return len(seen) == len(ids)


def _topo_layers(nodes: List[dict], edges: List[dict]) -> List[List[str]]:
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
        layers.append([i for i in ids if i not in seen])
    return layers


# ---------- parameter builders ----------
def _user_id(handler: MBH) -> str:
    u = handler.backend_consumer.scope.get("user")
    return getattr(u, "username", "anonymous")


def _run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _bucket() -> str:
    return os.getenv("NGIAB_S3_BUCKET", "test-ngen")


def _kind_to_template(kind: str) -> str:
    k = (kind or "").lower()
    if "pre-process" in k or "preprocess" in k:
        return "ngiab-data-preprocess"
    if "calibration" in k:
        return "ngiab-calibration"
    if "run" in k and "ngiab" in k:
        return "ngiab-run"
    if "teehr" in k:
        return "ngiab-teehr"
    return "ngiab-run"


def _intermediate_prefix(user: str, run_id: str, kind: str) -> str:
    safe = kind.replace(" ", "-").lower()
    return f"{user}/Run/intermediate/{safe}/{run_id}"


def _final_prefix(user: str, run_id: str, kind: str) -> str:
    safe = kind.replace(" ", "-").lower()
    return f"{user}/Run/Final/{safe}/{run_id}"


def _params_for(kind: str, cfg: Dict[str, Any], user: str, run_id: str, last_in_chain: bool, upstream_key: str | None) -> Dict[str, str]:
    bucket = _bucket()
    out_prefix = _intermediate_prefix(user, run_id, kind)
    final_prefix = _final_prefix(user, run_id, kind) if last_in_chain else ""

    k = (kind or "").lower()
    if "pre-process" in k or "preprocess" in k:
        return {
            "output_bucket": bucket,
            "output_prefix": out_prefix,
            "selector_type": str(cfg.get("selector_type") or "gage"),
            "selector_value": str(cfg.get("selector_value") or "01359139"),
            "start_date": str(cfg.get("start_date") or "2020-01-01"),
            "end_date": str(cfg.get("end_date") or "2020-01-15"),
            "output_name": str(cfg.get("output_name") or "ngiab"),
            "source": str(cfg.get("source") or "nwm"),
            "debug": str(cfg.get("debug") or "false"),
        }

    if "calibration" in k:
        return {
            "output_bucket": bucket,
            "output_prefix": out_prefix,
            "final_prefix": final_prefix,
            "input_s3_key": upstream_key or str(cfg.get("input_s3_key") or ""),
            "gage": str(cfg.get("gage") or cfg.get("selector_value") or "01359139"),
            "iterations": str(cfg.get("iterations") or "100"),
            "warmup": str(cfg.get("warmup") or "365"),
            "calibration_ratio": str(cfg.get("calibration_ratio") or "0.5"),
            "force": str(cfg.get("force") or "false"),
            "run": str(cfg.get("run") or "false"),
            "debug": str(cfg.get("debug") or "false"),
        }

    if "run" in k and "ngiab" in k:
        return {
            "output_bucket": bucket,
            "output_prefix": out_prefix,
            "final_prefix": final_prefix,
            "input_s3_key": upstream_key or str(cfg.get("input_s3_key") or ""),
            "ngen_np": str(cfg.get("ngen_np") or "8"),
            "image_ngen": str(cfg.get("image_ngen") or "awiciroh/ciroh-ngen-image:latest"),
        }

    if "teehr" in k:
        return {
            "output_bucket": bucket,
            "output_prefix": out_prefix,
            "final_prefix": final_prefix,
            "input_s3_key": upstream_key or str(cfg.get("input_s3_key") or ""),
            "teehr_inputs_subdir": str(cfg.get("teehr_inputs_subdir") or "outputs"),
            "teehr_results_subdir": str(cfg.get("teehr_results_subdir") or "teehr"),
            "teehr_args": str(cfg.get("teehr_args") or ""),
            "image_teehr": str(cfg.get("image_teehr") or "awiciroh/ngiab-teehr:x86"),
        }

    return {"output_bucket": bucket, "output_prefix": out_prefix, "final_prefix": final_prefix}


# ---------- status helpers ----------
async def _emit_status(handler: MBH, node_id: str, status: str, message: str = ""):
    await handler.send_action(BackendActions.NODE_STATUS, {"nodeId": node_id, "status": status, "message": message})


async def _update_node_db(session: AsyncSession, wf_id, node_name: str, status: str, message: str = ""):
    node = (
        await session.execute(
            select(NodeModel).where(NodeModel.workflow_id == wf_id, NodeModel.name == node_name)
        )
    ).scalar_one_or_none()
    if node:
        node.status = status
        node.message = message
        node.updated_at = datetime.now(timezone.utc)
        await session.commit()


class NgiabBackendHandler(MBH):
    @property
    def receiving_actions(self) -> dict[str, callable]:
        return {
            "RUN_WORKFLOW": self.receive_run_workflow,
            "RUN_NODE": self.receive_run_node,
            "REQUEST_LAST_RUN": self.receive_request_last_run,

            # if you still keep these stubs, expose them as strings too
            "RUN_PREPROCESS": self.receive_run_preprocess,
            "RUN_CALIBRATION": self.receive_run_calibration,
            "RUN_NGIAB": self.receive_run_ngiab,
            "RUN_TEEHR": self.receive_run_teehr,
        }

    # ---------------- polling ----------------
    async def _poll_argo_to_terminal(self, argo_wf_name: str, ui_node_id: str, wf_id) -> None:
        ws = make_ws()
        loop = asyncio.get_running_loop()
        start = time.monotonic()

        while True:
            try:
                wf = await loop.run_in_executor(None, ws.get_workflow, argo_wf_name, ARGO_NAMESPACE)
                phase = getattr(getattr(wf, "status", None), "phase", None)
            except Exception as e:
                await _emit_status(self, ui_node_id, "running", f"poll error: {e}")
                if time.monotonic() - start > POLL_TIMEOUT_SEC:
                    await _emit_status(self, ui_node_id, "error", "poll timeout")
                    return
                await asyncio.sleep(POLL_SEC)
                continue

            ui = _phase_to_ui(phase)
            await _emit_status(self, ui_node_id, ui, phase or "Pending")

            SessionFactory = await self.get_sessionmaker()
            async with SessionFactory() as session:
                await _update_node_db(session, wf_id, ui_node_id, ui, f"argo: {argo_wf_name} • {phase or 'Pending'}")

            if (phase or "Pending") in _TERMINAL:
                return

            if time.monotonic() - start > POLL_TIMEOUT_SEC:
                await _emit_status(self, ui_node_id, "error", "poll timeout")
                return

            await asyncio.sleep(POLL_SEC)

    # ---------------- helpers ----------------
    def _ensure_templates_for_nodes(self, nodes: List[dict]) -> None:
        needed = {_kind_to_template((n.get("label") or n.get("id") or "")) for n in nodes}
        for tpl in needed:
            _ensure_template_exists_or_create(tpl)

def _build_chain_workflow(self, chain: List[dict], user: str, run_id: str) -> Workflow:
    """
    Build a DAG workflow with templateRef tasks for the ordered nodes in `chain`.
    NOTE: dependencies must be names (strings), and task names must NOT start with a digit.
    """
    ws = make_ws()
    with Workflow(
        generate_name="ngiab-chain-",
        entrypoint="main",
        workflows_service=ws,
    ) as w:
        # harmless defaults; our templates take params from Arguments we pass per-task
        w.arguments = [
            Parameter(name="output_bucket", value=_bucket()),
            Parameter(name="output_prefix", value=f"{user}/Run/{run_id}"),
        ]

        with DAG(name="main"):
            upstream_key = None
            prev_name: str | None = None

            for i, n in enumerate(chain):
                kind = n.get("label") or n.get("id")
                tpl_name = _kind_to_template(kind)
                last = (i == len(chain) - 1)

                _ensure_template_exists_or_create(tpl_name)

                params = _params_for(kind, n.get("config") or {}, user, run_id, last, upstream_key)

                # Compute default downstream key mapping
                lk = (kind or "").lower()
                if "pre-process" in lk or "preprocess" in lk:
                    upstream_key = f"{params['output_prefix']}/preprocess.tgz"
                elif "calibration" in lk:
                    upstream_key = f"{params['output_prefix']}/calibrated.tgz"
                elif "run" in lk and "ngiab" in lk:
                    upstream_key = f"{params['output_prefix']}/outputs.tgz"
                elif "teehr" in lk:
                    upstream_key = f"{params['output_prefix']}/teehr_results.tgz"
                else:
                    upstream_key = None

                if upstream_key and "input_s3_key" not in params:
                    params["input_s3_key"] = upstream_key

                # ✅ Argo requires task names not to start with a digit when dependencies are used
                task_name = f"step-{i:02d}-{tpl_name}"

                Task(
                    name=task_name,
                    template_ref=TemplateRef(name=tpl_name, template="main"),
                    arguments=Arguments(parameters=[Parameter(name=k, value=v) for k, v in params.items()]),
                    dependencies=[prev_name] if prev_name else None,
                )
                prev_name = task_name

    return w

    # ---------------- RUN WORKFLOW ----------------
    @MBH.action_handler
    async def receive_run_workflow(self, event, action, data, session: AsyncSession):
        wf_data = data.get("workflow") or {}
        nodes = wf_data.get("nodes", [])
        edges = wf_data.get("edges", [])
        selected_ids: List[str] = data.get("selected") or []
        user = _user_id(self)
        run_id = _run_id()

        if not selected_ids and not _weakly_connected(nodes, edges):
            raise ValueError("Cannot run: not all nodes are connected. Connect all nodes first.")

        order = [nid for layer in _topo_layers(nodes, edges) for nid in layer]
        id_to_node = {n["id"]: n for n in nodes}
        chain = [id_to_node[i] for i in order if (not selected_ids or i in selected_ids)]

        if not chain:
            # nothing to do; surface a friendly message
            await self.send_action(BackendActions.NODE_STATUS, {"nodeId": "", "status": "error", "message": "Nothing selected to run."})
            return

        self._ensure_templates_for_nodes(chain)

        wt_row = await self._get_or_create_template_row(session, "ngiab-chain", user, {"source": "yaml"})
        wf_row = WFModel(
            name=wf_data.get("name") or f"wf-{run_id}",
            user=user,
            template_id=wt_row.id,
            status="queued",
            graph=wf_data,
            layers=_topo_layers(nodes, edges),
        )
        session.add(wf_row)
        await session.flush()

        for idx, n in enumerate(chain):
            session.add(
                NodeModel(
                    workflow_id=wf_row.id,
                    name=n["id"],
                    kind=n.get("label") or "process",
                    user=user,
                    config=n.get("config") or {},
                    status="idle",
                    order_index=idx,
                )
            )
        await session.commit()

        for n in chain:
            await _emit_status(self, n["id"], "running", "submitting")

        w = self._build_chain_workflow(chain, user, run_id)
        try:
            log.info("Submitting chain workflow...")
            w.create()
            log.info("Submitted workflow: %s", w.name)
            # tell UI immediately
            for n in chain:
                await _emit_status(self, n["id"], "running", f"argo: {w.name}")
        except Exception as e:
            for n in chain:
                await _emit_status(self, n["id"], "error", f"submit failed: {e}")
            return

        argo_name = w.name
        for n in chain:
            asyncio.create_task(self._poll_argo_to_terminal(argo_name, n["id"], wf_row.id))

    async def _get_or_create_template_row(self, session: AsyncSession, name: str, user: str, spec: dict | None):
        existing = (await session.execute(select(WTModel).where(WTModel.name == name).limit(1))).scalar_one_or_none()
        if existing:
            return existing
        wt_row = WTModel(name=name, user=user, spec=spec or {})
        session.add(wt_row)
        await session.commit()
        await session.refresh(wt_row)
        return wt_row

    # ---------------- RUN NODE (single) ----------------
    @MBH.action_handler
    async def receive_run_node(self, event, action, data, session: AsyncSession):
        node_id = data.get("nodeId")
        if not node_id:
            raise ValueError("Missing 'nodeId'")
        kind = (data.get("label") or "process")
        cfg = data.get("config") or {}
        user = _user_id(self)
        run = _run_id()

        wf = WFModel(
            name=f"ad-hoc-{run}",
            user=user,
            status="queued",
            graph={"nodes": [{"id": node_id, "label": kind, "config": cfg}], "edges": []},
            layers=[[node_id]],
        )
        session.add(wf)
        await session.flush()
        session.add(NodeModel(workflow_id=wf.id, name=node_id, kind=kind, user=user, config=cfg, status="idle"))
        await session.commit()

        await _emit_status(self, node_id, "running", "submitting")

        tpl = _kind_to_template(kind)
        try:
            _ensure_template_exists_or_create(tpl)
        except Exception as e:
            await _emit_status(self, node_id, "error", f"template error: {e}")
            return

        params = _params_for(kind, cfg, user, run, last_in_chain=True, upstream_key=cfg.get("input_s3_key"))

        ws = make_ws()
        try:
            with Workflow(
                generate_name=f"{tpl}-",
                workflow_template_ref=WorkflowTemplateRef(name=tpl),
                workflows_service=ws,
            ) as w:
                w.arguments = [Parameter(name=k, value=v) for k, v in params.items()]
            w.create()
            await _emit_status(self, node_id, "running", f"argo: {w.name}")
            asyncio.create_task(self._poll_argo_to_terminal(w.name, node_id, wf.id))
        except Exception as e:
            await _emit_status(self, node_id, "error", f"submit failed: {e}")

    # ---------------- Playback stub ----------------
    @MBH.action_handler
    async def receive_request_last_run(self, event, action, data, session: AsyncSession):
        await self.send_action(BackendActions.LAST_RUN_LOG, {"events": []})
