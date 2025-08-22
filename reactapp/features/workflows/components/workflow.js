// features/workflows/components/workflow.js
import React, { useCallback, useMemo, useContext } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeToolbar,          // ← NEW
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflows } from '../hooks/useWorkflowsContext';
import { types } from '../store/actions/actionsTypes';
import NodeConfigPopup from './NodeConfigPopup';
import { AppContext } from 'context/context';  // to send RUN_NODE via Backend

// Small inline SVG helpers
const Icons = {
  kebab: (props) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...props}><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
  ),
  spinner: (props) => (
    <svg viewBox="0 0 50 50" width="16" height="16" {...props}>
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.2"/>
      <path d="M45 25a20 20 0 0 1-20 20" fill="none" stroke="currentColor" strokeWidth="5">
        <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite" />
      </path>
    </svg>
  ),
  check: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
  ),
  x: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
  ),
  play: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
  ),
};

const NODE_FORMS = {
  'pre-process': [
    { name: 'input', label: 'Input path', type: 'text' },
    { name: 'method', label: 'Method', type: 'select', options: ['clean', 'normalize'] },
  ],
  'calibration': [
    { name: 'strategy', label: 'Strategy', type: 'select', options: ['grid', 'random', 'bayes'] },
    { name: 'iterations', label: 'Iterations', type: 'number' },
  ],
  'run ngiab': [
    { name: 'vpu', label: 'VPU', type: 'text' },
    { name: 'forecast', label: 'Forecast Type', type: 'select', options: ['short_range', 'medium_range', 'analysis_assim_extend'] },
  ],
  'teehr': [
    { name: 'metrics', label: 'Metrics (comma-separated)', type: 'text' },
    { name: 'gage', label: 'USGS Gage', type: 'text' },
  ],
};

// --- replace only the ProcessNode(...) definition with this version ---
function ProcessNode({ id, data, selected }) {
  const { dispatch, state } = useWorkflows();
  const { backend } = useContext(AppContext);

  // leave extra top padding so the TL cluster never overlaps the title
  const base = {
    padding: '28px 12px 12px 12px',       // <-- key change: bigger top padding
    borderRadius: 12,
    border: selected ? '2px solid #60a5fa' : '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
    minWidth: 220,
    boxShadow: selected ? '0 0 0 4px rgba(59,130,246,0.25)' : '0 2px 8px rgba(0,0,0,0.3)',
    position: 'relative',
  };

  const toggleSelected = (e) => {
    e.stopPropagation();
    dispatch({ type: types.TOGGLE_NODE_SELECTED, payload: { nodeId: id } });
  };

  const togglePopup = (e) => {
    e.stopPropagation();
    const isOpen = state.ui.popupNodeId === id;
    dispatch({ type: isOpen ? types.CLOSE_NODE_POPUP : types.OPEN_NODE_POPUP, payload: { nodeId: id } });
  };

  const onSaveConfig = (values) => {
    console.log('save config', { nodeId: id, values });
    dispatch({ type: types.UPDATE_NODE_CONFIG, payload: { nodeId: id, config: values } });
    dispatch({ type: types.CLOSE_NODE_POPUP });
  };

  // ▶ PLAY actually sends RUN_NODE now (will only show when idle)
  const onRunNode = (e) => {
    e.stopPropagation();
    const payload = { nodeId: id, label: data?.label, config: data?.config || {} };
    console.log('RUN_NODE send', payload);
    try {
      backend?.do(backend?.actions?.RUN_NODE ?? 'RUN_NODE', payload);
    } catch (err) {
      console.error('RUN_NODE failed', err);
    }
  };

  const status = data?.status; // 'running' | 'success' | 'error' | 'idle'
  const statusIcon = (
    status === 'running' ? <Icons.spinner /> :
    status === 'success' ? <Icons.check /> :
    status === 'error'   ? <Icons.x /> :
    null                  // idle no longer shows top-left status (play sits by title)
  );

  const fields = NODE_FORMS[data?.label] || [];

  return (
    <div style={base} onMouseDown={(e)=>e.stopPropagation()}>
      {/* TOP-LEFT cluster: selection circle + status (spinner/check/x when not idle) */}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={toggleSelected}
          title={selected ? 'Unselect' : 'Select'}
          style={{
            width: 16, height: 16, borderRadius: '50%',
            border: selected ? '2px solid #60a5fa' : '2px solid #9ca3af',
            background: selected ? '#60a5fa' : 'transparent',
            cursor: 'pointer'
          }}
        />
        {statusIcon && (
          <span
            style={{
              color: status === 'error' ? '#ef4444' :
                     status === 'success' ? '#22c55e' : '#e5e7eb'
            }}
          >
            {statusIcon}
          </span>
        )}
      </div>

      {/* TOP-RIGHT kebab */}
      <button
        onClick={togglePopup}
        title="Configure node"
        style={{
          position: 'absolute', top: 6, right: 6,
          width: 22, height: 22,
          display: 'grid', placeItems: 'center',
          borderRadius: 8, border: '1px solid #374151',
          background: '#959eaaff', color: '#ffffffff', cursor: 'pointer',
          
        }}
      >
        <Icons.kebab />
      </button>

      {/* Title row with PLAY (shown only when idle) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontWeight: 600, lineHeight: 1.2
      }}>
        <span>{data?.label ?? 'Process'}</span>
        {status === 'idle' && (
          <button
            onClick={onRunNode}
            title="Run this node"
            style={{
              display: 'grid', placeItems: 'center',
              width: 22, height: 22, borderRadius: 999,
              border: '1px solid #374151',
              background: '#1f2937', color: '#e5e7eb', cursor: 'pointer'
            }}
          >
            <Icons.play />
          </button>
        )}
      </div>

      {/* Optional message */}
      {data?.message ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>{data.message}</div>
      ) : null}

      {/* Unscaled toolbar-based popup (per docs) */}
      <NodeToolbar
        isVisible={state.ui.popupNodeId === id}
        position={Position.Top}
      >
        <NodeConfigPopup
          nodeId={id}
          visible={true}
          fields={fields}
          initialValues={data?.config}
          onSubmit={onSaveConfig}
          onClose={() => dispatch({ type: types.CLOSE_NODE_POPUP })}
        />
      </NodeToolbar>

      {/* Handles */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default function Workflow() {
  const {
    state: { nodes, edges },
    dispatch,
    isValidConnection,
  } = useWorkflows();

  const nodeTypes = useMemo(() => ({ process: ProcessNode }), []);

  const onNodesChange = useCallback(
    (changes) => dispatch({ type: types.NODES_CHANGE, payload: changes }),
    [dispatch]
  );
  const onEdgesChange = useCallback(
    (changes) => dispatch({ type: types.EDGES_CHANGE, payload: changes }),
    [dispatch]
  );
  const onConnect = useCallback(
    (connection) => dispatch({ type: types.ADD_EDGE, payload: connection }),
    [dispatch]
  );
  const onPaneClick = useCallback(
    () => dispatch({ type: types.CLEAR_SELECTION }),
    [dispatch]
  );

  return (
    <div style={{ width: '100%', height: '70vh' }}>
      <ReactFlow
        colorMode="dark"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
      >
        <MiniMap pannable zoomable />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
