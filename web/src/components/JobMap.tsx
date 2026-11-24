import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { daysOnUs, mapCategory, type MapCategory, type OfficeJob } from "../../../shared/domain";
import { jobTypeLabel, money, addressLine } from "../util";

export const MAP_COLORS: Record<MapCategory, string> = {
  sale: "#16a34a", // New / Used
  shop_build: "#2563eb",
  repo: "#dc2626", // Repo / Attempted Repo
  private_move: "#9333ea",
};
const LABELS: Record<MapCategory, string> = { sale: "New / Used", shop_build: "Shop Build", repo: "Repo", private_move: "Private Move" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Pipeline jobs as colored pins. Clicking a pin's "Open" button opens the job. */
export function JobMap({ jobs, onOpen }: { jobs: OfficeJob[]; onOpen: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: true }).setView([34.2, -85.8], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest("[data-open]") as HTMLElement | null;
      if (t?.dataset.open) openRef.current(t.dataset.open);
    };
    el.current.addEventListener("click", onClick);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const placed = jobs.filter((j) => j.lat !== null && j.lng !== null);
    for (const j of placed) {
      const cat = mapCategory(j.jobType, j.customerName);
      const days = daysOnUs(j.createdAt);
      L.circleMarker([j.lat!, j.lng!], {
        radius: 8, color: "#fff", weight: 2, fillColor: MAP_COLORS[cat], fillOpacity: 0.95, dashArray: j.geoApprox ? "3" : undefined,
      })
        .bindTooltip(esc(j.customerName))
        .bindPopup(
          `<b>${esc(j.customerName)}</b><br>${esc(jobTypeLabel(j.jobType))}${cat === "shop_build" && j.jobType !== "shop_build" ? " (shop-build lot)" : ""}` +
            `<br>${esc(addressLine(j.address, j.city))}${j.geoApprox ? " <i>(town only)</i>" : ""}` +
            `<br>${days === 0 ? "Added today" : `${days} day${days === 1 ? "" : "s"} on us`}${j.balanceCents ? ` · owes ${esc(money(j.balanceCents))}` : ""}` +
            `<br><button class="map-open" data-open="${esc(j.id)}">Open job</button>`,
        )
        .addTo(g);
    }
    if (placed.length && !fitted.current) {
      m.fitBounds(L.latLngBounds(placed.map((j) => [j.lat!, j.lng!] as [number, number])).pad(0.2), { maxZoom: 11 });
      fitted.current = true;
    }
  }, [jobs]);

  const unplaced = jobs.filter((j) => j.lat === null || j.lng === null).length;
  return (
    <section className="map-card card">
      <div className="map-head">
        <b>Pipeline map</b>
        <div className="legend">
          {(Object.keys(MAP_COLORS) as MapCategory[]).map((c) => (
            <span key={c}><i className="dot" style={{ background: MAP_COLORS[c] }} /> {LABELS[c]}</span>
          ))}
          {unplaced > 0 && <span className="muted">· {unplaced} not on the map yet</span>}
        </div>
      </div>
      <div ref={el} className="map-canvas" />
    </section>
  );
}
