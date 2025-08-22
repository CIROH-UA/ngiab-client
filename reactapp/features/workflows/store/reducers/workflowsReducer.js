// features/workflows/store/reducers/workflowsReducer.js
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { types } from '../actions/actionsTypes';

// Base four nodes (you can duplicate teehr later)
const baseNodes = [
  { id: 'pre-process', position: { x: 0,   y: 0 },  type: 'process', data: { label: 'pre-process', status: 'idle' } },
  { id: 'calibration', position: { x: 250, y: 0 },  type: 'process', data: { label: 'calibration', status: 'idle' } },
  { id: 'run-ngiab',   position: { x: 500, y: 0 },  type: 'process', data: { label: 'run ngiab',   status: 'idle' } },
  { id: 'teehr',       position: { x: 750, y: 0 },  type: 'process', data: { label: 'teehr',       status: 'idle' } },
];

function labelFor(kind) {
  if (kind === 'pre-process') return 'pre-process';
  if (kind === 'calibration') return 'calibration';
  if (kind === 'run-ngiab') return 'run ngiab';
  if (kind === 'teehr') return 'teehr';
  return kind;
}
function nextId(kind, nodes) {
  // ensure unique ids e.g., teehr-2, teehr-3
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
};

export function workflowsReducer(state, action) {
  switch (action.type) {
    case types.NODES_CHANGE:
      return { ...state, nodes: applyNodeChanges(action.payload, state.nodes) }; // :contentReference[oaicite:7]{index=7}
    case types.EDGES_CHANGE:
      return { ...state, edges: applyEdgeChanges(action.payload, state.edges) }; // :contentReference[oaicite:8]{index=8}
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
        data: { label: labelFor(kind), status: 'idle' },
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
      return { ...state, nodes, edges };
    }

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
      // NODE_STATUS passthrough to node badges
      if (msg?.type === 'NODE_STATUS' && msg.nodeId) {
        const nodes = state.nodes.map(n =>
          n.id === msg.nodeId
            ? { ...n, data: { ...n.data, status: msg.status, message: msg.message } }
            : n
        );
        return { ...state, nodes, lastMessage: msg };
      }
      // Playback logs: expect { type:'LAST_RUN_LOG', events:[ {nodeId,status,message,timestampMs?}, ... ] }
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

    // --- Playback reducer ---
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
      return {
        ...state,
        nodes,
        playback: { ...playback, idx: playback.idx + 1 },
      };
    }

    default:
      return state;
  }
}
