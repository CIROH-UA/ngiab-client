// features/workflows/views/workflowsView.js
import React from 'react';


import Workflow from '../components/workflow';
import { useWorkflows } from '../hooks/useWorkflowsContext';

import { FaTrashAlt, FaPlay, FaPuzzlePiece, FaPlus, FaCheckCircle, FaTimesCircle, FaHourglassHalf, FaRegCircle } from "react-icons/fa";
import { LuAlignVerticalJustifyStart, LuAlignStartVertical  } from "react-icons/lu";

import { WorkflowsProvider } from '../providers/workflowsProvider';


import Select, { components as RSComponents } from 'react-select';
import { FixedSizeList as List } from 'react-window';

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import '@xyflow/react/dist/style.css';


function Toolbar() {
  const {
    
    addNode, removeSelected, autoLayout,
    startPlayback,              // ok to keep if you still use it
    runWorkflow,
    setSelectedWorkflow,        // <-- new from provider
    state,
  } = useWorkflows();

  // react-window powered MenuList for react-select
  const MenuList = (props) => {
    const { children, maxHeight } = props;
    const itemCount = Array.isArray(children) ? children.length : 0;
    const height = Math.min(maxHeight, itemCount * 36);
    return (
      <RSComponents.MenuList {...props}>
        <List height={height} itemCount={itemCount} itemSize={36} width="100%">
          {({ index, style }) => <div style={style}>{children[index]}</div>}
        </List>
      </RSComponents.MenuList>
    );
  };
  
  const list = [...(state.workflows || [])].sort((a, b) => {
    const da = a.last_run_at ? new Date(a.last_run_at).getTime() : -Infinity;
    const db = b.last_run_at ? new Date(b.last_run_at).getTime() : -Infinity;
    return db - da; // desc, NULLS LAST
  });
  const iconFor = (s) => {
    if (s === 'success') return <FaCheckCircle style={{ opacity: 0.9 }} />;
    if (s === 'error')   return <FaTimesCircle style={{ opacity: 0.9 }} />;
    if (s === 'running' || s === 'queued') return <FaHourglassHalf style={{ opacity: 0.9 }} />;
    return <FaRegCircle style={{ opacity: 0.6 }} />;
  };
  const options = list.map(w => ({
    value: String(w.id),
    label: w.name,
    status: w.status,
    lastRunAt: w.last_run_at || null,
  }));

  const selected = options.find(o => o.value === state.ui?.selectedWorkflowId) || null;

  const StatusOption = (props) => {
    const { data } = props;
    return (
      <RSComponents.Option {...props}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {iconFor(data.status)}
          <span>{data.label}</span>
        </div>
      </RSComponents.Option>
    );
  };
  const StatusSingleValue = (props) => {
    const { data } = props;
    return (
      <RSComponents.SingleValue {...props}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {iconFor(data.status)}
          <span>{data.label}</span>
        </div>
      </RSComponents.SingleValue>
    );
  };

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',        // vertical stack
        gap: 8,
        alignItems: 'stretch',
        width: 275,
        padding: 10,
        border: '1px solid #374151',
        borderRadius: 10,
        background: '#0b1220',
        height: '90vh',                 // matches canvas height
        position: 'sticky',
        top: 0,
        overflowY: 'auto',              // scroll if buttons wrap
      }}
    >

      <strong style={{ marginBottom: 4 }}>My Workflows</strong>
      <Select
        options={options}
        value={selected}
        onChange={(opt) => {
          const id = opt?.value ?? null;
          setSelectedWorkflow(id);     // <-- direct, safe, inside provider
        }}
        placeholder="Pick a workflow…"
        components={{ MenuList, Option: StatusOption, SingleValue: StatusSingleValue }}
        isClearable
        styles={{
          control: (base) => ({ ...base, background: '#111827', borderColor: '#374151', color: '#e5e7eb' }),
          singleValue: (base) => ({ ...base, color: '#e5e7eb' }),
          menu: (base) => ({ ...base, background: '#0b1220', color: '#e5e7eb' }),
          option: (base, s) => ({ ...base, background: s.isFocused ? '#111827' : '#0b1220', color: '#e5e7eb' }),
        }}
        theme={(t) => ({ ...t, colors: { ...t.colors, primary25: '#111827', primary: '#3b82f6' } })}
      />

      
      <strong style={{ marginBottom: 4 }}>Tools <FaPuzzlePiece/> </strong>

      <button onClick={() => addNode('pre-process')} className="btn"> <FaPlus />pre-process</button>
      <button onClick={() => addNode('calibration-config')} className="btn"> <FaPlus /> calibration config</button>
      <button onClick={() => addNode('calibration-run')} className="btn"> <FaPlus /> calibration run</button>
      <button onClick={() => addNode('run-ngiab')} className="btn"> <FaPlus /> run ngiab</button>
      <button onClick={() => addNode('teehr')} className="btn"> <FaPlus />  teehr</button>

      <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '6px 0' }} />
        {/* Row: Remove + Auto-layout LR/TB */}
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={removeSelected} className="btn btn-danger" style={{ display:'flex', alignItems:'center', gap:6 }}>
            <FaTrashAlt/>
          </button>
          <button onClick={() => autoLayout('LR')} className="btn"><LuAlignVerticalJustifyStart /></button>
          <button onClick={() => autoLayout('TB')} className="btn"><LuAlignStartVertical /></button>
          <button onClick={runWorkflow} className="btn"> <FaPlay /> </button>
        </div>

      <hr style={{ border: 'none', borderTop: '1px solid #374151', margin: '6px 0' }} />

      
      <div style={{ display: 'flex', gap: 6 }}>
         
      </div>

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
      <ToastContainer position="top-right" />
    </WorkflowsProvider>
  );
}
