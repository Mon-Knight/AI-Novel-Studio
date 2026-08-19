function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
function arrayToLines(value: string[]): string {
  return value.join('\n');
}

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      {multiline ? (
        <textarea
          className="panel-textarea"
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="panel-input"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      <input
        className="panel-input"
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next ? Number(next) : undefined);
        }}
      />
    </label>
  );
}

export function ListField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      <textarea
        className="panel-textarea"
        value={arrayToLines(value)}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(linesToArray(event.target.value))}
      />
    </label>
  );
}
