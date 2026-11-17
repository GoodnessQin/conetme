import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messageFrom, rpc } from "../../lib/api";
import { stateLabel } from "../../components/LocationPicker";
import { MapPicker, type LatLng } from "../../components/MapPicker";
import { Button, Card, Dialog, Field, ListSkeleton, PageHeader, Pill, Switch, useToast } from "../../components/ui";

interface AreaRow { id: string; name: string; city: string; state: string; lat: number; lng: number; active: boolean; providers: number }
interface Draft { id: string | null; state: string; city: string; name: string; pin: LatLng | null; active: boolean }
const blank = (state = ""): Draft => ({ id: null, state, city: "", name: "", pin: null, active: false });
const NG_CENTER: LatLng = { lat: 9.08, lng: 7.4 };

/** Launch Nigeria one state at a time. A state's areas are hidden from customers until you switch it on. */
export default function AdminLocations() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-areas"], queryFn: () => rpc<AreaRow[]>("admin_areas") });
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-areas"] }); qc.invalidateQueries({ queryKey: ["areas"] }); };
  const launch = useMutation({ mutationFn: (v: { state: string; on: boolean }) => rpc<number>("admin_set_state_active", { p_state: v.state, p_active: v.on }), onSuccess: (_n, v) => { refresh(); toast(v.on ? `${stateLabel(v.state)} is now live for customers.` : `${stateLabel(v.state)} is hidden from customers.`); }, onError: (e) => toast(messageFrom(e)) });
  const save = useMutation({
    mutationFn: (x: Draft) => rpc("admin_upsert_area", { p_id: x.id, p_state: x.state, p_city: x.city, p_name: x.name, p_lat: x.pin?.lat, p_lng: x.pin?.lng, p_active: x.active }),
    onSuccess: () => { refresh(); setD(null); toast("Area saved."); }, onError: (e) => setErr(messageFrom(e)),
  });
  if (q.isLoading) return <ListSkeleton />;
  const rows = q.data ?? [];
  const states = [...new Set(rows.map((r) => r.state))];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Locations" subtitle="Customers and providers only see states that are live. Add areas first, then switch the state on."
        actions={<Button className="!w-auto !px-5 !py-2.5 !text-sm" onClick={() => { setErr(""); setD(blank()); }}>Add area</Button>} />
      <div className="space-y-5">
        {states.map((s) => {
          const list = rows.filter((r) => r.state === s);
          const live = list.every((r) => r.active);
          const some = list.some((r) => r.active);
          return (
            <Card key={s}>
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-lg font-extrabold">{stateLabel(s)}</p><p className="text-sm text-muted">{list.length} areas · {list.reduce((n, r) => n + Number(r.providers), 0)} approved providers</p></div>
                <div className="flex items-center gap-3">{live ? <Pill tone="success">Live</Pill> : some ? <Pill tone="warning">Partly live</Pill> : <Pill>Hidden</Pill>}
                  <Switch checked={live} onChange={(on) => launch.mutate({ state: s, on })} label={`Make ${stateLabel(s)} live`} disabled={launch.isPending} /></div>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span><b>{r.name}</b> <span className="text-muted">{r.city}{r.providers ? ` · ${r.providers} providers` : ""}</span></span>
                    <span className="flex items-center gap-3">{!r.active && <span className="text-xs text-muted">hidden</span>}
                      <button className="font-bold text-brand" onClick={() => { setErr(""); setD({ id: r.id, state: r.state, city: r.city, name: r.name, pin: { lat: r.lat, lng: r.lng }, active: r.active }); }}>Edit</button></span>
                  </li>
                ))}
              </ul>
              <button className="mt-3 text-sm font-bold text-brand" onClick={() => { setErr(""); setD(blank(s)); }}>+ Add an area in {stateLabel(s)}</button>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit area" : "Add an area"}
        footer={<><Button variant="ghost" onClick={() => setD(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => { setErr(""); if (d) { if (!d.pin) return setErr("Drop a pin on the map for this area."); save.mutate(d); } }}>Save area</Button></>}>
        {d && (<>
          <Field label="State" htmlFor="ls" hint="Use FCT for Abuja."><input id="ls" className="input" value={d.state} onChange={(e) => setD({ ...d, state: e.target.value })} placeholder="Rivers" /></Field>
          <Field label="City" htmlFor="lc"><input id="lc" className="input" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} placeholder="Port Harcourt" /></Field>
          <Field label="Area or neighbourhood" htmlFor="ln"><input id="ln" className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="GRA Phase 2" /></Field>
          <Field label="Centre of the area" hint="Customers' distance to providers is measured from here."><MapPicker center={d.pin ?? NG_CENTER} value={d.pin} onChange={(p) => setD({ ...d, pin: p })} /></Field>
          <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label="Visible to customers" />
          {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        </>)}
      </Dialog>
    </div>
  );
}
