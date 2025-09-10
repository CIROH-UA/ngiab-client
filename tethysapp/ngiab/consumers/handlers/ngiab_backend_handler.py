# tethysapp/ngiab/consumers/ngiab_backend_handler.py
import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from importlib import resources

from sqlalchemy import select, func
from uuid import UUID
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
    "ngiab-calibration-config": "ngiab-calibration-config.yaml",
    "ngiab-calibration-run": "ngiab-calibration-run.yaml",
    "ngiab-run": "ngiab-run.yaml",
    "ngiab-teehr": "ngiab-teehr.yaml",
    # Dummy variants (update filenames to wherever you ship them)
    "dummy-preprocess": "dummy-preprocess.yaml",
    "dummy-calibration-config": "dummy-calibration-config.yaml",
    "dummy-calibration-run": "dummy-calibration-run.yaml",
    "dummy-run": "dummy-run.yaml",
    "dummy-teehr": "dummy-teehr.yaml",
}

_TERMINAL = {"Succeeded", "Failed", "Error", "Terminated"}


# --- ADD/REPLACE: helpers near your other small helpers ----------------------

def _slug(x: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9\-]+", "-", str(x)).strip("-").lower() or "n"

def _kind_tag(kind_or_label: str) -> str:
    k = (kind_or_label or "").lower()
    # normalize a few variants we've seen in the UI
    if "pre-process" in k or "preprocess" in k:
        return "pre"
    if "calibration-config" in k:
        return "cal_cfg"
    if "calibration-run" in k:
        return "cal_run"
    if "teehr" in k:
        return "teehr"
    if ("ngiab" in k) and ("run" in k):
        return "run"
    return "other"

def _allowed_parent(parent_tag: str, child_tag: str) -> bool:
    # Stage-to-stage rules:
    # pre -> cal_cfg -> cal_run -> run -> teehr
    if child_tag == "cal_cfg":
        return parent_tag == "pre"
    if child_tag == "cal_run":
        return parent_tag == "cal_cfg"
    if child_tag == "run":
        # run can take from cal_run, or (fallbacks) cal_cfg, pre
        return parent_tag in ("cal_run", "cal_cfg", "pre")
    if child_tag == "teehr":
        return parent_tag == "run"
    # default: no constraints
    return True

def _parent_preference_order(tag: str) -> int:
    # Smaller number == stronger preference when multiple valid parents exist
    # Used only for the 'run' stage to choose cal_run over cal_cfg over pre
    order = {"cal_run": 0, "cal_cfg": 1, "pre": 2, "run": 0, "other": 9}
    return order.get(tag, 9)

def _normalize_edges(edges_in) -> list[tuple[str, str]]:
    """Accept either [{'source': 'a', 'target': 'b'}, ...] or [('a','b'), ...]."""
    out: list[tuple[str, str]] = []
    for e in edges_in or []:
        if isinstance(e, dict):
            s, t = e.get("source"), e.get("target")
        elif isinstance(e, (list, tuple)) and len(e) >= 2:
            s, t = e[0], e[1]
        else:
            continue
        if s is not None and t is not None:
            out.append((str(s), str(t)))
    return out

def _topo_layers(nodes: list[dict], edges: list) -> list[list[str]]:
    """Topological layering; edges can be normalized tuples or dicts."""
    # normalize edges first
    e2 = _normalize_edges(edges)
    ids = [str(n["id"]) for n in nodes]
    indeg = {i: 0 for i in ids}
    adj = {i: [] for i in ids}
    for (s, t) in e2:
        if s in adj and t in indeg:
            adj[s].append(t)
            indeg[t] += 1
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
    # Any nodes not reached (e.g. cyclic or isolated) go into a last layer
    if len(seen) != len(ids):
        layers.append([i for i in ids if i not in seen])
    return layers


async def _watch_workflow_nodes(
    self,
    argo_wf_name: str,
    tasks_by_node: dict[str, list[str]],  # {ui_node_id: [tname, ...]}
    wf_id,
) -> None:
    """
    Watch ONE Argo Workflow and fan-out granular node status to the UI:
      - For each UI node, we consider ONLY its own expected task names.
      - success => ALL expected tasks present AND Succeeded.
      - error   => ANY expected task Failed/Error/Terminated.
      - running => otherwise (including when downstream tasks haven't appeared yet).
    If ANY node errors, mark all non-terminal siblings "error" (upstream failure).
    Emit the S3 URL once the aggregate becomes success.
    """
    ws = make_ws()
    loop = asyncio.get_running_loop()
    start = time.monotonic()

    # Canonicalize expected names and provide a resolver for "<dag>.<task>"
    expected_by_node: dict[str, set[str]] = {k: set(v or []) for k, v in tasks_by_node.items()}

    def match_task(node_name: str, expected: set[str]) -> str | None:
        if node_name in expected:
            return node_name
        # DAG tasks typically show as "main.<task>" in NodeStatus.name
        # Only accept exact "<dag>.<task>" matches to avoid cross-node leaks.
        dot = node_name.find(".")
        if dot > 0:
            tail = node_name[dot + 1 :]
            if tail in expected:
                return tail
        return None

    last_sent: dict[str, str] = {}  # ui_node_id -> last ui status
    all_nodes = set(expected_by_node.keys())

    while True:
        try:
            wf = await loop.run_in_executor(None, ws.get_workflow, argo_wf_name, ARGO_NAMESPACE)
            status = getattr(wf, "status", None)
            nodes_map = getattr(status, "nodes", None) or {}
            nodes_iter = nodes_map.values() if isinstance(nodes_map, dict) else (nodes_map or [])

            # Build a quick index of phases keyed by expected task-name per UI node
            phases_by_ui: dict[str, dict[str, str]] = {k: {} for k in expected_by_node}
            for n in nodes_iter:
                nm = getattr(n, "name", None) or (isinstance(n, dict) and n.get("name"))
                ph = getattr(n, "phase", None) or (isinstance(n, dict) and n.get("phase"))
                if not nm or not ph:
                    continue
                nm = str(nm); ph = str(ph)
                for ui_node_id, expected in expected_by_node.items():
                    t = match_task(nm, expected)
                    if t:
                        phases_by_ui[ui_node_id][t] = ph

            # Compute & emit statuses per UI node
            someone_failed = False
            for ui_node_id, expected in expected_by_node.items():
                collected = list(phases_by_ui[ui_node_id].values())
                if any(p in {"Failed", "Error", "Terminated"} for p in collected):
                    ui = "error"
                    someone_failed = True
                elif expected and (len(phases_by_ui[ui_node_id]) == len(expected)) and all(p == "Succeeded" for p in collected):
                    ui = "success"
                else:
                    ui = "running"

                if last_sent.get(ui_node_id) != ui:
                    last_sent[ui_node_id] = ui
                    await _emit_status(self, ui_node_id, ui, ui)
                    SessionFactory = await self.get_sessionmaker()
                    async with SessionFactory() as session:
                        await _update_node_db(session, wf_id, ui_node_id, ui, ui)

            # If a node failed, fail all non-terminal siblings once and stop.
            if someone_failed:
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    rows = (await session.execute(
                        select(NodeModel).where(NodeModel.workflow_id == wf_id)
                    )).scalars().all()
                    for row in rows:
                        if last_sent.get(row.name) not in {"success", "error"}:
                            await _emit_status(self, row.name, "error", "upstream failure")
                            await _update_node_db(session, wf_id, row.name, "error", "upstream failure")
                    await _recompute_workflow_status(session, wf_id)
                return

            # Recompute aggregate; if all succeeded, announce S3 & stop.
            SessionFactory = await self.get_sessionmaker()
            async with SessionFactory() as session:
                agg = await _recompute_workflow_status(session, wf_id)
                if agg == "success":
                    user = _user_id(self)
                    bucket = _bucket()
                    s3url = f"s3://{bucket}/{user}/{wf_id}/"
                    await self.send_action(BackendActions.WORKFLOW_RESULT, {
                        "workflowId": str(wf_id), "s3url": s3url
                    })
                    return

        except Exception as e:
            # Keep polling unless we time out; do NOT flip others to success.
            # We can still emit "running" to the node that last changed if desired,
            # but silence is fine here to avoid noise.
            if time.monotonic() - start > POLL_TIMEOUT_SEC:
                # timeout every non-terminal node
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    for ui_node_id in all_nodes:
                        if last_sent.get(ui_node_id) not in {"success", "error"}:
                            await _emit_status(self, ui_node_id, "error", "poll timeout")
                            await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                return

        await asyncio.sleep(POLL_SEC)



async def _set_workflow_status(session: AsyncSession, wf_id, status: str, touch_last_run: bool = False):
    wf = (await session.execute(select(WFModel).where(WFModel.id == wf_id))).scalar_one_or_none()
    if wf:
        wf.status = status
        if touch_last_run:
            wf.last_run_at = datetime.now(timezone.utc)
        await session.commit()

async def _recompute_workflow_status(session: AsyncSession, wf_id):
    rows = (await session.execute(select(NodeModel.status).where(NodeModel.workflow_id == wf_id))).all()
    statuses = {r[0] for r in rows}
    if not statuses:
        return None
    if "error" in statuses:
        await _set_workflow_status(session, wf_id, "error", touch_last_run=True)
        return "error"
    elif statuses.issubset({"success"}):
        await _set_workflow_status(session, wf_id, "success", touch_last_run=True)
        return "success"
    else:
        await _set_workflow_status(session, wf_id, "running")
        return "running"

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
def _has_edge(edges: List[dict], src: str, dst: str) -> bool:
    return any(e.get("source") == src and e.get("target") == dst for e in (edges or []))

# ---------- S3 helpers ----------
def _parse_s3_url(u: str) -> Tuple[str, str]:
    """Return (bucket, key) for s3://bucket/key...; raises ValueError if malformed."""
    u = (u or "").strip()
    if not u.startswith("s3://"):
        raise ValueError("not an s3:// URL")
    rest = u[5:]
    i = rest.find("/")
    if i <= 0:
        raise ValueError("missing key")
    return rest[:i], rest[i + 1 :].lstrip("/")

# ---------- parameter builders ----------
def _user_id(handler: MBH) -> str:
    u = handler.backend_consumer.scope.get("user")
    return getattr(u, "username", "anonymous")

def _run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

def _bucket() -> str:
    return os.getenv("NGIAB_S3_BUCKET", "test-ngen")

def _kind_to_template(kind: str, mode: str = "real") -> str:
    """Map UI node kind to a WorkflowTemplate name for the selected mode."""
    mode = (mode or "real").lower()
    # Real templates (provided)
    REAL = {
        "pre-process":        "ngiab-data-preprocess",
        "preprocess":         "ngiab-data-preprocess",
        "calibration-config": "ngiab-calibration-config",
        "calibration-run":    "ngiab-calibration-run",
        "run ngiab":          "ngiab-run",
        "teehr":              "ngiab-teehr",
        "default":            "ngiab-run",
    }
    # Dummy templates (adjust names to your cluster if different)
    DUMMY = {
        "pre-process":        "dummy-preprocess",
        "preprocess":         "dummy-preprocess",
        "calibration-config": "dummy-calibration-config",
        "calibration-run":    "dummy-calibration-run",
        "run ngiab":          "dummy-run",
        "teehr":              "dummy-teehr",
        "default":            "dummy-run",
    }
    table = REAL if mode == "real" else DUMMY
    k = (kind or "").lower()
    for key, tpl in table.items():
        if key != "default" and key in k:
            return tpl
    return table["default"]

def _job_root_prefix(user: str, wf_uuid: str) -> str:
    # user/<workflow-uuid>/<argo-job-name>
    # NOTE: {{workflow.name}} is resolved by Argo at runtime.
    return f"{user}/{wf_uuid}/{{{{workflow.name}}}}"


def _params_for(
    kind: str,
    cfg: Dict[str, Any],
    user: str,
    wf_uuid: str,                 # <-- CHANGED: pass workflow UUID instead of run_id for paths
    last_in_chain: bool,
    upstream_key: Optional[str],
    upstream_bucket: Optional[str] = None,
) -> Dict[str, str]:
    bucket = _bucket()

    # Base output path = user/<wf-uuid>/<argo-job-name>
    out_prefix = _job_root_prefix(user, wf_uuid)
    final_prefix = ""             # <- requirement #3: no more /Run/Final/

    k = (kind or "").lower()

    if "pre-process" in k or "preprocess" in k:
        return {
            "output_bucket": str(cfg.get("output_bucket") or bucket),
            "output_prefix": str(cfg.get("output_prefix") or out_prefix),
            "selector_type": str(cfg.get("selector_type") or "gage"),
            "selector_value": str(cfg.get("selector_value") or "01359139"),
            "vpu": str(cfg.get("vpu") or ""),
            "start_date": str(cfg.get("start_date") or "2020-01-01"),
            "end_date": str(cfg.get("end_date") or "2020-01-15"),
            "output_name": str(cfg.get("output_name") or "ngiab"),
            "source": str(cfg.get("source") or "nwm"),
            "debug": str(cfg.get("debug") or "false"),
            "all": str(cfg.get("all") or "false"),
            "subset": str(cfg.get("subset") or "true"),
            "forcings": str(cfg.get("forcings") or "true"),
            "realization": str(cfg.get("realization") or "true"),
            "run": str(cfg.get("run") or "false"),
            "validate": str(cfg.get("validate") or "false"),
        }

    if "calibration-config" in k:
        ibucket = str(cfg.get("input_bucket") or bucket)
        ikey = upstream_key or str(cfg.get("input_key") or cfg.get("input_s3_key") or "")
        if not ikey and cfg.get("input_s3_url"):
            try:
                ibucket, _ikey = _parse_s3_url(str(cfg["input_s3_url"])); ikey = _ikey
            except Exception:
                pass
        ikey = ikey.lstrip("/")
        return {
            "output_bucket": str(cfg.get("output_bucket") or bucket),
            "output_prefix": str(cfg.get("output_prefix") or out_prefix),
            "final_prefix": final_prefix,
            "input_bucket": ibucket,
            "input_key": ikey,
            "input_s3_key": ikey,
            "input_s3_url": str(cfg.get("input_s3_url") or ""),
            "input_subdir": str(cfg.get("input_subdir") or "ngiab"),
            "gage": str(cfg.get("gage") or cfg.get("selector_value") or "01359139"),
            "iterations": str(cfg.get("iterations") or "100"),
            "warmup": str(cfg.get("warmup") or "365"),
            "calibration_ratio": str(cfg.get("calibration_ratio") or "0.5"),
            "force": str(cfg.get("force") or "false"),
            "debug": str(cfg.get("debug") or "false"),
            "vpu": str(cfg.get("vpu") or ""),
        }

    if "calibration-run" in k:
        ibucket = str(cfg.get("input_bucket") or bucket)
        ikey = upstream_key or str(cfg.get("input_key") or cfg.get("input_s3_key") or "")
        if not ikey and cfg.get("input_s3_url"):
            try:
                ibucket, _ikey = _parse_s3_url(str(cfg["input_s3_url"])); ikey = _ikey
            except Exception:
                pass
        ikey = ikey.lstrip("/")
        return {
            "output_bucket": str(cfg.get("output_bucket") or bucket),
            "output_prefix": str(cfg.get("output_prefix") or out_prefix),
            "final_prefix": final_prefix,
            "input_bucket": ibucket,
            "input_key": ikey,
            "input_s3_key": ikey,
            "input_s3_url": str(cfg.get("input_s3_url") or ""),
            "input_subdir": str(cfg.get("input_subdir") or "ngiab"),
        }

    if "run" in k and "ngiab" in k:
        ibucket = str(cfg.get("input_bucket") or bucket)
        ikey = upstream_key or str(cfg.get("input_key") or cfg.get("input_s3_key") or "")
        if not ikey and cfg.get("input_s3_url"):
            try:
                ibucket, _ikey = _parse_s3_url(str(cfg["input_s3_url"])); ikey = _ikey
            except Exception:
                pass
        ikey = ikey.lstrip("/")
        return {
            "output_bucket": str(cfg.get("output_bucket") or bucket),
            "output_prefix": str(cfg.get("output_prefix") or out_prefix),
            "final_prefix": final_prefix,
            "input_bucket": ibucket,
            "input_key": ikey,
            "input_s3_url": str(cfg.get("input_s3_url") or ""),
            "input_subdir": str(cfg.get("input_subdir") or "ngiab"),
            "output_name": str(cfg.get("output_name") or "ngiab"),
            "ngen_np": str(cfg.get("ngen_np") or "8"),
            "image_ngen": str(cfg.get("image_ngen") or "awiciroh/ciroh-ngen-image:latest"),
        }
    if "teehr" in k:
        # derive input bucket/key (from upstream pointer or provided fields)
        ibucket = str(cfg.get("input_bucket") or bucket)
        ikey = upstream_key or str(cfg.get("input_s3_key") or cfg.get("input_key") or "")
        if (not ikey) and cfg.get("input_s3_url"):
            try:
                ibucket, _ikey = _parse_s3_url(str(cfg["input_s3_url"]))
                ikey = _ikey
            except Exception:
                pass
        ikey = ikey.lstrip("/")

        subdir_default = "outputs"
        if upstream_key and not str(upstream_key).endswith("outputs.tgz"):
            subdir_default = f"{cfg.get('input_subdir') or 'ngiab'}/outputs"

        return {
            "output_bucket": str(cfg.get("output_bucket") or upstream_bucket or bucket),
            "output_prefix": str(cfg.get("output_prefix") or out_prefix),
            "final_prefix": final_prefix,
            "input_bucket": ibucket,
            "input_s3_key": ikey,
            "input_s3_url": str(cfg.get("input_s3_url") or ""),
            "teehr_inputs_subdir": str(cfg.get("teehr_inputs_subdir") or subdir_default),  # <— updated default
            "teehr_results_subdir": str(cfg.get("teehr_results_subdir") or "teehr"),
            "teehr_args": str(cfg.get("teehr_args") or ""),
            "image_teehr": str(cfg.get("image_teehr") or "awiciroh/ngiab-teehr:x86"),
        }

    # teehr, default, etc.
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
        actions = {
            "RUN_WORKFLOW": self.receive_run_workflow,
            "RUN_NODE": self.receive_run_node,
            "REQUEST_LAST_RUN": self.receive_request_last_run,
            "LIST_WORKFLOWS": self.receive_list_workflows,
            "GET_WORKFLOW": self.receive_get_workflow,
        }
        # Optional legacy shims
        optional = {
            "RUN_PREPROCESS": "receive_run_preprocess",
            "RUN_CALIBRATION_CONFIG": "receive_run_calibration_config",
            "RUN_CALIBRATION_RUN": "receive_run_calibration_run",
            "RUN_NGIAB": "receive_run_ngiab",
            "RUN_TEEHR": "receive_run_teehr",
        }
        for key, meth in optional.items():
            fn = getattr(self, meth, None)
            if callable(fn):
                actions[key] = fn
        return actions

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
                    SessionFactory = await self.get_sessionmaker()
                    async with SessionFactory() as session:
                        await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                    return
                await asyncio.sleep(POLL_SEC)
                continue

            ui = _phase_to_ui(phase)
            await _emit_status(self, ui_node_id, ui, phase or "Pending")

            SessionFactory = await self.get_sessionmaker()
            async with SessionFactory() as session:
                await _update_node_db(session, wf_id, ui_node_id, ui, f"argo: {argo_wf_name} • {phase or 'Pending'}")
                # reflect overall WF status as nodes move
                await _recompute_workflow_status(session, wf_id)
            if (phase or "Pending") in _TERMINAL:
                return

            if time.monotonic() - start > POLL_TIMEOUT_SEC:
                await _emit_status(self, ui_node_id, "error", "poll timeout")
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                return

            await asyncio.sleep(POLL_SEC)


    async def _poll_tasks_to_terminal(self, argo_wf_name: str, task_names: list[str], ui_node_id: str, wf_id) -> None:
        """
        Poll just THIS UI node's Argo tasks and emit its status:
        - error   -> if ANY task failed/errored/terminated
        - success -> if ALL expected tasks are present AND succeeded
        - running -> otherwise
        On error: fail all non-terminal siblings (upstream failure).
        """
        ws = make_ws()
        loop = asyncio.get_running_loop()
        start = time.monotonic()
        last_sent = None
        failed_broadcast_done = False

        # The exact task names we created in Hera for this UI node (e.g., t-my-node-00, t-my-node-01, …)
        expected = set(task_names or [])
        if not expected:
            # Nothing to track for this node; keep it running until timeout, then error.
            await _emit_status(self, ui_node_id, "running", "no tasks to poll")
        def _canonical_match(nm: str) -> Optional[str]:
            """Return the expected task name t if 'nm' belongs to it (exact or '<dag>.<t>')."""
            if nm in expected:
                return nm
            # DAG nodes typically show as 'main.<task-name>' in NodeStatus.name
            for t in expected:
                if nm.endswith("." + t):
                    return t
            return None

        while True:
            try:
                wf = await loop.run_in_executor(None, ws.get_workflow, argo_wf_name, ARGO_NAMESPACE)
                status = getattr(wf, "status", None)
                nodes_map = getattr(status, "nodes", None) or {}
                nodes_iter = nodes_map.values() if isinstance(nodes_map, dict) else (nodes_map or [])

                # Collect latest phase per expected task (by canonical task-name key)
                phases_by_task: dict[str, str] = {}
                for n in nodes_iter:
                    nm = getattr(n, "name", None) or (isinstance(n, dict) and n.get("name"))
                    ph = getattr(n, "phase", None) or (isinstance(n, dict) and n.get("phase"))
                    if not nm or not ph:
                        continue
                    t = _canonical_match(str(nm))
                    if not t:
                        continue
                    phases_by_task[t] = str(ph)

                # Decide this UI node's status
                collected = list(phases_by_task.values())
                if any(p in {"Failed", "Error", "Terminated"} for p in collected):
                    ui = "error"
                elif expected and (len(phases_by_task) == len(expected)) and all(p == "Succeeded" for p in collected):
                    ui = "success"
                else:
                    ui = "running"

            except Exception as e:
                ui = "running"
                await _emit_status(self, ui_node_id, "running", f"poll error: {e}")
                if time.monotonic() - start > POLL_TIMEOUT_SEC:
                    await _emit_status(self, ui_node_id, "error", "poll timeout")
                    SessionFactory = await self.get_sessionmaker()
                    async with SessionFactory() as session:
                        await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                    return
                await asyncio.sleep(POLL_SEC)
                continue

            # Only emit when the state actually changes
            if ui != last_sent:
                last_sent = ui
                await _emit_status(self, ui_node_id, ui, ui)
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    await _update_node_db(session, wf_id, ui_node_id, ui, ui)

                    # If THIS node failed, mark non-terminal siblings as failed (once).
                    if ui == "error" and not failed_broadcast_done:
                        failed_broadcast_done = True
                        try:
                            rows = (await session.execute(
                                select(NodeModel).where(NodeModel.workflow_id == wf_id)
                            )).scalars().all()
                            for row in rows:
                                if row.name == ui_node_id:
                                    continue
                                if row.status not in {"success", "error"}:
                                    await _emit_status(self, row.name, "error", "upstream failure")
                                    await _update_node_db(session, wf_id, row.name, "error", "upstream failure")
                        except Exception:
                            pass

                    # Update aggregate WF status & emit S3 URL when all are success
                    agg = await _recompute_workflow_status(session, wf_id)
                    if agg == "success":
                        user = _user_id(self)
                        bucket = _bucket()
                        s3url = f"s3://{bucket}/{user}/{wf_id}/"
                        await self.send_action(BackendActions.WORKFLOW_RESULT, {
                            "workflowId": str(wf_id), "s3url": s3url
                        })

            # Stop polling this node when terminal
            if ui in {"error", "success"}:
                return

            if time.monotonic() - start > POLL_TIMEOUT_SEC:
                await _emit_status(self, ui_node_id, "error", "poll timeout")
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                return

            await asyncio.sleep(POLL_SEC)


    # ---------------- helpers ----------------
    # def _ensure_templates_for_nodes(self, nodes: List[dict]) -> None:
    #     needed = {_kind_to_template((n.get("label") or n.get("id") or "")) for n in nodes}
    def _ensure_templates_for_nodes(self, nodes: List[dict], mode: str) -> None:
        needed = {_kind_to_template((n.get("label") or n.get("id") or ""), mode) for n in nodes}
        log.info("[DAG] ensure templates: %s", needed)
        for tpl in needed:
            _ensure_template_exists_or_create(tpl)

# --- REPLACE the whole _build_chain_workflow(...) with the version below -----

    def _build_chain_workflow(
        self,
        chain: list[dict],
        user: str,
        wf_uuid: str,
        edges: list[dict] | None = None,

        mode: str = "real",
    ) -> tuple[Workflow, dict[str, list[str]]]:
        from hera.workflows.models import TemplateRef, Arguments
        def _label(n: dict) -> str:
            return str(n.get("label") or n.get("id") or "").strip()

        def _make_params(node: dict, last_flag: bool, incoming: dict | None, branch: str) -> dict:
            """Build params and append the branch suffix to output/final prefixes."""
            kind = _label(node)
            cfg = (node.get("config") or {})
            upstream_key = None
            if incoming and incoming.get("dataset_bucket") and incoming.get("dataset_key"):
                upstream_key = incoming["dataset_key"]
            upstream_bucket = incoming.get("dataset_bucket") if incoming else None
            params = _params_for(
                kind, cfg, user, wf_uuid, last_in_chain=last_flag,
                upstream_key=upstream_key, upstream_bucket=upstream_bucket
            )
            # If we know the producing bucket/key, set explicit inputs for artifact binding
            if incoming and incoming.get("dataset_bucket") and incoming.get("dataset_key"):
                params.setdefault("input_bucket", incoming["dataset_bucket"])
                params.setdefault("input_key", incoming["dataset_key"])
                params.setdefault("input_s3_key", incoming["dataset_key"])
            # unique branch path for outputs
            base = params.get("output_prefix")
            if base:
                params["output_prefix"] = f"{base.rstrip('/')}/{branch}"
            if params.get("final_prefix"):
                params["final_prefix"] = f"{params['final_prefix'].rstrip('/')}/{branch}"
            return params

        def _dataset_pointer_from_params(kind: str, params: dict, inherit: dict | None = None) -> dict:
            lk = (kind or "").lower()
            inherit = dict(inherit or {})
            if ("preprocess" in lk) or ("pre-process" in lk):
                inherit.update({
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/{params.get('output_name','ngiab')}.tgz",
                })
                return inherit
            if "calibration-config" in lk:
                inherit.update({
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/calibration-prepared.tgz",
                })
                return inherit
            if "calibration-run" in lk:
                inherit.update({
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/calibrated.tgz",
                })
                return inherit
            if (("ngiab" in lk) and ("run" in lk)):
                inherit.update({
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/{params.get('output_name','ngiab')}.tgz",
                })
                return inherit
            if "teehr" in lk:
                # teehr packages into teehr_results.tgz
                inherit.update({
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/teehr_results.tgz",
                })
                return inherit
            return inherit

        ws = make_ws()

        # Keep only nodes provided in 'chain'
        nodes_by_id: dict[str, dict] = {str(n["id"]): n for n in chain}
        node_ids = list(nodes_by_id.keys())

        # Normalize the incoming UI edges to (src, dst)
        norm_edges = _normalize_edges(edges or [])
        log.info("[DAG] UI edges (normalized): %s", norm_edges)

        # Build parents/children maps on the induced subgraph
        parents = {nid: [] for nid in node_ids}
        children = {nid: [] for nid in node_ids}
        for (s, t) in norm_edges:
            if s in nodes_by_id and t in nodes_by_id:
                parents[t].append(s)
                children[s].append(t)

        # Topological order
        topo_layers = _topo_layers([{"id": nid} for nid in node_ids], norm_edges)
        log.info("[DAG] topo layers: %s", topo_layers)

        # Tags by node id
        kind_by_id = {}
        tag_by_id = {}
        for nid, node in nodes_by_id.items():
            k = node.get("label") or node.get("id") or ""
            kind_by_id[nid] = k
            tag_by_id[nid] = _kind_tag(k)

        sinks = {nid for nid in node_ids if not children[nid]}

        def _is_dataset_consumer(tag: str) -> bool:
            return tag in {"cal_cfg", "cal_run", "run", "teehr"}

        with Workflow(generate_name="ngiab-chain-", entrypoint="main", workflows_service=ws) as w:
            tasks_by_node: dict[str, list[str]] = {nid: [] for nid in node_ids}
            with DAG(name="main"):
                instances_by_node: dict[str, list[dict]] = {}

                for layer in topo_layers:
                    for nid in layer:
                        node = nodes_by_id[nid]
                        kind = node.get("label") or node.get("id")
                        tag = tag_by_id[nid]
                        # tpl_name = _kind_to_template(kind)
                        tpl_name = _kind_to_template(kind, mode)
                        _ensure_template_exists_or_create(tpl_name)

                        is_last = nid in sinks
                        raw_parents = parents.get(nid, [])
                        valid_parent_ids = [pid for pid in raw_parents if _allowed_parent(tag_by_id[pid], tag)]
                        if tag == "run" and len(valid_parent_ids) > 1:
                            valid_parent_ids.sort(key=lambda x: _parent_preference_order(tag_by_id[x]))

                        parent_instances: list[dict] = []
                        for pid in valid_parent_ids:
                            parent_instances.extend(instances_by_node.get(pid, []))

                        created: list[dict] = []
                        if parent_instances and _is_dataset_consumer(tag):
                            # fan-out
                            for idx, pinst in enumerate(parent_instances):
                                tname = f"t-{_slug(kind)}-{_slug(nid)}-{idx:02d}"
                                params = _make_params(node, is_last, incoming=pinst, branch=tname)
                                Task(
                                    name=tname,
                                    template_ref=TemplateRef(name=tpl_name, template="main"),
                                    arguments=Arguments(parameters=[Parameter(name=k, value=v) for k, v in params.items()]),
                                    dependencies=[pinst["task"]],
                                )
                                tasks_by_node[nid].append(tname)
                                pointer = _dataset_pointer_from_params(kind, params, inherit=pinst)
                                pointer.update({"task": tname, "kind": kind, "tag": tag})
                                created.append(pointer)
                        else:
                            # single instance (optional fan-in)
                            dep_names = []
                            for pid in valid_parent_ids:
                                for pi in instances_by_node.get(pid, []):
                                    dep_names.append(pi["task"])
                            tname = f"t-{_slug(kind)}-{_slug(nid)}-00"
                            incoming = parent_instances[0] if len(parent_instances) == 1 else None
                            params = _make_params(node, is_last, incoming=incoming, branch=tname)
                            Task(
                                name=tname,
                                template_ref=TemplateRef(name=tpl_name, template="main"),
                                arguments=Arguments(parameters=[Parameter(name=k, value=v) for k, v in params.items()]),
                                dependencies=dep_names or None,
                            )
                            tasks_by_node[nid].append(tname)
                            pointer = _dataset_pointer_from_params(kind, params, inherit=incoming or {})
                            pointer.update({"task": tname, "kind": kind, "tag": tag})
                            created.append(pointer)

                        instances_by_node[nid] = created

        return w, tasks_by_node


    @MBH.action_handler
    async def receive_get_workflow(self, event, action, data, session: AsyncSession):
        """Return {nodes, edges} for a workflow id. Falls back to Node rows if graph is missing."""
        from ..backend_actions import BackendActions
        wf_id = (data or {}).get("id") or (data or {}).get("workflowId")
        if not wf_id:
            raise ValueError("Missing workflow 'id'")

        wf = (await session.execute(select(WFModel).where(WFModel.id == wf_id).limit(1))).scalar_one_or_none()
        if not wf:
            raise ValueError("Workflow not found")

        nodes, edges = [], []
        if wf.graph and isinstance(wf.graph, dict):
            nodes = list(wf.graph.get("nodes") or [])
            edges = list(wf.graph.get("edges") or [])
        else:
            # Fallback: reconstruct nodes from Node table; edges unknown
            nrows = (await session.execute(select(NodeModel).where(NodeModel.workflow_id == wf.id))).scalars().all()
            nodes = [{"id": n.name, "label": n.kind, "config": n.config or {}, "status": n.status} for n in nrows]
            edges = []

        payload = {
            "workflow": {"id": wf.id, "name": wf.name, "status": wf.status},
            "nodes": nodes,
            "edges": edges,
            "count": {"nodes": len(nodes), "edges": len(edges)},
        }
        await self.send_action(BackendActions.WORKFLOW_GRAPH, payload)

    @MBH.action_handler
    async def receive_list_workflows(self, event, action, data, session: AsyncSession):
        """Return the current user's workflows for the dropdown."""
        try:
            user = self.backend_consumer.scope.get("user")
            username = getattr(user, "username", None)
            
            from sqlalchemy import desc
            from sqlalchemy.sql import nulls_last
            q = (
                select(WFModel)
                .order_by(
                    nulls_last(desc(WFModel.last_run_at)),
                    desc(WFModel.created_at),
                )
                .limit(1000)
            )            
            if username:
                q = q.where(WFModel.user == username)
            rows = (await session.execute(q)).scalars().all()


            items = [{
                "id": w.id,
                "name": w.name,
                "status": w.status,
                "created_at": w.created_at.isoformat() if w.created_at else None,
                "updated_at": w.updated_at.isoformat() if w.updated_at else None,
                "last_run_at": w.last_run_at.isoformat() if w.last_run_at else None,
            } for w in rows]


            await self.send_action(BackendActions.WORKFLOWS_LIST, {"items": items, "count": len(items)})
        except Exception as e:
            await self.send_error(f"Failed to list workflows: {e}", action, data)


    # ---------------- RUN WORKFLOW ----------------
    @MBH.action_handler
    async def receive_run_workflow(self, event, action, data, session: AsyncSession):
        wf_data = data.get("workflow") or {}
        selected_wf_id = data.get("workflowId")
        nodes = wf_data.get("nodes", [])
        edges = wf_data.get("edges", [])
        mode  = (data or {}).get("mode") or "real"
        selected_ids: List[str] = data.get("selected") or []
        user = _user_id(self)
        run_id = _run_id()

        # Working set = selected nodes or all nodes
        selected_set = set(selected_ids) if selected_ids else set(n["id"] for n in nodes)
        if not selected_set:
            await self.send_action(BackendActions.NODE_STATUS, {"nodeId": "", "status": "error", "message": "Nothing selected to run."})
            return

        # Induced subgraph of selected nodes
        nodes_by_id = {n["id"]: n for n in nodes if n["id"] in selected_set}
        edges_sub = [e for e in edges if e.get("source") in nodes_by_id and e.get("target") in nodes_by_id]
        if not nodes_by_id:
            await self.send_action(BackendActions.NODE_STATUS, {"nodeId": "", "status": "error", "message": "No valid nodes in selection."})
            return

        def _kind(n: dict) -> str:
            return (n.get("label") or n.get("id") or "").lower()

        def _is_dataset_consumer(n: dict) -> bool:
            k = _kind(n)
            return (
                ("calibration-config" in k)
                or ("calibration-run" in k)
                or ("ngiab" in k and "run" in k)
                or ("teehr" in k)                # <-- add this
            )

        # Build parent adjacency on the induced subgraph
        parents: dict[str, list[str]] = {nid: [] for nid in nodes_by_id}
        for e in edges_sub:
            parents[e["target"]].append(e["source"])

        # Collect all sinks that are dataset consumers
        sink_ids = [nid for nid, n in nodes_by_id.items() if _is_dataset_consumer(n)]

        # If there are no consumer sinks selected, fall back to all selected nodes (still runs parallel/independent)
        keep: set[str] = set()
        if sink_ids:
            # For each sink, collect all ancestors (pre-process, etc.) + the sink itself
            for sid in sink_ids:
                stack = [sid]
                while stack:
                    cur = stack.pop()
                    if cur in keep:
                        continue
                    keep.add(cur)
                    stack.extend(parents.get(cur, []))
        else:
            keep = set(nodes_by_id.keys())

        chain_nodes = [nodes_by_id[i] for i in keep]
        edges_kept = [e for e in edges_sub if e["source"] in keep and e["target"] in keep]

        # Ensure templates exist for everything we’re about to run
        # self._ensure_templates_for_nodes(chain_nodes)
        self._ensure_templates_for_nodes(chain_nodes, mode)

        # Reuse selected workflow row if provided; else create a new one
        wt_row = await self._get_or_create_template_row(session, "ngiab-chain", user, {"source": "yaml"})
        wf_row = None
        if selected_wf_id:
            try:
                wf_row = (await session.execute(
                    select(WFModel).where(WFModel.id == UUID(str(selected_wf_id)))
                )).scalar_one_or_none()
            except Exception:
                wf_row = None
        if wf_row:
            wf_row.graph = {"nodes": chain_nodes, "edges": edges_kept}
            wf_row.template_id = wt_row.id
            wf_row.status = "queued"
            await session.commit()
            # clear old node rows and re-seed in the stored order
            await session.execute(NodeModel.__table__.delete().where(NodeModel.workflow_id == wf_row.id))
            await session.commit()
        else:
            wf_row = WFModel(
                name=wf_data.get("name") or f"wf-{run_id}",
                user=user,
                template_id=wt_row.id,
                status="queued",
                graph={"nodes": chain_nodes, "edges": edges_kept},
                layers=[],
            )
            session.add(wf_row)
            await session.flush()


        for order, node in enumerate(chain_nodes):
            label = node.get("label") or node.get("id")
            node_id = node.get("id") or (node.get("label") or "")
            session.add(NodeModel(
                workflow_id=wf_row.id,
                name=node_id,
                kind=label,
                user=user,
                config=node.get("config") or {},
                status="idle",
                order_index=order,
            ))
        await session.commit()

        # optimistic UI updates
        for node in chain_nodes:
            node_id = node.get("id") or (node.get("label") or "")
            await _emit_status(self, node_id, "running", "submitting")

        # Build the DAG with fan-out semantics (per-parent instances) and submit
        try:
            # w, tasks_by_node = self._build_chain_workflow(chain_nodes, user, wf_uuid=str(wf_row.id), edges=edges_kept)
            w, tasks_by_node = self._build_chain_workflow(
                chain_nodes, user, wf_uuid=str(wf_row.id), edges=edges_kept, mode=mode
            )            
            w.create()
            # mark the workflow row as running and set last_run_at
            await _set_workflow_status(session, wf_row.id, "running", touch_last_run=True)
            
            # Notify the UI that this Argo Workflow name backs all nodes...
            for node in chain_nodes:
                node_id = node.get("id") or (node.get("label") or "")
                await _emit_status(self, node_id, "running", f"argo: {w.name}")
            # ...then start ONE watcher that attributes phases to the right UI node
            asyncio.create_task(_watch_workflow_nodes(self, w.name, tasks_by_node, wf_row.id))


        except Exception as e:
            for node in chain_nodes:
                node_id = node.get("id") or (node.get("label") or "")
                await _emit_status(self, node_id, "error", f"submit failed: {e}")
                await _update_node_db(session, wf_row.id, node_id, "error", f"submit failed: {e}")

        # Optionally run *other* selected nodes that are totally disconnected from the kept subgraph
        other_ids = selected_set - keep
        for n in nodes:
            if n["id"] in other_ids:
                await self.receive_run_node(event, action, {"nodeId": n["id"], "label": n.get("label"), "config": n.get("config") or {}})



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

        # normalize S3 URL for single-node calibration runs
        if "input_s3_url" in cfg and (("input_bucket" not in cfg) or ("input_key" not in cfg)):
            try:
                b, k = _parse_s3_url(str(cfg["input_s3_url"]))
                cfg.setdefault("input_bucket", b)
                cfg.setdefault("input_key", k.lstrip("/"))
                cfg.setdefault("input_s3_key", k.lstrip("/"))
            except Exception:
                pass
        if "input_key" in cfg and isinstance(cfg["input_key"], str):
            cfg["input_key"] = cfg["input_key"].lstrip("/")

        if "input_s3_key" in cfg and isinstance(cfg["input_s3_key"], str):
            cfg["input_s3_key"] = cfg["input_s3_key"].lstrip("/")

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
            # update database status for this node
            await _update_node_db(session, wf.id, node_id, "error", f"template error: {e}")
            return

        params = _params_for(
            kind, cfg, user, str(wf.id),      # <-- wf_uuid
            last_in_chain=True,
            upstream_key=cfg.get("input_s3_key") or cfg.get("input_key"),
        )
        ws = make_ws()
        try:
            with Workflow(
                generate_name=f"{tpl}-",
                entrypoint="main",
                workflow_template_ref=WorkflowTemplateRef(name=tpl),
                workflows_service=ws,
            ) as w:
                w.arguments = [Parameter(name=k, value=v) for k, v in params.items()]
            w.create()
            await _set_workflow_status(session, wf.id, "running", touch_last_run=True)
            await _emit_status(self, node_id, "running", f"argo: {w.name}")
            asyncio.create_task(self._poll_argo_to_terminal(w.name, node_id, wf.id))
        except Exception as e:
            await _emit_status(self, node_id, "error", f"submit failed: {e}")
            # update database status for this node
            await _update_node_db(session, wf.id, node_id, "error", f"submit failed: {e}")
            return

    # ---------------- Playback stub ----------------
    @MBH.action_handler
    async def receive_request_last_run(self, event, action, data, session: AsyncSession):
        await self.send_action(BackendActions.LAST_RUN_LOG, {"events": []})

    # -------- Legacy shims (optional) --------
    async def receive_run_preprocess(self, event, action, data):
        cfg = (data or {}).get("config") or data or {}
        return await self.receive_run_node(
            event, action,
            {"nodeId": "pre-process", "label": "pre-process", "config": cfg}
        )

    async def receive_run_calibration_config(self, event, action, data):
        cfg = (data or {}).get("config") or data or {}
        return await self.receive_run_node(
            event, action,
            {"nodeId": "calibration-config", "label": "calibration-config", "config": cfg}
        )

    async def receive_run_calibration_run(self, event, action, data):
        cfg = (data or {}).get("config") or data or {}
        return await self.receive_run_node(
            event, action,
            {"nodeId": "calibration-run", "label": "calibration-run", "config": cfg}
        )

    async def receive_run_ngiab(self, event, action, data):
        cfg = (data or {}).get("config") or data or {}
        return await self.receive_run_node(
            event, action,
            {"nodeId": "ngiab-run", "label": "ngiab run", "config": cfg}
        )

    async def receive_run_teehr(self, event, action, data):
        cfg = (data or {}).get("config") or data or {}
        return await self.receive_run_node(
            event, action,
            {"nodeId": "teehr", "label": "teehr", "config": cfg}
        )

