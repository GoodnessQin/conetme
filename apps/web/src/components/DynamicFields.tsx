import type { FieldDef } from "../lib/types";
import { Field } from "./ui";

export type Values = Record<string, string | string[]>;

export function validateFields(schema: FieldDef[], v: Values): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of schema) {
    const val = v[f.name];
    const empty = val === undefined || (Array.isArray(val) ? val.length === 0 : String(val).trim() === "");
    if (f.required && empty) e[f.name] = f.type === "select" || f.type === "multiselect" ? "Choose an option." : "This field is required.";
    if (!empty && f.type === "number" && !(Number(val) > 0)) e[f.name] = "Enter a number greater than zero.";
    if (!empty && f.type === "textarea" && f.required && String(val).trim().length < 15) e[f.name] = "Add a little more detail so providers can quote accurately.";
  }
  return e;
}

export function DynamicFields({ schema, values, errors, onChange }: {
  schema: FieldDef[]; values: Values; errors: Record<string, string>; onChange: (name: string, v: string | string[]) => void;
}) {
  return (
    <>
      {schema.map((f) => {
        const id = `f-${f.name}`;
        const val = values[f.name];
        const label = f.required ? f.label : `${f.label} (optional)`;
        return (
          <Field key={f.name} label={label} htmlFor={id} error={errors[f.name]}>
            {f.type === "textarea" && <textarea id={id} rows={4} className="input" value={(val as string) ?? ""} onChange={(e) => onChange(f.name, e.target.value)} />}
            {(f.type === "text" || f.type === "number") && (
              <input id={id} className="input" type={f.type === "number" ? "number" : "text"} inputMode={f.type === "number" ? "numeric" : undefined} min={f.type === "number" ? 1 : undefined}
                value={(val as string) ?? ""} onChange={(e) => onChange(f.name, e.target.value)} />
            )}
            {f.type === "select" && (
              <select id={id} className="input" value={(val as string) ?? ""} onChange={(e) => onChange(f.name, e.target.value)}>
                <option value="">Select…</option>
                {f.options?.map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
            {f.type === "multiselect" && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={f.label}>
                {f.options?.map((o) => {
                  const on = Array.isArray(val) && val.includes(o);
                  return (
                    <button key={o} type="button" aria-pressed={on}
                      onClick={() => onChange(f.name, on ? (val as string[]).filter((x) => x !== o) : [...((val as string[]) ?? []), o])}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold ${on ? "border-brand bg-brand-50 text-brand" : "border-line bg-white"}`}>{o}</button>
                  );
                })}
              </div>
            )}
          </Field>
        );
      })}
    </>
  );
}

/** Shows a request's saved answers using the service's own field labels. */
export function DetailsList({ schema, details }: { schema: FieldDef[]; details: Record<string, unknown> }) {
  const rows = schema.filter((f) => details[f.name] !== undefined && String(details[f.name]) !== "");
  if (rows.length === 0) return <p className="text-sm text-muted">No extra details were given.</p>;
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map((f) => (
        <div key={f.name} className="py-2.5">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</dt>
          <dd className="mt-0.5 whitespace-pre-line font-medium">{Array.isArray(details[f.name]) ? (details[f.name] as string[]).join(", ") : String(details[f.name])}</dd>
        </div>
      ))}
    </dl>
  );
}
