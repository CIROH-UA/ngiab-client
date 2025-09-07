# tethysapp/ngiab/consumers/ngiab_backend_handler.py
import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
    "ngiab-calibration-config": "ngiab-calibration-config.yaml",
    "ngiab-calibration-run": "ngiab-calibration-run.yaml",
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
def _has_edge(edges: List[dict], src: str, dst: str) -> bool:
    return any(e.get("source") == src and e.get("target") == dst for e in (edges or []))

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

def _kind_to_template(kind: str) -> str:
    k = (kind or "").lower()
    if "pre-process" in k or "preprocess" in k:
        return "ngiab-data-preprocess"
    if "calibration-config" in k:
        return "ngiab-calibration-config"    
    if "calibration-run" in k:
        return "ngiab-calibration-run"
    if "run" in k and "ngiab" in k:
        return "ngiab-run"
    if "teehr" in k:
        return "ngiab-teehr"
    return "ngiab-run"

def _job_root_prefix(user: str, wf_uuid: str) -> str:
    # user/<workflow-uuid>/<argo-job-name>
    # NOTE: {{workflow.name}} is resolved by Argo at runtime.
    return f"{user}/{wf_uuid}/{{{{workflow.name}}}}"


def _intermediate_prefix(user: str, wf_uuid: str, _kind: str) -> str:
    return _job_root_prefix(user, wf_uuid)

def _final_prefix(_user: str, _wf_uuid: str, _kind: str) -> str:
    # no longer used
    return ""

def _params_for(
    kind: str,
    cfg: Dict[str, Any],
    user: str,
    wf_uuid: str,                 # <-- CHANGED: pass workflow UUID instead of run_id for paths
    last_in_chain: bool,
    upstream_key: Optional[str],
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
            "ngen_np": str(cfg.get("ngen_np") or "8"),
            "image_ngen": str(cfg.get("image_ngen") or "awiciroh/ciroh-ngen-image:latest"),
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

            if (phase or "Pending") in _TERMINAL:
                return

            if time.monotonic() - start > POLL_TIMEOUT_SEC:
                await _emit_status(self, ui_node_id, "error", "poll timeout")
                SessionFactory = await self.get_sessionmaker()
                async with SessionFactory() as session:
                    await _update_node_db(session, wf_id, ui_node_id, "error", "poll timeout")
                return

            await asyncio.sleep(POLL_SEC)

    # ---------------- helpers ----------------
    def _ensure_templates_for_nodes(self, nodes: List[dict]) -> None:
        needed = {_kind_to_template((n.get("label") or n.get("id") or "")) for n in nodes}
        for tpl in needed:
            _ensure_template_exists_or_create(tpl)


    def _build_chain_workflow(
        self,
        chain: list[dict],
        user: str,
        wf_uuid: str,
        edges: list[dict] | None = None,  # pass UI edges for correct fan-in/out
    ) -> Workflow:
        """
        Build a DAG with per-parent fan-out and per-instance unique output prefixes.
        Every task instance gets a stable branch suffix (its task name), which is
        appended to output_prefix (and final_prefix when set) to avoid S3 key collisions.
        """
        import re

        def _slug(x: str) -> str:
            return re.sub(r"[^a-zA-Z0-9\\-]+", "-", str(x)).strip("-").lower() or "n"

        def _node_id(n: dict) -> str:
            return str(n.get("id") or n.get("label"))

        # Restrict graph to selected nodes/edges
        nodes_by_id = {_node_id(n): n for n in chain}
        node_ids = list(nodes_by_id.keys())

        edges_in: list[dict] = []
        if edges:
            for e in edges:
                s, t = e.get("source"), e.get("target")
                if s in nodes_by_id and t in nodes_by_id:
                    edges_in.append({"source": s, "target": t})

        # Fallback linear edges if none were provided/retained
        if not edges_in and len(chain) > 1:
            for i in range(len(chain) - 1):
                edges_in.append({"source": _node_id(chain[i]), "target": _node_id(chain[i + 1])})

        # Parents/children maps
        parents = {nid: [] for nid in node_ids}
        children = {nid: [] for nid in node_ids}
        for e in edges_in:
            s, t = e["source"], e["target"]
            if s in nodes_by_id and t in nodes_by_id:
                parents[t].append(s)
                children[s].append(t)

        topo_layers = _topo_layers([{"id": nid} for nid in node_ids], edges_in)
        sinks = {nid for nid in node_ids if not children[nid]}

        def _is_dataset_consumer(kind: str) -> bool:
            lk = (kind or "").lower()
            return ("calibration-config" in lk) or ("calibration-run" in lk) or (("ngiab" in lk) and ("run" in lk))

        def _dataset_pointer_from_params(kind: str, params: dict, inherit: dict | None = None) -> dict:
            lk = (kind or "").lower()
            if ("preprocess" in lk) or ("pre-process" in lk):
                return {
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/{params.get('output_name','ngiab')}.tgz",
                }
            if "calibration-config" in lk:
                return {
                    "dataset_bucket": params.get("output_bucket", ""),
                    "dataset_key": f"{params.get('output_prefix','').rstrip('/')}/calibration-prepared.tgz",
                }
            if "calibration-run" in lk:
                # does not create a new dataset tar; propagate prior pointer
                return dict(inherit or {})
            # ngiab-run & others: propagate whatever we had
            return dict(inherit or {})

        def _make_params(node: dict, last_flag: bool, incoming: dict | None, branch: str) -> dict:
            """Build params and *append the branch suffix* to output/final prefixes."""
            kind = node.get("label") or node.get("id")
            cfg = (node.get("config") or {})
            upstream_key = None
            if incoming and incoming.get("dataset_bucket") and incoming.get("dataset_key"):
                upstream_key = incoming["dataset_key"]

            params = _params_for(kind, cfg, user, wf_uuid, last_flag, upstream_key=upstream_key)

            # If we know the producing bucket/key, set explicit inputs for artifact binding
            if incoming and incoming.get("dataset_bucket") and incoming.get("dataset_key"):
                params.setdefault("input_bucket", incoming["dataset_bucket"])
                params.setdefault("input_key", incoming["dataset_key"])
                params.setdefault("input_s3_key", incoming["dataset_key"])

            # <<< crucial: uniqueize output paths per task instance >>>
            base = params.get("output_prefix")
            if base:
                params["output_prefix"] = f"{base.rstrip('/')}/{branch}"  # branch = task name (e.g., t-pre-process-00)
            if params.get("final_prefix"):
                params["final_prefix"] = f"{params['final_prefix'].rstrip('/')}/{branch}"
            return params

        ws = make_ws()
        with Workflow(generate_name="ngiab-chain-", entrypoint="main", workflows_service=ws) as w:
            with DAG(name="main"):
                # For each UI node, keep list of created task instances with their dataset pointers
                instances_by_node: dict[str, list[dict]] = {}

                for layer in topo_layers:
                    for nid in layer:
                        node = nodes_by_id[nid]
                        kind = node.get("label") or node.get("id")
                        tpl_name = _kind_to_template(kind)
                        _ensure_template_exists_or_create(tpl_name)

                        is_last = nid in sinks
                        parent_ids = parents.get(nid, [])
                        parent_instances: list[dict] = []
                        for pid in parent_ids:
                            parent_instances.extend(instances_by_node.get(pid, []))

                        created: list[dict] = []
                        if parent_instances and _is_dataset_consumer(kind):
                            # fan-out: one child instance per parent instance
                            for idx, pinst in enumerate(parent_instances):
                                tname = f"t-{_slug(nid)}-{idx:02d}"
                                params = _make_params(node, is_last, incoming=pinst, branch=tname)
                                Task(
                                    name=tname,
                                    template_ref=TemplateRef(name=tpl_name, template="main"),
                                    arguments=Arguments(parameters=[Parameter(name=k, value=v) for k, v in params.items()]),
                                    dependencies=[pinst["task"]],
                                )
                                pointer = _dataset_pointer_from_params(kind, params, inherit=pinst)
                                created.append({"task": tname, **pointer})
                        else:
                            # single instance: depend on all upstreams (if any)
                            dep_names = [pi["task"] for pi in parent_instances]
                            tname = f"t-{_slug(nid)}-00"
                            incoming = parent_instances[0] if len(parent_instances) == 1 else None
                            params = _make_params(node, is_last, incoming=incoming, branch=tname)
                            Task(
                                name=tname,
                                template_ref=TemplateRef(name=tpl_name, template="main"),
                                arguments=Arguments(parameters=[Parameter(name=k, value=v) for k, v in params.items()]),
                                dependencies=dep_names or None,
                            )
                            pointer = _dataset_pointer_from_params(kind, params, inherit=incoming or {})
                            created.append({"task": tname, **pointer})

                        instances_by_node[nid] = created

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
            return ("calibration-config" in k) or ("calibration-run" in k) or ("ngiab" in k and "run" in k)

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
        self._ensure_templates_for_nodes(chain_nodes)

        # Record a single WF row that covers this connected subgraph
        wt_row = await self._get_or_create_template_row(session, "ngiab-chain", user, {"source": "yaml"})
        wf_row = WFModel(
            name=wf_data.get("name") or f"wf-{run_id}",
            user=user,
            template_id=wt_row.id,
            status="queued",
            graph={"nodes": chain_nodes, "edges": edges_kept},
            layers=[],  # optional: could compute topo layers for UI here
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
            w = self._build_chain_workflow(chain_nodes, user, wf_uuid=str(wf_row.id), edges=edges_kept)
            w.create()

            # Notify/poll all nodes in this DAG
            for node in chain_nodes:
                node_id = node.get("id") or (node.get("label") or "")
                await _emit_status(self, node_id, "running", f"argo: {w.name}")
                asyncio.create_task(self._poll_argo_to_terminal(w.name, node_id, wf_row.id))

        except Exception as e:
            for node in chain_nodes:
                await _emit_status(self, node_id, "error", f"submit failed: {e}")
                await _update_node_db(session, wf_row.id,node_id, "error", f"submit failed: {e}")

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
            except Exception:
                pass
        if "input_key" in cfg and isinstance(cfg["input_key"], str):
            cfg["input_key"] = cfg["input_key"].lstrip("/")

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

