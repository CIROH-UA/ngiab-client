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

const Icons = {
  kebab: (props) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  ),
  spinner: (props) => (
    <svg viewBox="0 0 50 50" width="16" height="16" {...props}>
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5" opacity="0.2" />
      <path d="M45 25a20 20 0 0 1-20 20" fill="none" stroke="currentColor" strokeWidth="5">
        <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite" />
      </path>
    </svg>
  ),
  check: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}>
      <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  ),
  x: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}>
      <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z" />
    </svg>
  ),
  play: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}>
      <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
  ),
};

// === forms aligned with preprocess & calibration ===
const NODE_FORMS = {
  'pre-process': [
    { name: 'selector_type', label: 'Selector Type', type: 'select', options: ['gage', 'latlon', 'catchment'] },
    { name: 'selector_value', label: 'Value (e.g. 01359139 | 33.22,-87.54 | 5173)', type: 'text' },
    { name: 'vpu', label: 'VPU (optional, e.g. 01)', type: 'text' },
    { name: 'start_date', label: 'Start (YYYY-MM-DD)', type: 'text' },
    { name: 'end_date', label: 'End (YYYY-MM-DD)', type: 'text' },
    { name: 'output_name', label: 'Output folder name (-o)', type: 'text' },
    { name: 'source', label: 'Source', type: 'select', options: ['nwm', 'aorc'] },
    { name: 'debug', label: 'Debug (-D)?', type: 'select', options: ['false', 'true'] },
    // step / flow controls
    { name: 'all', label: 'Run ALL (-sfr + --run)', type: 'select', options: ['false', 'true'] },
    { name: 'subset', label: 'Subset (-s)', type: 'select', options: ['true', 'false'] },
    { name: 'forcings', label: 'Forcings (-f)', type: 'select', options: ['true', 'false'] },
    { name: 'realization', label: 'Realization (-r)', type: 'select', options: ['true', 'false'] },
    { name: 'run', label: 'Run NGIAB (--run)', type: 'select', options: ['false', 'true'] },
    { name: 'validate', label: 'Validate (--validate)', type: 'select', options: ['false', 'true'] },
    // optional S3 target for artifact placement
    { name: 'output_bucket', label: 'S3 bucket (artifact)', type: 'text' },
    { name: 'output_prefix', label: 'S3 prefix (artifact)', type: 'text' },
  ],
  'calibration-config': [
    // Calibration-only path: user can paste ONE S3 URL; we’ll parse it.
    { name: 'input_s3_url', label: 'Preprocess artifact S3 URL (e.g. s3://bucket/path/preprocess.tgz)', type: 'text' },
    // Advanced overrides (optional)
    { name: 'input_bucket', label: 'Input S3 bucket (optional)', type: 'text' },
    { name: 'input_key', label: 'Input S3 key (optional)', type: 'text' },
    // Output destination
    { name: 'output_bucket', label: 'Output S3 bucket', type: 'text' },
    { name: 'output_prefix', label: 'Output S3 prefix', type: 'text' },
    // HydroFabric helper (if needed later)
    { name: 'vpu', label: 'VPU (only if gpkg missing)', type: 'text', placeholder: 'e.g., 10L' },
    // ngiab-cal CLI flags
    { name: 'gage', label: 'USGS Gage ID', type: 'text' },
    { name: 'iterations', label: 'Iterations (-i)', type: 'number' },
    { name: 'warmup', label: 'Warmup days (-w)', type: 'number' },
    { name: 'calibration_ratio', label: 'Calibration ratio (--calibration_ratio)', type: 'text' },
    { name: 'force', label: 'Force overwrite? (-f)', type: 'select', options: ['false', 'true'] },
    { name: 'debug', label: 'Debug? (--debug)', type: 'select', options: ['false', 'true'] },
  ],
  'calibration-run': [
    // Calibration-only path: user can paste ONE S3 URL; we’ll parse it.
    { name: 'input_s3_url', label: 'Preprocess artifact S3 URL (e.g. s3://bucket/path/preprocess.tgz)', type: 'text' },
    // Advanced overrides (optional)
    { name: 'input_bucket', label: 'Input S3 bucket (optional)', type: 'text' },
    { name: 'input_key', label: 'Input S3 key (optional)', type: 'text' },
    // Output destination
    { name: 'output_bucket', label: 'Output S3 bucket', type: 'text' },
    { name: 'output_prefix', label: 'Output S3 prefix', type: 'text' },
  ],
  'run ngiab': [
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
    // Normalize S3 bits:
    if (values?.input_key && typeof values.input_key === 'string') {
      values.input_key = values.input_key.replace(/^\/+/, '');
    }
    if (values?.input_s3_url && (!values.input_bucket || !values.input_key)) {
      const u = String(values.input_s3_url).trim();
      if (u.startsWith('s3://')) {
        const rest = u.slice(5);
        const i = rest.indexOf('/');
        if (i > 0) {
          values.input_bucket = values.input_bucket || rest.slice(0, i);
          values.input_key = values.input_key || rest.slice(i + 1).replace(/^\/+/, '');
        }
      }
    }

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
    status === 'error' ? <Icons.x /> :
    null
  );

  const fields = NODE_FORMS[data?.label] || [];

  return (
    <div style={base} onMouseDown={(e) => e.stopPropagation()}>
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          onClick={toggleSelected}
          title={selected ? 'Unselect' : 'Select'}
          style={{
            width: 16, height: 16, borderRadius: '50%',
            border: selected ? '2px solid #60a5fa' : '2px solid #9ca3af',
            background: selected ? '#60a5fa' : 'transparent',
            cursor: 'pointer',
          }}
        />
        {statusIcon && (
          <span style={{ color: status === 'error' ? '#ef4444' : status === 'success' ? '#22c55e' : '#e5e7eb' }}>
            {statusIcon}
          </span>
        )}
      </div>

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
              background: '#1f2937', color: '#e5e7eb', cursor: 'pointer',
            }}
          >
            <Icons.play />
          </button>
        )}
      </div>

      {data?.message ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>{data.message}</div>
      ) : null}

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


      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export default function Workflow() {
  const {
    state: { nodes, edges },
    dispatch,
    isValidConnection,
  } = useWorkflows();
  const { backend } = useContext(AppContext);

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

  const onRunWorkflow = (e) => {
    e.stopPropagation();
    const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const payload = { workflow: { nodes, edges }, selected: selectedIds };
    try {
      backend?.do(backend?.actions?.RUN_WORKFLOW ?? 'RUN_WORKFLOW', payload);
    } catch (err) {
      console.error('RUN_WORKFLOW failed', err);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '90vh' }}>
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
      <button
        onClick={onRunWorkflow}
        title="Run workflow"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          width: 32,
          height: 32,
          borderRadius: 999,
          border: '2px solid #374151',
          background: '#1f2937',
          color: '#e5e7eb',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
        }}
      >
        <Icons.play />
      </button>
    </div>
  );
}
