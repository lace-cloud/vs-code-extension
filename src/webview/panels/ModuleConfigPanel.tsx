import React, { useState } from 'react';

export default function ModuleConfigPanel({
  title,
  inputs,
  initialValues,
  onSave,
  onClose,
}: any) {
  const [values, setValues] = useState({ ...initialValues });

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        width: 500,
        background: '#111',
        border: '1px solid #333',
        borderRadius: 10,
        padding: 16,
        color: '#fff',
        zIndex: 10,
      }}
    >
      <h3>{title}</h3>

      {inputs.map((i: any) => (
        <div key={i.name} style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12 }}>{i.name}</label>

          {i.type === 'bool' ? (
            <input
              type="checkbox"
              checked={!!values[i.name]}
              onChange={(e) =>
                setValues({ ...values, [i.name]: e.target.checked })
              }
            />
          ) : (
            <input
              value={values[i.name] ?? ''}
              onChange={(e) =>
                setValues({ ...values, [i.name]: e.target.value })
              }
              style={{ width: '100%' }}
            />
          )}
        </div>
      ))}

      <button onClick={() => onSave(values)}>Save</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
