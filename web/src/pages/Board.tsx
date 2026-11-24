import { useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CALL_STATUSES, JOB_TYPES, type JobType, type Me, type OfficeJob, type TeamMember } from "../../../shared/domain";
import { api } from "../api";
import { CallPill, ErrorText, JobTypePill, Modal } from "../components/bits";
import { JobDrawer } from "./JobDrawer";
import { copyImportInstructions } from "./Import";
import { useNavigate } from "react-router-dom";
import { addDays, fmtDay, jobTypeLabel, mapsUrl, money, weekStart } from "../util";

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
  const [assign, setAssign] = useState<{ job: OfficeJob; date: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
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
  const { pipeline, scheduled, today } = board.data;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const all = [...pipeline, ...scheduled];

  function onDragStart(e: DragEvent, job: OfficeJob) {
    e.dataTransfer.setData("text/job-id", job.id);
    e.dataTransfer.effectAllowed = "move";
  }
  function dropOn(e: DragEvent, target: string) {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData("text/job-id");
    const job = all.find((j) => j.id === id);
    if (!job || !canEdit) return;
    setErr(null);
    if (target === "pipeline") {
      if (job.stage === "scheduled") move.mutate({ id, body: { scheduledDate: null } });
      return;
    }
    if (job.stage === "submitted" || job.stage === "approved") { setErr(new Error("Finished jobs can't be moved.")); return; }
    if (job.driverId) move.mutate({ id, body: { scheduledDate: target } });
    else setAssign({ job, date: target });
  }
  const dropProps = (target: string) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => { e.preventDefault(); setDropTarget(target); },
          onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
          onDrop: (e: DragEvent) => dropOn(e, target),
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
      <ErrorText error={err} />

      <div className="board">
        <section className={`pipe${dropTarget === "pipeline" ? " drop" : ""}`} {...dropProps("pipeline")}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2>Pipeline <span className="muted">({pipeline.length})</span></h2>
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
          {pipeline.length === 0 && <div className="muted small">No jobs waiting. New jobs land here.</div>}
          {pipeline.map((j) => (
            <div key={j.id} className="card pc" draggable={canEdit} onDragStart={(e) => onDragStart(e, j)} onClick={() => setOpenId(j.id)}>
              <div className="row"><b>{j.customerName}</b><JobTypePill type={j.jobType} /></div>
              <div className="muted">{[j.city, j.building].filter(Boolean).join(" · ")}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <span className="muted small">{j.serial ? `SN ${j.serial}` : ""}</span>
                {j.balanceCents !== null && <b className={j.balanceCents ? "owes" : "paid"}>{j.balanceCents ? `Owes ${money(j.balanceCents)}` : "Paid"}</b>}
              </div>
              <div style={{ marginTop: 6 }}><CallPill status={j.callStatus} attempts={j.callAttempts} /></div>
            </div>
          ))}
        </section>

        <div className="cal">
          {days.map((d) => {
            const dayJobs = scheduled.filter((j) => j.scheduledDate === d);
            return (
              <section key={d} className={`day${d === today ? " today" : ""}${dropTarget === d ? " drop" : ""}`} {...dropProps(d)}>
                <h3>{fmtDay(d, { weekday: "short", day: "numeric" }).toUpperCase()} <span>{dayJobs.length}</span></h3>
                {dayJobs.map((j) => (
                  <div
                    key={j.id}
                    className={`ev${j.stage !== "scheduled" ? " done" : ""}`}
                    style={{ borderLeftColor: j.driverColor ?? "#98a2b3" }}
                    draggable={canEdit && j.stage === "scheduled"}
                    onDragStart={(e) => onDragStart(e, j)}
                    onClick={() => setOpenId(j.id)}
                    title={j.driverName ?? ""}
                  >
                    <b>{j.customerName}</b>
                    {jobTypeLabel(j.jobType)}{j.scheduledTime ? ` · ${j.scheduledTime}` : ""}
                    {(j.address || j.city) && (
                      <a className="map-link" href={mapsUrl(j.address, j.city)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} draggable={false}>
                        📍 {[j.address, j.city].filter(Boolean).join(", ")}
                      </a>
                    )}
                    <div className="muted small">{j.driverName}</div>
                    {j.collectCents !== null && <div className="collect-mini">💵 Collect {money(j.collectCents)}</div>}
                    <div style={{ marginTop: 4 }}>
                      {j.stage === "scheduled" ? <CallPill status={j.callStatus} attempts={j.callAttempts} /> : <span className={`pill st-${j.stage}`}>{j.stage === "submitted" ? "Submitted" : "Approved"}</span>}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {openId && <JobDrawer id={openId} me={me} drivers={drivers} onClose={() => setOpenId(null)} />}
      {adding && <NewJobModal onClose={() => setAdding(false)} />}
      {assign && (
        <AssignModal
          job={assign.job}
          date={assign.date}
          drivers={drivers}
          onClose={() => setAssign(null)}
          onSave={(driverId, time) => {
            move.mutate({ id: assign.job.id, body: { driverId, scheduledDate: assign.date, scheduledTime: time } });
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
  const [f, setF] = useState({ customerName: "", phone: "", address: "", city: "", serial: "", building: "", balance: "", jobType: "private_move" as JobType, officeNotes: "" });
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

