import { Fragment, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CALL_STATUSES, JOB_TYPES, type JobType, type Me, type OfficeJob, type TeamMember } from "../../../shared/domain";
import { api } from "../api";
import { CallPill, ErrorText, JobTypePill, Modal } from "../components/bits";
import { JobDrawer } from "./JobDrawer";
import { JobMap } from "../components/JobMap";
import { CALL_STATUS_LABELS, daysOnUs, type CallStatus } from "../../../shared/domain";
import { copyImportInstructions } from "./Import";
import { useNavigate } from "react-router-dom";
import { addDays, fmtDay, jobTypeLabel, mapsUrl, money, weekStart, addressLine } from "../util";

interface BoardData {
  today: string;
  from: string;
  to: string;
  pipeline: OfficeJob[];
  scheduled: OfficeJob[];
}

export function useTeam(enabled = true) {
  return useQuery({ queryKey: ["team"], queryFn: () => api.get<TeamMember[]>("/team"), enabled, staleTime: 60_000 });
}

export function Board({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [assign, setAssign] = useState<{ job: OfficeJob; date: string; sortOrder?: number; renumber?: () => void } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [menu, setMenu] = useState<{ job: OfficeJob; x: number; y: number } | null>(null);
  const [search, setSearch] = useState("");
  const [dropAt, setDropAt] = useState<{ day: string; index: number } | null>(null);
  // Day the dragged card came from: only drags within the same day reorder; anything else goes to the end (order placed).
  const dragFromDay = useRef<string | null>(null);
  const [mapBig, setMapBig] = useState(() => { try { return localStorage.getItem("mapBig") === "1"; } catch { return false; } });
  const toggleMap = () => setMapBig((v) => { try { localStorage.setItem("mapBig", v ? "0" : "1"); } catch { /* private mode */ } return !v; });
  const navigate = useNavigate();

  const first = useQuery({ queryKey: ["board-today"], queryFn: () => api.get<BoardData>("/jobs/board"), staleTime: 300_000 });
  const from = anchor ?? (first.data ? weekStart(first.data.today) : null);
  const to = from ? addDays(from, 6) : null;
  const board = useQuery({
    queryKey: ["board", from],
    queryFn: () => api.get<BoardData>(`/jobs/board?from=${from}&to=${to}`),
    enabled: !!from,
    refetchInterval: 60_000,
  });
  const team = useTeam();
  const drivers = (team.data ?? []).filter((u) => u.role === "driver" && u.active);
  const canEdit = me.permissions.editSchedule;

  const move = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.patch<OfficeJob>(`/jobs/${v.id}`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board"] }),
    onError: setErr,
  });

  if (!board.data || !from) return <div className="muted">Loading…</div>;
  const { pipeline: allPipeline, scheduled, today } = board.data;
  const missingNs = [...allPipeline, ...scheduled].filter((j) => j.missingFromNetsuiteAt && j.stage !== "submitted" && j.stage !== "approved");
  const pipeline = search.trim() ? allPipeline.filter((j) => matchesSearch(j, search)) : allPipeline;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const all = [...pipeline, ...scheduled];

  function onDragStart(e: DragEvent, job: OfficeJob) {
    if (job.stage === "pipeline") dragFromDay.current = null;
    e.dataTransfer.setData("text/job-id", job.id);
    e.dataTransfer.effectAllowed = "move";
  }
  function dropOn(e: DragEvent, target: string) {
    e.preventDefault();
    placeJob(e.dataTransfer.getData("text/job-id"), target);
  }
  /** Drop a job on "pipeline" or a day (YYYY-MM-DD). Used by card drags and map-pin drags. */
  /** Drop a job on "pipeline" or a day (YYYY-MM-DD), optionally at a position in that day (default: last). */
  function placeJob(id: string, target: string, index?: number) {
    setDropTarget(null);
    setDropAt(null);
    const job = all.find((j) => j.id === id);
    if (!job || !canEdit) return;
    setErr(null);
    if (target === "pipeline") {
      if (job.stage === "scheduled") move.mutate({ id, body: { scheduledDate: null } });
      return;
    }
    if (job.stage === "submitted" || job.stage === "approved") { setErr(new Error("Finished jobs can't be moved.")); return; }
    // New order for that day with this job at the drop position; renumber 10, 20, 30…
    const day = scheduled.filter((j) => j.scheduledDate === target && j.id !== id);
    const at = Math.max(0, Math.min(index ?? day.length, day.length));
    const ordered = [...day.slice(0, at), job, ...day.slice(at)];
    const myOrder = (at + 1) * 10;
    const others = ordered.filter((j) => j.id !== id).map((j) => ({ j, order: (ordered.indexOf(j) + 1) * 10 })).filter(({ j, order }) => j.sortOrder !== order);
    const renumber = () => { for (const { j, order } of others) move.mutate({ id: j.id, body: { sortOrder: order } }); };
    if (job.driverId) {
      move.mutate({ id, body: job.scheduledDate === target ? { sortOrder: myOrder } : { scheduledDate: target, sortOrder: myOrder } });
      renumber();
    } else setAssign({ job, date: target, sortOrder: myOrder, renumber });
  }
  /** Where in a day's list the pointer is: before the first card whose middle is below it. */
  function indexAt(dayEl: HTMLElement, clientY: number): number {
    const cards = [...dayEl.querySelectorAll<HTMLElement>(".ev[data-id]")].filter((c) => !c.classList.contains("dragging"));
    const i = cards.findIndex((c) => { const r = c.getBoundingClientRect(); return clientY < r.top + r.height / 2; });
    return i === -1 ? cards.length : i;
  }
  const dropProps = (target: string) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            setDropTarget(target);
            if (target !== "pipeline" && dragFromDay.current === target) {
              const index = indexAt(e.currentTarget as HTMLElement, e.clientY);
              setDropAt((d) => (d && d.day === target && d.index === index ? d : { day: target, index }));
            }
          },
          onDragLeave: (e: DragEvent) => {
            if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
            setDropTarget((t) => (t === target ? null : t));
            setDropAt((d) => (d?.day === target ? null : d));
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/job-id");
            const reorder = target !== "pipeline" && dragFromDay.current === target;
            dragFromDay.current = null;
            placeJob(id, target, reorder ? indexAt(e.currentTarget as HTMLElement, e.clientY) : undefined);
          },
        }
      : {};

  return (
    <div className="board-page">
      <div className="top">
        <div>
          <h1>Week of {fmtDay(from, { month: "short", day: "numeric" })}</h1>
          <div className="muted">Drag jobs from the pipeline onto a day. Click a job for details, calls and photos.</div>
        </div>
        <div className="row-wrap">
          <button className="btn" onClick={() => setAnchor(addDays(from, -7))}>‹ Prev</button>
          <button className="btn" onClick={() => setAnchor(weekStart(today))}>This week</button>
          <button className="btn" onClick={() => setAnchor(addDays(from, 7))}>Next ›</button>
        </div>
      </div>
      <div className="legend">
        <b>Drivers:</b>
        {drivers.map((d) => <span key={d.id}><i className="dot" style={{ background: d.color }} /> {d.name}</span>)}
        {drivers.length === 0 && <span>No drivers yet{me.permissions.manageTeam ? " (add them on the Team page)" : ""}</span>}
        <b style={{ marginLeft: 10 }}>Calls:</b>
        {CALL_STATUSES.map((s) => <CallPill key={s} status={s} />)}
      </div>
      {missingNs.length > 0 && (
        <details className="ns-banner">
          <summary>⚠️ <b>{missingNs.length} job{missingNs.length === 1 ? " isn't" : "s aren't"} in NetSuite's In Progress list anymore.</b> Check whether they were cancelled or finished. <span className="muted">Show</span></summary>
          <div className="ns-list">
            {missingNs.map((j) => (
              <button key={j.id} className="pill cs-attempted" onClick={() => setOpenId(j.id)}>{j.customerName}{j.scheduledDate ? ` · ${fmtDay(j.scheduledDate, { month: "numeric", day: "numeric" })}` : " · pipeline"}</button>
            ))}
          </div>
        </details>
      )}
      <ErrorText error={err} />

      <div className="board">
        <section className={`pipe${dropTarget === "pipeline" ? " drop" : ""}`} {...dropProps("pipeline")}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2>Pipeline <span className="muted">({search.trim() ? `${pipeline.length} of ${allPipeline.length}` : allPipeline.length})</span></h2>
            {canEdit && (
              <div className="row-wrap" style={{ gap: 6 }}>
                <button
                  className="btn small pri"
                  title="Copies the instructions for Claude in Chrome and opens the import page"
                  onClick={async () => { await copyImportInstructions().catch(() => {}); navigate("/import"); }}
                >
                  ⬇ Import from NetSuite
                </button>
                <button className="btn small" onClick={() => setAdding(true)}>＋ Add job</button>
              </div>
            )}
          </div>
          <div className="pipe-search">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, address, phone, serial, lot" aria-label="Search the pipeline" />
          </div>
          {pipeline.length === 0 && <div className="muted small">{search.trim() ? "No jobs match that search." : "No jobs waiting. New jobs land here."}</div>}
          {pipeline.map((j) => (
            <div key={j.id} className="card pc" draggable={canEdit} onDragStart={(e) => onDragStart(e, j)} onClick={() => setOpenId(j.id)}
              onContextMenu={(e) => { if (!canEdit) return; e.preventDefault(); setMenu({ job: j, x: e.clientX, y: e.clientY }); }}>
              <div className="row"><b>{j.customerName}</b><JobTypePill type={j.jobType} /></div>
              {j.missingFromNetsuiteAt && <div className="ns-tag">⚠️ Not in NetSuite</div>}
              <div className="muted">{[j.city, j.building].filter(Boolean).join(" · ")}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="muted small">{j.serial ? `SN ${j.serial}` : ""}</span>
                {j.balanceCents !== null && (j.balanceCents ? <b className="owes">Owes {money(j.balanceCents)}</b> : j.jobType !== "repo" && j.jobType !== "attempted_repo" ? <b className="paid">Paid</b> : null)}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <CallPill status={j.callStatus} attempts={j.callAttempts} />
                <DaysBadge job={j} />
              </div>
            </div>
          ))}
        </section>

        <div className={`right-col${mapBig ? " map-big" : ""}`}>
        <div className="cal">
          {days.map((d) => {
            const dayJobs = scheduled.filter((j) => j.scheduledDate === d);
            return (
              <section key={d} data-drop={d} className={`day${d === today ? " today" : ""}${dropTarget === d ? " drop" : ""}`} {...dropProps(d)}>
                <h3>{fmtDay(d, { weekday: "short", day: "numeric" }).toUpperCase()} <span>{dayJobs.length}</span></h3>
                {dayJobs.map((j, i) => (
                  <Fragment key={j.id}>
                    {dropAt?.day === d && dropAt.index === i && <div className="drop-line" />}
                    <div
                      data-id={j.id}
                      className={`ev compact${j.stage !== "scheduled" ? " done" : ""}`}
                      style={{ borderLeftColor: j.driverColor ?? "#98a2b3" }}
                      draggable={canEdit && j.stage === "scheduled"}
                      onDragStart={(e) => { onDragStart(e, j); dragFromDay.current = d; (e.currentTarget as HTMLElement).classList.add("dragging"); }}
                      onDragEnd={(e) => { (e.currentTarget as HTMLElement).classList.remove("dragging"); dragFromDay.current = null; setDropAt(null); setDropTarget(null); }}
                      onClick={() => setOpenId(j.id)}
                      onContextMenu={(e) => { if (!canEdit || j.stage !== "scheduled") return; e.preventDefault(); setMenu({ job: j, x: e.clientX, y: e.clientY }); }}
                      title={[j.customerName, j.driverName, addressLine(j.address, j.city), j.stage === "scheduled" ? CALL_STATUS_LABELS[j.callStatus] : j.stage].filter(Boolean).join("\n")}
                    >
                      <div className="ev-line1">
                        {j.stage === "scheduled" ? <i className={`dot cs-dot-${j.callStatus}`} /> : <span className={`stage-tag st-${j.stage}`}>{j.stage === "submitted" ? "Sub" : "✓"}</span>}
                        <b>{j.customerName}</b>
                        {j.missingFromNetsuiteAt && <span className="ns-mini" title="Not in NetSuite's In Progress list anymore">⚠️</span>}
                      </div>
                      <div className="ev-line2">
                        <span>{jobTypeLabel(j.jobType)}{j.scheduledTime ? ` · ${j.scheduledTime}` : ""}</span>
                        {j.collectCents !== null && <span title={`Collect ${money(j.collectCents)}`}>💵</span>}
                        {j.stage === "scheduled" && <DaysBadge job={j} short />}
                        {(j.address || j.city) && (
                          <a className="map-icon" href={mapsUrl(j.address, j.city)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} draggable={false} title={`Directions: ${addressLine(j.address, j.city)}`}>📍</a>
                        )}
                      </div>
                    </div>
                  </Fragment>
                ))}
                {dropAt?.day === d && dropAt.index >= dayJobs.length && dayJobs.length > 0 && <div className="drop-line" />}
              </section>
            );
          })}
        </div>
        <JobMap jobs={pipeline} onOpen={setOpenId} onPinDrop={canEdit ? placeJob : undefined} onPinHover={setDropTarget} big={mapBig} onToggleSize={toggleMap} />
        </div>
      </div>

      {openId && <JobDrawer id={openId} me={me} drivers={drivers} onClose={() => setOpenId(null)} />}
      {menu && (
        <StatusMenu
          {...menu}
          onClose={() => setMenu(null)}
          onOpen={() => { setOpenId(menu.job.id); setMenu(null); }}
          onPick={(s) => { move.mutate({ id: menu.job.id, body: { callStatus: s } }); setMenu(null); }}
        />
      )}
      {adding && <NewJobModal onClose={() => setAdding(false)} />}
      {assign && (
        <AssignModal
          job={assign.job}
          date={assign.date}
          drivers={drivers}
          onClose={() => setAssign(null)}
          onSave={(driverId, time) => {
            move.mutate({ id: assign.job.id, body: { driverId, scheduledDate: assign.date, scheduledTime: time, ...(assign.sortOrder ? { sortOrder: assign.sortOrder } : {}) } });
            assign.renumber?.();
            setAssign(null);
          }}
        />
      )}
    </div>
  );
}

function AssignModal({ job, date, drivers, onClose, onSave }: {
  job: OfficeJob; date: string; drivers: TeamMember[]; onClose: () => void; onSave: (driverId: string, time: string) => void;
}) {
  const [driverId, setDriverId] = useState(drivers[0]?.id ?? "");
  const [time, setTime] = useState(job.scheduledTime ?? "");
  return (
    <Modal title={`${job.customerName} → ${fmtDay(date)}`} onClose={onClose}>
      <div className="form">
        <label>Driver</label>
        <div className="driver-pick">
          {drivers.map((d) => (
            <button key={d.id} type="button" className={`driver-chip${driverId === d.id ? " on" : ""}`} style={{ borderColor: d.color }} onClick={() => setDriverId(d.id)}>
              <i className="dot" style={{ background: d.color }} /> {d.name}
            </button>
          ))}
          {!drivers.length && <div className="error">Add a driver on the Team page first.</div>}
        </div>
        <label>Time (optional)<input value={time} onChange={(e) => setTime(e.target.value)} placeholder="8:00 AM" /></label>
        <div className="row-end">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={!driverId} onClick={() => onSave(driverId, time)}>Schedule</button>
        </div>
      </div>
    </Modal>
  );
}

function NewJobModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  // Private moves are the most common manual entry (they aren't in NetSuite), so the form starts there.
  const [f, setF] = useState({ customerName: "", phone: "", address: "", city: "", serial: "", building: "", balance: "", jobType: "private_move" as JobType, officeNotes: "", tloNotes: "" });
  const isPrivate = f.jobType === "private_move";
  const [err, setErr] = useState<unknown>(null);
  const [dupe, setDupe] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: (allowDuplicate: boolean) => api.post<OfficeJob>("/jobs", isPrivate ? { ...f, serial: "", balance: "", allowDuplicate } : { ...f, allowDuplicate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board"] }); onClose(); },
    onError: (e) => { setErr(e); setDupe(!!(e as { body?: { duplicateOf?: string } }).body?.duplicateOf); },
  });
  return (
    <Modal title="Add a job to the pipeline" onClose={onClose} wide>
      <form className="form grid2" onSubmit={(e) => { e.preventDefault(); create.mutate(false); }}>
        <label className="checkbox span2 private-toggle">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setF({ ...f, jobType: e.target.checked ? "private_move" : "new" })} />
          <span><b>Private Move</b> <span className="muted">(not in NetSuite, no expense)</span></span>
        </label>
        <label>Customer name *<input value={f.customerName} onChange={set("customerName")} required autoFocus /></label>
        <label>Phone<input value={f.phone} onChange={set("phone")} inputMode="tel" /></label>
        <label className="span2">Address<input value={f.address} onChange={set("address")} /></label>
        <label>City<input value={f.city} onChange={set("city")} /></label>
        {!isPrivate && (
          <label>Job type
            <select value={f.jobType} onChange={set("jobType")}>{JOB_TYPES.filter((t) => t !== "private_move").map((t) => <option key={t} value={t}>{jobTypeLabel(t)}</option>)}</select>
          </label>
        )}
        {!isPrivate && <label>Serial #<input value={f.serial} onChange={set("serial")} /></label>}
        <label>Building (size / style)<input value={f.building} onChange={set("building")} placeholder="12x24 Side Lofted" /></label>
        {!isPrivate && <label>Balance owed ($, 0 = paid)<input value={f.balance} onChange={set("balance")} inputMode="decimal" /></label>}
        <label className="span2">Notes for the driver<textarea rows={2} value={f.officeNotes} onChange={set("officeNotes")} /></label>
        {(f.jobType === "repo" || f.jobType === "attempted_repo") && (
          <label className="span2">TLO addresses (one per line)<textarea rows={3} value={f.tloNotes} onChange={set("tloNotes")} placeholder={"12 Oak St, Hartselle, AL\n4 Pine Rd, Rainsville, AL"} /></label>
        )}
        <div className="span2">
          <ErrorText error={err} />
          <div className="row-end">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            {dupe && <button type="button" className="btn" onClick={() => create.mutate(true)}>Add anyway</button>}
            <button className="btn pri" disabled={create.isPending}>{create.isPending ? "Adding…" : "Add to pipeline"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}


function DaysBadge({ job, short }: { job: OfficeJob; short?: boolean }) {
  const d = daysOnUs(job.createdAt);
  const label = short ? `${d}d` : d === 0 ? "Today" : `${d} day${d === 1 ? "" : "s"}`;
  return <span className={`days${d >= 14 ? " old" : d >= 7 ? " aging" : ""}`} title={`${d} day${d === 1 ? "" : "s"} since this job was added`}>{label}</span>;
}

/** Right-click menu on a job: set the call status in one click. */
function StatusMenu({ job, x, y, onClose, onPick, onOpen }: { job: OfficeJob; x: number; y: number; onClose: () => void; onPick: (s: CallStatus) => void; onOpen: () => void }) {
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 230);
  return (
    <div className="ctx-bg" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="ctx-menu card" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()} role="menu">
        <div className="ctx-title">{job.customerName}</div>
        {(Object.keys(CALL_STATUS_LABELS) as CallStatus[]).map((s) => (
          <button key={s} role="menuitem" className={job.callStatus === s ? "on" : ""} onClick={() => onPick(s)}>
            <span className={`pill cs-${s}`}><i className="dot" />{s === "attempted" ? "Log attempted call" : CALL_STATUS_LABELS[s]}</span>
            {job.callStatus === s && s !== "attempted" && <span className="muted small">current</span>}
          </button>
        ))}
        <div className="ctx-sep" />
        <button role="menuitem" onClick={onOpen}>Open details…</button>
      </div>
    </div>
  );
}

/** Pipeline search: name (which carries the lot), address, city, phone (digits only) and serial. */
export function matchesSearch(j: OfficeJob, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [j.customerName, j.address, j.city, j.serial, j.building, j.tloNotes].join(" ").toLowerCase();
  const digits = j.phone.replace(/\D/g, "");
  return words.every((w) => {
    if (text.includes(w)) return true;
    const wd = w.replace(/\D/g, "");
    return wd.length >= 3 && (digits.includes(wd) || j.serial.replace(/\D/g, "").includes(wd));
  });
}
