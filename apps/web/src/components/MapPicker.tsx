import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Button } from "./ui";

export interface LatLng { lat: number; lng: number }
const pin = L.divIcon({ className: "", html: '<div class="cm-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 28] });

/** Pick a spot by tapping the map, dragging the pin, searching a landmark, or using the phone's location. */
export function MapPicker({ center, value, onChange, readOnly = false, height = 300 }: {
  center: LatLng; value: LatLng | null; onChange?: (p: LatLng) => void; readOnly?: boolean; height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const start = value ?? center;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, dragging: true }).setView([start.lat, start.lng], value ? 17 : 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
    map.current = m;
    if (!readOnly) m.on("click", (e: L.LeafletMouseEvent) => place({ lat: e.latlng.lat, lng: e.latlng.lng }, false));
    if (value) putMarker(value);
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-centre when the chosen area changes and no pin has been dropped yet.
  useEffect(() => { if (!value && map.current) map.current.setView([center.lat, center.lng], 14); }, [center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (value && map.current) { putMarker(value); } }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  function putMarker(p: LatLng) {
    if (!map.current) return;
    if (!marker.current) {
      marker.current = L.marker([p.lat, p.lng], { icon: pin, draggable: !readOnly }).addTo(map.current);
      marker.current.on("dragend", () => { const ll = marker.current!.getLatLng(); cb.current?.({ lat: ll.lat, lng: ll.lng }); });
    } else marker.current.setLatLng([p.lat, p.lng]);
  }
  function place(p: LatLng, zoom = true) {
    putMarker(p);
    if (zoom) map.current?.setView([p.lat, p.lng], 17);
    cb.current?.(p);
    setMsg("");
  }
  function locate() {
    if (!navigator.geolocation) return setMsg("This device cannot share its location. Tap the map instead.");
    setBusy(true); setMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setBusy(false); place({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setBusy(false); setMsg("We could not get your location. Allow location access in your browser, or tap the map."); },
      { enableHighAccuracy: true, timeout: 10_000 });
  }
  async function search() {
    if (q.trim().length < 3) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ng&limit=1&q=${encodeURIComponent(q.trim())}`);
      const j = (await r.json()) as { lat: string; lon: string }[];
      if (!j[0]) setMsg("We could not find that place. Try a nearby landmark, or tap the map.");
      else place({ lat: Number(j[0].lat), lng: Number(j[0].lon) });
    } catch { setMsg("Search is unavailable right now. Tap the map to drop your pin."); }
    setBusy(false);
  }

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input aria-label="Search for a landmark" className="input" placeholder="Search a landmark, e.g. Shoprite Lekki" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
          <Button type="button" variant="soft" className="sm:!w-auto sm:!px-5" loading={busy} onClick={search}>Search</Button>
          <Button type="button" variant="ghost" className="sm:!w-auto sm:!px-5" disabled={busy} onClick={locate}>Use my location</Button>
        </div>
      )}
      <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-line" role="application" aria-label={readOnly ? "Job location map" : "Map: tap to drop a pin on the job location"} />
      {msg && <p role="alert" className="mt-2 text-sm text-danger">{msg}</p>}
      {!readOnly && <p className="mt-2 text-xs text-muted">{value ? "Pin placed. Drag it, or tap the map, to adjust. Put it on the building entrance if you can." : "Tap the map to drop a pin where the work will happen."}</p>}
    </div>
  );
}

export const mapsLinks = (p: LatLng) => ({
  view: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`,
  directions: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
});
