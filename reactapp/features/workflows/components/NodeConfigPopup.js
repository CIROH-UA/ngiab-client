// features/workflows/components/NodeConfigPopup.js
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

  return (
    <div
      ref={ref}
      // NOTE: no absolute positioning; the NodeToolbar handles placement & scale.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
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
          const common = {
            id: `${nodeId}-${f.name}`,
            value: values[f.name] ?? '',
            onChange: (e) => set(f.name, e.target.value),
            style: {
              width: '100%',
              background: '#111827',
              color: '#e5e7eb',
              border: '1px solid #374151',
              borderRadius: 8,
              padding: '6px 8px',
            },
          };
          return (
            <label key={f.name} htmlFor={common.id} style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 4, opacity: 0.9 }}>{f.label}</div>
              {f.type === 'select' ? (
                <select {...common}>
                  {(f.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input type={f.type || 'text'} {...common} />
              )}
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
