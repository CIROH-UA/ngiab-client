// features/workflows/components/workflow.js
import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflows } from '../hooks/useWorkflowsContext';
import { types } from '../store/actions/actionsTypes';

function StatusPill({ status }) {
  const label =
    status === 'running' ? 'running' :
    status === 'success' ? 'success' :
    status === 'error'   ? 'error'   : 'idle';
  const base = 'px-2 py-0.5 text-xs rounded-full border';
  const cls =
    status === 'running' ? `${base} border-blue-400` :
    status === 'success' ? `${base} border-green-500` :
    status === 'error'   ? `${base} border-red-500` :
                           `${base} border-gray-400`;
  return <span className={cls}>{label}</span>;
}

function ProcessNode({ data }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 12, border: '1px solid #ccc',
      background: '#111827', color: '#e5e7eb', minWidth: 180
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontWeight: 600 }}>{data?.label ?? 'Process'}</strong>
        <StatusPill status={data?.status} />
      </div>
      {data?.message ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
          {data.message}
        </div>
      ) : null}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default function Workflow() {
  const {
    state: { nodes, edges },
    dispatch,
    isValidConnection,     // NEW: cycle-safe validator
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

  return (
    <div style={{ width: '100%', height: '70vh' }}>
      <ReactFlow
        colorMode="dark"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}  // official API
        nodeTypes={nodeTypes}
        fitView
      >
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
        <Background />
      </ReactFlow>
    </div>
  );
}
