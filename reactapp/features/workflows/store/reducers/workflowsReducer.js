// features/workflows/store/reducers/workflowsReducer.js
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { types } from '../actions/actionsTypes';

const baseNodes = [
  { id: 'pre-process', position: { x: 0,   y: 0 },  type: 'process', data: { label: 'pre-process', status: 'idle', config: {} } },
  { id: 'calibration', position: { x: 250, y: 0 },  type: 'process', data: { label: 'calibration', status: 'idle', config: {} } },
  { id: 'run-ngiab',   position: { x: 500, y: 0 },  type: 'process', data: { label: 'run ngiab',   status: 'idle', config: {} } },
  { id: 'teehr',       position: { x: 750, y: 0 },  type: 'process', data: { label: 'teehr',       status: 'idle', config: {} } },
];

function labelFor(kind) {
  if (kind === 'pre-process') return 'pre-process';
  if (kind === 'calibration') return 'calibration';
  if (kind === 'run-ngiab') return 'run ngiab';
  if (kind === 'teehr') return 'teehr';
  return kind;
}
function nextId(kind, nodes) {
  let i = 1;
  let id = kind;
  while (nodes.some(n => n.id === id)) {
    i += 1;
    id = `${kind}-${i}`;
  }
  return id;
}

export const initialState = {
  nodes: baseNodes,
  edges: [],
  ws: { connected: false, error: null },
  layers: [],
  lastMessage: null,
  playback: { events: [], idx: 0, playing: false },
  ui: { popupNodeId: null },
};

export function workflowsReducer(state, action) {
  switch (action.type) {
    case types.NODES_CHANGE:
      return { ...state, nodes: applyNodeChanges(action.payload, state.nodes) };
    case types.EDGES_CHANGE:
      return { ...state, edges: applyEdgeChanges(action.payload, state.edges) };
    case types.ADD_EDGE:
      return { ...state, edges: addEdge(action.payload, state.edges) };

    case types.SET_NODES:
      return { ...state, nodes: action.payload };
    case types.SET_EDGES:
      return { ...state, edges: action.payload };

    case types.ADD_NODE: {
      const { kind } = action.payload;
      const id = nextId(kind, state.nodes);
      const n = {
        id,
        type: 'process',
        position: { x: 100 + Math.random() * 200, y: 80 + Math.random() * 120 },
        data: { label: labelFor(kind), status: 'idle', config: {} },
      };
      return { ...state, nodes: [...state.nodes, n] };
    }

    case types.REMOVE_SELECTED: {
      const selectedNodeIds = new Set(state.nodes.filter(n => n.selected).map(n => n.id));
      const selectedEdgeIds = new Set(state.edges.filter(e => e.selected).map(e => e.id));
      const nodes = state.nodes.filter(n => !selectedNodeIds.has(n.id));
      const edges = state.edges
        .filter(e => !selectedEdgeIds.has(e.id))
        .filter(e => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target));
      const ui = state.ui.popupNodeId && selectedNodeIds.has(state.ui.popupNodeId)
        ? { ...state.ui, popupNodeId: null }
        : state.ui;
      return { ...state, nodes, edges, ui };
    }

    // ---- Selection & popup ----
    case types.TOGGLE_NODE_SELECTED: {
      const { nodeId } = action.payload;
      const nodes = state.nodes.map(n => n.id === nodeId ? { ...n, selected: !n.selected } : n);
      return { ...state, nodes };
    }
    case types.CLEAR_SELECTION: {
      const nodes = state.nodes.map(n => n.selected ? { ...n, selected: false } : n);
      return { ...state, nodes };
    }
    case types.OPEN_NODE_POPUP:
      return { ...state, ui: { ...state.ui, popupNodeId: action.payload.nodeId } };
    case types.CLOSE_NODE_POPUP:
      return { ...state, ui: { ...state.ui, popupNodeId: null } };

    case types.UPDATE_NODE_CONFIG: {
      const { nodeId, config } = action.payload;
      const nodes = state.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, config: { ...(n.data?.config || {}), ...config } } } : n
      );
      return { ...state, nodes };
    }

    // ---- Exec + WS ----
    case types.WORKFLOW_COMPILED:
      return { ...state, layers: action.payload };
    case types.WORKFLOW_SENT:
      return state;
    case types.WS_CONNECTED:
      return { ...state, ws: { connected: true, error: null } };
    case types.WS_DISCONNECTED:
      return { ...state, ws: { connected: false, error: null } };
    case types.WS_ERROR:
      return { ...state, ws: { ...state.ws, error: action.payload } };

    case types.WS_MESSAGE: {
      const msg = action.payload;
      if (msg?.type === 'NODE_STATUS' && msg.nodeId) {
        const nodes = state.nodes.map(n =>
          n.id === msg.nodeId
            ? { ...n, data: { ...n.data, status: msg.status, message: msg.message } }
            : n
        );
        return { ...state, nodes, lastMessage: msg };
      }
      if (msg?.type === 'LAST_RUN_LOG' && Array.isArray(msg.events)) {
        return {
          ...state,
          playback: { events: msg.events, idx: 0, playing: false },
          lastMessage: msg,
        };
      }
      return { ...state, lastMessage: msg };
    }

    case types.UPDATE_NODE_STATUS: {
      const { nodeId, status, message } = action.payload;
      const nodes = state.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, status, message } } : n
      );
      return { ...state, nodes };
    }

    // ---- Playback ----
    case types.PLAYBACK_LOAD:
      return { ...state, playback: { events: action.payload.events ?? [], idx: 0, playing: false } };
    case types.PLAYBACK_START:
      return { ...state, playback: { ...state.playback, playing: true } };
    case types.PLAYBACK_PAUSE:
      return { ...state, playback: { ...state.playback, playing: false } };
    case types.PLAYBACK_RESET:
      return { ...state, playback: { events: [], idx: 0, playing: false } };
    case types.PLAYBACK_TICK: {
      const { playback } = state;
      if (!playback.playing || playback.idx >= playback.events.length) {
        return { ...state, playback: { ...playback, playing: false } };
      }
      const ev = playback.events[playback.idx];
      const nodes = state.nodes.map(n =>
        n.id === ev.nodeId ? { ...n, data: { ...n.data, status: ev.status, message: ev.message } } : n
      );
      return { ...state, nodes, playback: { ...playback, idx: playback.idx + 1 } };
    }

    default:
      return state;
  }
}
