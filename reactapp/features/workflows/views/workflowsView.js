// features/workflows/views/workflowsView.js
import React from 'react';
import Workflow from '../components/workflow';
import { WorkflowsProvider } from '../providers/workflowsProvider';
import { useWorkflows } from '../hooks/useWorkflowsContext';
import '@xyflow/react/dist/style.css';

function Toolbar() {
  const {
    addNode, removeSelected, autoLayout,
    requestLastRun, startPlayback, pausePlayback, resetPlayback,
    runWorkflow,
    state,
  } = useWorkflows();

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',        // vertical stack
        gap: 8,
        alignItems: 'stretch',
        width: 220,
        padding: 10,
        border: '1px solid #374151',
        borderRadius: 10,
        background: '#0b1220',
        height: '70vh',                 // matches canvas height
        position: 'sticky',
        top: 0,
        overflowY: 'auto',              // scroll if buttons wrap
      }}
    >
      <strong style={{ marginBottom: 4 }}>Tools</strong>

      <button onClick={() => addNode('pre-process')} className="btn">+ pre-process</button>
      <button onClick={() => addNode('calibration')} className="btn">+ calibration</button>
      <button onClick={() => addNode('run-ngiab')} className="btn">+ run ngiab</button>
      <button onClick={() => addNode('teehr')} className="btn">+ teehr</button>

      <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '6px 0' }} />

      <button onClick={removeSelected} className="btn btn-danger">Remove selected</button>

      <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '6px 0' }} />

      <button onClick={() => autoLayout('LR')} className="btn">Auto-layout LR</button>
      <button onClick={() => autoLayout('TB')} className="btn">Auto-layout TB</button>

      <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '6px 0' }} />

      <button onClick={requestLastRun} className="btn">Load last run</button>
      <div style={{ display: 'flex', gap: 6 }}>
         <button onClick={runWorkflow} className="btn" style={{ flex: 1 }}>Play</button>
        <button onClick={pausePlayback} className="btn" style={{ flex: 1 }}>Pause</button>
      </div>
      <button onClick={resetPlayback} className="btn btn-danger">Reset</button>

      {/* Push WS status to bottom */}
      <div style={{ marginTop: 'auto', fontSize: 12, opacity: 0.8 }}>
        WS: {state.ws.connected ? 'connected' : 'disconnected'}
        {state.ws.error ? ` • ${state.ws.error}` : ''}
      </div>

      <style>
        {`
          .btn {
            padding: 6px 10px;
            border-radius: 10px;
            border: 1px solid #3b82f6;
            background: #1f2937;
            color: #e5e7eb;
            cursor: pointer;
            text-align: left;
          }
          .btn:hover { filter: brightness(1.05); }
          .btn-danger { border-color: #ef4444; }
        `}
      </style>
    </aside>
  );
}

function LayersPreview() {
  const { state } = useWorkflows();
  if (!state.layers?.length) return null;
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        border: '1px solid #374151',
        borderRadius: 10
      }}
    >
      <div style={{ fontSize: 14, marginBottom: 6, opacity: 0.9 }}>
        Execution plan (layers):
      </div>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {state.layers.map((layer, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {layer.join(' , ')}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function WorkflowsView() {
  return (
    <WorkflowsProvider>
      {/* Two-pane layout: vertical toolbar (left) + canvas (right) */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Toolbar />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Workflow />
          <LayersPreview />
        </div>
      </div>
    </WorkflowsProvider>
  );
}
