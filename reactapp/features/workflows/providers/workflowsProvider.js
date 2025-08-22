// features/workflows/providers/workflowsProvider.js
import React, { useEffect, useMemo, useReducer, useRef, useContext } from 'react';
import { WorkflowsContext } from '../contexts/workflowsContext';
import { workflowsReducer, initialState } from '../store/reducers/workflowsReducer';
import { types } from '../store/actions/actionsTypes';
import dagre from 'dagre';
import { AppContext } from 'context/context';

// ---- unchanged helpers (layout + cycle detection) ----
function computeExecutionLayers(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const indeg = new Map(ids.map(id => [id, 0]));
  const adj = new Map(ids.map(id => [id, []]));
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  });

  const layers = [];
  let frontier = ids.filter(id => (indeg.get(id) ?? 0) === 0);
  const seen = new Set();

  while (frontier.length) {
    layers.push(frontier);
    frontier.forEach(id => seen.add(id));
    const next = [];
    frontier.forEach(id => {
      (adj.get(id) ?? []).forEach(to => {
        indeg.set(to, indeg.get(to) - 1);
        if (indeg.get(to) === 0 && !seen.has(to)) next.push(to);
      });
    });
    frontier = next;
  }
  if (seen.size !== ids.length) {
    const remain = ids.filter(id => !seen.has(id));
    layers.push(remain);
  }
  return layers;
}

function createsCycle(source, target, edges) {
  if (source === target) return true;
  const adj = new Map();
  edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  });
  const stack = [target];
  const seen = new Set();
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
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    const width = Math.max(180, (n.data?.label?.length ?? 10) * 8);
    const height = 56;
    g.setNode(n.id, { width, height });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - (p.width / 2), y: p.y - (p.height / 2) } };
  });
}

// ---- Provider ----
export function WorkflowsProvider({ children }) {
  const [state, dispatch] = useReducer(workflowsReducer, initialState);
  const { backend } = useContext(AppContext);

  // Hook into the shared Backend socket
  useEffect(() => {
    if (!backend) return;

    // set initial connected flag based on readyState (1 === OPEN)
    if (backend.webSocket?.readyState === 1) {
      dispatch({ type: types.WS_CONNECTED });
    }

    const onOpen = () => dispatch({ type: types.WS_CONNECTED });
    const onClose = () => dispatch({ type: types.WS_DISCONNECTED });

    const onNodeStatus = (payload) =>
      dispatch({ type: types.WS_MESSAGE, payload: { type: 'NODE_STATUS', ...payload } });

    const onLastRunLog = (payload) =>
      dispatch({
        type: types.WS_MESSAGE,
        payload: { type: 'LAST_RUN_LOG', events: payload?.events ?? [] },
      });

    backend.on('WS_CONNECTED', onOpen);
    backend.on('WS_DISCONNECTED', onClose);
    backend.on('NODE_STATUS', onNodeStatus);
    backend.on('LAST_RUN_LOG', onLastRunLog);

    return () => {
      backend.off('WS_CONNECTED');
      backend.off('WS_DISCONNECTED');
      backend.off('NODE_STATUS');
      backend.off('LAST_RUN_LOG');
    };
  }, [backend]);

  // Public APIs exposed via context
  const addNode = (kind) => dispatch({ type: types.ADD_NODE, payload: { kind } });
  const removeSelected = () => dispatch({ type: types.REMOVE_SELECTED });

  const autoLayout = (dir = 'LR') => {
    const layouted = layoutWithDagre(state.nodes, state.edges, { rankdir: dir });
    dispatch({ type: types.SET_NODES, payload: layouted });
  };

  const isValidConnection = (conn) => {
    const alreadyExists = state.edges.some(
      (e) => e.source === conn.source && e.target === conn.target
    );
    if (alreadyExists) return false;
    return !createsCycle(conn.source, conn.target, state.edges);
  };

  const runWorkflow = () => {
    const { nodes, edges } = state;
    const layers = computeExecutionLayers(nodes, edges);
    dispatch({ type: types.WORKFLOW_COMPILED, payload: layers });

    const workflow = {
      layers,
      nodes: nodes.map(n => ({ id: n.id, label: n.data?.label })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
    };

    try {
      backend?.do(backend?.actions?.RUN_WORKFLOW ?? 'RUN_WORKFLOW', { workflow });
      dispatch({ type: types.WORKFLOW_SENT });
    } catch {
      dispatch({ type: types.WS_ERROR, payload: 'Failed to send workflow' });
    }
  };

  // Playback controls using shared socket
  const requestLastRun = () => {
    try {
      backend?.do(backend?.actions?.REQUEST_LAST_RUN ?? 'REQUEST_LAST_RUN', {});
    } catch {
      dispatch({ type: types.WS_ERROR, payload: 'Failed to request last run' });
    }
  };

  const startPlayback = () => dispatch({ type: types.PLAYBACK_START });
  const pausePlayback = () => dispatch({ type: types.PLAYBACK_PAUSE });
  const resetPlayback = () => dispatch({ type: types.PLAYBACK_RESET });

  // Timer driving playback ticks
  const timerRef = useRef(null);
  useEffect(() => {
    if (state.playback.playing && !timerRef.current) {
      timerRef.current = setInterval(() => {
        dispatch({ type: types.PLAYBACK_TICK });
      }, 700);
    }
    if (!state.playback.playing && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [state.playback.playing]);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      // run & layout
      runWorkflow,
      autoLayout,
      isValidConnection,
      // toolbar
      addNode,
      removeSelected,
      // playback
      requestLastRun,
      startPlayback,
      pausePlayback,
      resetPlayback,
    }),
    [state]
  );

  return (
    <WorkflowsContext.Provider value={value}>
      {children}
    </WorkflowsContext.Provider>
  );
}
