import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CALL_STATUS_LABELS, daysOnUs, mapCategory, type MapCategory, type OfficeJob } from "../../../shared/domain";
import { addressLine, jobTypeLabel, money } from "../util";

export const MAP_COLORS: Record<MapCategory, string> = {
  sale: "#16a34a", // New / Used
  shop_build: "#2563eb",
  inv_haul: "#d97706", // shed-shaped pin
  repo: "#dc2626", // Repo / Attempted Repo
  private_move: "#9333ea",
};
const LABELS: Record<MapCategory, string> = { sale: "New / Used", shop_build: "Shop Build", inv_haul: "INV Haul", repo: "Repo", private_move: "Private Move" };
// OpenFreeMap: free map tiles, no key, no usage limits, OK for business use.
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** A little shed (roofline) for INV Haul pins. */
const shedSvg = (color: string, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 2 L23 11 L20 11 L20 22 L4 22 L4 11 L1 11 Z" fill="${color}" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Pipeline jobs as colored pins. Click a pin for details; press and drag a pin onto a calendar day to schedule it.
 * The map grabs mouse-downs for panning (so the browser's drag-and-drop never starts), so pins use their own
 * pointer drag: a label follows the pointer and the drop goes to whatever [data-drop] element is under it.
 */
export function JobMap({ jobs, onOpen, onPinDrop, onPinHover, big, onToggleSize }: {
  jobs: OfficeJob[];
  onOpen: (id: string) => void;
  onPinDrop?: (jobId: string, target: string) => void;
  onPinHover?: (target: string | null) => void;
  big?: boolean;
  onToggleSize?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const fitted = useRef(false);
  const cb = useRef({ onOpen, onPinDrop, onPinHover });
  cb.current = { onOpen, onPinDrop, onPinHover };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: [-85.8, 34.2], zoom: 6.3, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const placed = jobs.filter((j) => j.lat !== null && j.lng !== null);
    for (const j of placed) {
      const cat = mapCategory(j.jobType, j.customerName);
      const days = daysOnUs(j.createdAt);
      const dot = document.createElement("div");
      dot.className = `map-pin${cat === "inv_haul" ? " shed" : ""}${j.geoApprox ? " approx" : ""}`;
      if (cat === "inv_haul") dot.innerHTML = shedSvg(MAP_COLORS[cat], 24);
      else dot.style.background = MAP_COLORS[cat];
      dot.dataset.jobId = j.id;
      dot.dataset.color = MAP_COLORS[cat];
      const popup = makePopup(j, cat, days);
      // Hover: a quick card with the customer's info (no click needed).
      const hover = makeHover(j, cat, days);
      dot.addEventListener("mouseenter", () => { if (!popup.isOpen() && !document.querySelector(".pin-ghost")) hover.setLngLat([j.lng!, j.lat!]).addTo(m); });
      dot.addEventListener("mouseleave", () => hover.remove());
      dot.addEventListener("pointerdown", (e) => { hover.remove(); startPinDrag(e, j, dot, m, popup); });
      // The map closes popups on any click; keep the pin's own click from reaching it.
      dot.addEventListener("click", (e) => e.stopPropagation());
      markers.current.push(new maplibregl.Marker({ element: dot }).setLngLat([j.lng!, j.lat!]).addTo(m));
    }
    if (placed.length && !fitted.current) {
      const b = new maplibregl.LngLatBounds();
      placed.forEach((j) => b.extend([j.lng!, j.lat!]));
      m.fitBounds(b, { padding: 50, maxZoom: 11, duration: 0 });
      fitted.current = true;
    }
  }, [jobs]);

  function makeHover(j: OfficeJob, cat: MapCategory, days: number) {
    const line = (label: string, v: string | null | undefined) => (v ? `<div><span class="hl">${label}</span> ${esc(v)}</div>` : "");
    return new maplibregl.Popup({ offset: 12, closeButton: false, closeOnClick: false, className: "map-hover", maxWidth: "300px" }).setHTML(
      `<b>${esc(j.customerName)}</b>` +
        `<div class="hv-type" style="color:${MAP_COLORS[cat]}">${esc(jobTypeLabel(j.jobType))}${cat === "shop_build" && j.jobType !== "shop_build" ? " (shop-build lot)" : ""}</div>` +
        line("Address", addressLine(j.address, j.city) + (j.geoApprox ? " (town only)" : "")) +
        line("Phone", j.phone) +
        line("Serial", j.serial) +
        line("Building", j.building) +
        line("Balance", j.balanceCents === null ? null : j.balanceCents ? money(j.balanceCents) : "None") +
        line("Calls", `${CALL_STATUS_LABELS[j.callStatus]}${j.callAttempts ? ` (${j.callAttempts} attempt${j.callAttempts === 1 ? "" : "s"})` : ""}`) +
        line("On us", days === 0 ? "Added today" : `${days} day${days === 1 ? "" : "s"}`) +
        (j.officeNotes ? line("Notes", j.officeNotes.length > 120 ? j.officeNotes.slice(0, 120) + "…" : j.officeNotes) : "") +
        `<div class="hv-hint">${cb.current.onPinDrop ? "Click for options · drag onto a day to schedule" : "Click for options"}</div>`,
    );
  }

  function makePopup(j: OfficeJob, cat: MapCategory, days: number) {
    const popup = new maplibregl.Popup({ offset: 12, closeButton: true }).setHTML(
      `<b>${esc(j.customerName)}</b><br>${esc(jobTypeLabel(j.jobType))}${cat === "shop_build" && j.jobType !== "shop_build" ? " (shop-build lot)" : ""}` +
        `<br>${esc(addressLine(j.address, j.city))}${j.geoApprox ? " <i>(town only)</i>" : ""}` +
        `<br>${days === 0 ? "Added today" : `${days} day${days === 1 ? "" : "s"} on us`}${j.balanceCents ? ` · owes ${esc(money(j.balanceCents))}` : ""}` +
        `<br><button class="map-open" data-open="${esc(j.id)}">Open job</button>`,
    );
    popup.on("open", () => {
      popup.getElement()?.querySelector("[data-open]")?.addEventListener("click", () => { popup.remove(); cb.current.onOpen(j.id); });
    });
    return popup;
  }

  /** Press on a pin: a short press opens the popup; moving more than a few pixels drags it toward the calendar. */
  function startPinDrag(e: PointerEvent, j: OfficeJob, dot: HTMLElement, m: maplibregl.Map, popup: maplibregl.Popup) {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let ghost: HTMLDivElement | null = null;
    let target: string | null = null;
    m.dragPan.disable();
    const targetAt = (x: number, y: number) => {
      if (ghost) ghost.style.display = "none";
      const t = (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
      if (ghost) ghost.style.display = "";
      return t;
    };
    const move = (ev: PointerEvent) => {
      if (!cb.current.onPinDrop) return;
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "pin-ghost";
        ghost.textContent = j.customerName;
        ghost.style.borderLeftColor = dot.dataset.color ?? "";
        document.body.appendChild(ghost);
        popup.remove();
      }
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 8}px`;
      const t = targetAt(ev.clientX, ev.clientY);
      if (t !== target) { target = t; cb.current.onPinHover?.(t); }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      m.dragPan.enable();
      if (ghost) {
        const t = targetAt(ev.clientX, ev.clientY);
        ghost.remove();
        cb.current.onPinHover?.(null);
        if (t) cb.current.onPinDrop?.(j.id, t);
      } else {
        popup.setLngLat([j.lng!, j.lat!]).addTo(m);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const unplaced = jobs.filter((j) => j.lat === null || j.lng === null).length;
  return (
    <section className="map-card card">
      <div className="map-head">
        <div className="row-wrap" style={{ gap: 8 }}>
          <b>Pipeline map {onPinDrop && <span className="muted small" style={{ fontWeight: 400 }}>· drag a pin onto a day to schedule it</span>}</b>
          {onToggleSize && <button className="btn small" onClick={onToggleSize}>{big ? "⤡ Smaller map" : "⤢ Bigger map"}</button>}
        </div>
        <div className="legend">
          {(Object.keys(MAP_COLORS) as MapCategory[]).map((c) => (
            <span key={c}>
              {c === "inv_haul" ? <i className="shed-key" dangerouslySetInnerHTML={{ __html: shedSvg(MAP_COLORS[c], 14) }} /> : <i className="dot" style={{ background: MAP_COLORS[c] }} />} {LABELS[c]}
            </span>
          ))}
          {jobs.some((j) => j.geoApprox && j.lat !== null) && <span title="The exact address wasn't found, so the pin is in the middle of the town"><i className="approx-key">?</i> Town only</span>}
          {unplaced > 0 && <span className="muted">· {unplaced} not on the map yet</span>}
        </div>
      </div>
      <div ref={el} className="map-canvas" />
    </section>
  );
}
