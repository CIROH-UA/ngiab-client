import React, { useEffect, useRef, useState } from 'react';

export default function NodeConfigPopup({
  nodeId,
  visible,
  fields = [],
  initialValues = {},
  onSubmit,
  onClose,
}) {
  const [values, setValues] = useState(initialValues || {});
  const ref = useRef(null);

  useEffect(() => {
    setValues(initialValues || {});
  }, [initialValues, nodeId]);

  if (!visible) return null;

  const set = (name, val) => setValues((v) => ({ ...v, [name]: val }));
  const getBool = (v) => (typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true');

  // prevent canvas from swallowing pointerup
  const stopAll = (e) => { e.stopPropagation(); };

  const baseInputStyle = {
    width: '100%',
    background: '#111827',
    color: '#e5e7eb',
    border: '1px solid #374151',
    borderRadius: 8,
    padding: '6px 8px',
  };

  const Toggle = ({ id, checked, onChange }) => (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: 34, height: 20, borderRadius: 999,
        border: '1px solid #374151',
        background: checked ? '#2563eb' : '#1f2937',
        position: 'relative', cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 2, left: checked ? 22 : 2,
          width: 15, height: 15, borderRadius: '50%',
          background: '#e5e7eb',
          transition: 'left 120ms ease',
        }}
      />
    </button>
  );
  // --- Custom stepper to avoid native spinner auto-repeat ---
  const StepperInput = ({ id, value, onChange, step = 1, min, max }) => {
    const parse = (raw) => {
      if (raw === '' || raw === '-') return raw;
      const n = Number.parseInt(String(raw), 10);
      return Number.isFinite(n) ? String(n) : '';
    };
    const clamp = (n) => {
      let x = n;
      if (typeof min === 'number') x = Math.max(x, min);
      if (typeof max === 'number') x = Math.min(x, max);
      return x;
    };
    const inc = () => {
      const n = Number.parseInt(value || '0', 10);
      const next = clamp((Number.isFinite(n) ? n : 0) + step);
      onChange(String(next));
    };
    const dec = () => {
      const n = Number.parseInt(value || '0', 10);
      const next = clamp((Number.isFinite(n) ? n : 0) - step);
      onChange(String(next));
    };

    return (
      <div
        className="nodrag nowheel"
        onPointerDown={stopAll}
        onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value ?? ''}
          onChange={(e) => onChange(parse(e.target.value))}
          onKeyDown={(e) => {
            if (['e','E','+'].includes(e.key)) e.preventDefault();
            if (e.key === 'ArrowUp') { e.preventDefault(); inc(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); dec(); }
          }}
          style={baseInputStyle}
        />
      </div>
    );
  };

  // --- Conditional visibility rules requested ---
  const importByUrl = getBool(values.import_data || false);
  const customizeOut = getBool(values.customize_output_path || false);

  const isHidden = (name) => {
    if (name === 'input_s3_url') {
      return !importByUrl; // show only when toggle ON
    }
    if (name === 'input_bucket' || name === 'input_key') {
      return importByUrl;  // hide when toggle ON
    }
    if (name === 'output_bucket' || name === 'output_prefix') {
      return !customizeOut; // show only when toggle ON
    }
    return false;
  };

  return (
    <div
      ref={ref}
      // Use bubble-phase only so children receive clicks first
      onPointerDown={stopAll}
      onPointerUp={stopAll}
      onMouseDown={stopAll}
      onClick={stopAll}
      onWheel={stopAll}
      style={{
        width: 260,
        background: '#0b1220',
        color: '#e5e7eb',
        border: '1px solid #334155',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        padding: 10,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Node settings</div>

      <div style={{ display: 'grid', gap: 8 }}>
        {fields.map((f) => {
          const id = `${nodeId}-${f.name}`;
          const val = values[f.name];

          if (isHidden(f.name)) return null;

          if (f.type === 'toggle') {
            const on = getBool(val || false);
            return (
              <div key={f.name} className="nodrag nowheel" onPointerDown={stopAll}>
                <div
                  onClick={() => set(f.name, !on)} // clicking label row toggles
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <div style={{ marginBottom: 4, opacity: 0.9 }}>{f.label}</div>
                  <Toggle
                    id={`${nodeId}-${f.name}`}
                    checked={on}
                    onChange={(checked) => set(f.name, checked)} // clicking switch toggles
                  />
                </div>
              </div>
            );
          }

          if (f.type === 'select') {
            return (
              <label key={f.name} htmlFor={id} style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 4, opacity: 0.9 }}>{f.label}</div>
                <select
                  id={id}
                  className="nodrag nowheel"
                  onPointerDown={stopAll}
                  onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  value={val ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
                  style={baseInputStyle}
                >
                  {(f.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            );
          }

          if (f.type === 'number') {
            return (
              <label key={f.name} htmlFor={id} style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 4, opacity: 0.9 }}>{f.label}</div>
                <StepperInput
                  id={id}
                  value={val ?? ''}
                  onChange={(v) => set(f.name, v)}
                  step={1}
                />
              </label>
            );
          }

          return (
            <label key={f.name} htmlFor={id} style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 4, opacity: 0.9 }}>{f.label}</div>
              <input
                id={id}
                type={f.type || 'text'}
                value={val ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
                className="nodrag nowheel"
                onPointerDown={stopAll}
                onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
                placeholder={f.placeholder}
                style={baseInputStyle}
              />
            </label>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={() => onClose?.()}
          style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid #4b5563',
            background: '#1f2937', color: '#e5e7eb', cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit?.(values)}
          style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid #3b82f6',
            background: '#1f2937', color: '#e5e7eb', cursor: 'pointer'
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
