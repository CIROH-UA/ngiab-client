import React, { useEffect, useMemo, useReducer, useRef, useContext } from 'react';
import { WorkflowsContext } from '../contexts/workflowsContext';
import { workflowsReducer, initialState } from '../store/reducers/workflowsReducer';
import { types } from '../store/actions/actionsTypes';
import dagre from 'dagre';
import { AppContext } from 'context/context';

// ---- helpers (unchanged dagre + cycle) ----
function createsCycle(source, target, edges) {
  if (source === target) return true;
  const adj = new Map();
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  });
  const stack = [target], seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    (adj.get(cur) ?? []).forEach(n => stack.push(n));
  }
  return false;
}
function layoutWithDagre(nodes, edges, { rankdir = 'LR', nodesep = 60, ranksep = 90 } = {}) {
  const g = new dagre.graphlib.Graph(); g.setGraph({ rankdir, nodesep, ranksep }); g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => { g.setNode(n.id, { width: 200, height: 56 }); });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => { const p = g.node(n.id); return { ...n, position: { x: p.x - (p.width/2), y: p.y - (p.height/2) } }; });
}

// Weak connectivity check for “full run” (no selection) — per your rule #4.
// React Flow shows a similar concept in their cycle/validation docs. :contentReference[oaicite:7]{index=7}
function isWeaklyConnected(nodes, edges) {
  if (nodes.length === 0) return false;
  const ids = nodes.map(n => n.id);
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const adj = ids.map(() => []);
  edges.forEach(e => {
    if (e.source in idx && e.target in idx) {
      const a = idx[e.source], b = idx[e.target];
      adj[a].push(b); adj[b].push(a);
    }
  });
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const u = stack.pop();
    for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  }
  return seen.size === ids.length;
}

export function WorkflowsProvider({ children }) {
  const [state, dispatch] = useReducer(workflowsReducer, initialState);
  const { backend } = useContext(AppContext);

  useEffect(() => {
    if (!backend) return;
    if (backend.webSocket?.readyState === 1) dispatch({ type: types.WS_CONNECTED });

    const onOpen = () => dispatch({ type: types.WS_CONNECTED });
    const onClose = () => dispatch({ type: types.WS_DISCONNECTED });
    const onNodeStatus = (payload) => dispatch({ type: types.WS_MESSAGE, payload: { type: 'NODE_STATUS', ...payload } });
    const onLastRunLog = (payload) => dispatch({ type: types.WS_MESSAGE, payload: { type: 'LAST_RUN_LOG', events: payload?.events ?? [] } });

    backend.on('WS_CONNECTED', onOpen);
    backend.on('WS_DISCONNECTED', onClose);
    backend.on('NODE_STATUS', onNodeStatus);
    backend.on('LAST_RUN_LOG', onLastRunLog);

    return () => {
      backend.off('WS_CONNECTED'); backend.off('WS_DISCONNECTED');
      backend.off('NODE_STATUS');  backend.off('LAST_RUN_LOG');
    };
  }, [backend]);

  // public API
  const addNode = (kind) => dispatch({ type: types.ADD_NODE, payload: { kind } });
  const removeSelected = () => dispatch({ type: types.REMOVE_SELECTED });

  const autoLayout = (dir = 'LR') => {
    const layouted = layoutWithDagre(state.nodes, state.edges, { rankdir: dir });
    dispatch({ type: types.SET_NODES, payload: layouted });
  };

  const isValidConnection = (conn) => {
    const exists = state.edges.some(e => e.source === conn.source && e.target === conn.target);
    if (exists) return false;
    return !createsCycle(conn.source, conn.target, state.edges);
  };

  const runWorkflow = () => {
    const nodes = state.nodes.map(n => ({
      id: n.id, label: n.data?.label, config: n.data?.config || {}
    }));
    const edges = state.edges.map(e => ({ source: e.source, target: e.target }));
    const selectedIds = state.nodes.filter(n => n.selected).map(n => n.id);

    // Full-run rule: require weak connectivity (single component)
    if (selectedIds.length === 0) {
      if (!isWeaklyConnected(state.nodes, state.edges)) {
        dispatch({ type: types.WS_ERROR, payload: 'Cannot run: not all nodes are connected.' });
        return;
      }
    }

    const payload = { workflow: { nodes, edges }, selected: selectedIds };
    try {
      backend?.do(backend?.actions?.RUN_WORKFLOW ?? 'RUN_WORKFLOW', payload);
      dispatch({ type: types.WORKFLOW_SENT });
    } catch {
      dispatch({ type: types.WS_ERROR, payload: 'Failed to send workflow' });
    }
  };

  // playback & misc unchanged
  const requestLastRun = () => {
    try { backend?.do(backend?.actions?.REQUEST_LAST_RUN ?? 'REQUEST_LAST_RUN', {}); }
    catch { dispatch({ type: types.WS_ERROR, payload: 'Failed to request last run' }); }
  };
  const startPlayback = () => dispatch({ type: types.PLAYBACK_START });
  const pausePlayback = () => dispatch({ type: types.PLAYBACK_PAUSE });
  const resetPlayback = () => dispatch({ type: types.PLAYBACK_RESET });

  // timer for playback
  const timerRef = useRef(null);
  useEffect(() => {
    if (state.playback.playing && !timerRef.current) {
      timerRef.current = setInterval(() => dispatch({ type: types.PLAYBACK_TICK }), 700);
    }
    if (!state.playback.playing && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [state.playback.playing]);

  const value = useMemo(() => ({
    state, dispatch,
    runWorkflow, autoLayout, isValidConnection,
    addNode, removeSelected,
    requestLastRun, startPlayback, pausePlayback, resetPlayback,
  }), [state]);

  return <WorkflowsContext.Provider value={value}>{children}</WorkflowsContext.Provider>;
}
