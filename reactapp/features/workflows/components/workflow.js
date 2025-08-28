// features/workflows/components/workflow.js
import React, { useCallback, useMemo, useContext } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeToolbar,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflows } from '../hooks/useWorkflowsContext';
import { types } from '../store/actions/actionsTypes';
import NodeConfigPopup from './NodeConfigPopup';
import { AppContext } from 'context/context';

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

// === UPDATED FORMS to match backend template inputs ===
const NODE_FORMS = {
  'pre-process': [
    { name: 'selector_type', label: 'Selector Type', type: 'select', options: ['gage','latlon','catchment'] },
    { name: 'selector_value', label: 'Value (e.g. 01359139 or "lat,lon")', type: 'text' },
    { name: 'start_date', label: 'Start (YYYY-MM-DD)', type: 'text' },
    { name: 'end_date', label: 'End (YYYY-MM-DD)', type: 'text' },
    { name: 'output_name', label: 'Output name', type: 'text' },
    { name: 'source', label: 'Source', type: 'select', options: ['nwm','aorc'] },
    { name: 'debug', label: 'Debug?', type: 'select', options: ['false','true'] },
  ],
  'calibration': [
    { name: 'gage', label: 'USGS Gage ID', type: 'text' },
    { name: 'iterations', label: 'Iterations', type: 'number' },
    { name: 'warmup', label: 'Warmup (days)', type: 'number' },
    { name: 'calibration_ratio', label: 'Calibration ratio (0..1)', type: 'text' },
    { name: 'force', label: 'Force overwrite?', type: 'select', options: ['false','true'] },
    { name: 'run', label: 'Run calibration?', type: 'select', options: ['false','true'] },
    { name: 'debug', label: 'Debug?', type: 'select', options: ['false','true'] },
    // If not chained: allow manual S3 input
    { name: 'input_s3_key', label: 'Input S3 key (optional)', type: 'text' },
  ],
  'run ngiab': [
    // When not chained, user can point to an S3 key that has config/ + forcings/
    { name: 'input_s3_key', label: 'Input S3 key (optional)', type: 'text' },
    { name: 'ngen_np', label: 'NGEN Parallelism', type: 'number' },
  ],
  'teehr': [
    { name: 'input_s3_key', label: 'Input S3 key (optional)', type: 'text' },
    { name: 'teehr_inputs_subdir', label: 'Inputs subdir', type: 'text' },
    { name: 'teehr_results_subdir', label: 'Results subdir', type: 'text' },
    { name: 'teehr_args', label: 'Extra args', type: 'text' },
  ],
};

// Node component
function ProcessNode({ id, data, selected }) {
  const { dispatch, state } = useWorkflows();
  const { backend } = useContext(AppContext);

  const base = {
    padding: '28px 12px 12px 12px',
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
    dispatch({ type: types.UPDATE_NODE_CONFIG, payload: { nodeId: id, config: values } });
    dispatch({ type: types.CLOSE_NODE_POPUP });
  };

  const onRunNode = (e) => {
    e.stopPropagation();
    const payload = { nodeId: id, label: data?.label, config: data?.config || {} };
    try {
      backend?.do(backend?.actions?.RUN_NODE ?? 'RUN_NODE', payload);
    } catch (err) {
      console.error('RUN_NODE failed', err);
    }
  };

  const status = data?.status ?? 'idle';
  const statusIcon = (
    status === 'running' ? <Icons.spinner /> :
    status === 'success' ? <Icons.check /> :
    status === 'error'   ? <Icons.x /> :
    null
  );

  const fields = NODE_FORMS[data?.label] || [];

  return (
    <div style={base} onMouseDown={(e)=>e.stopPropagation()}>
      {/* TOP-LEFT: selection + status */}
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
          <span style={{ color: status === 'error' ? '#ef4444' : status === 'success' ? '#22c55e' : '#e5e7eb' }}>
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
          width: 22, height: 22, display: 'grid', placeItems: 'center',
          borderRadius: 8, border: '1px solid #374151',
          background: '#959eaaff', color: '#ffffffff', cursor: 'pointer',
        }}
      >
        <Icons.kebab />
      </button>

      {/* Title + inline play (only when idle) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, lineHeight: 1.2 }}>
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

      {/* Unscaled popup */}
      <NodeToolbar isVisible={state.ui.popupNodeId === id} position={Position.Top}>
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
