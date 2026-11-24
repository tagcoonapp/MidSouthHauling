import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CALL_STATUSES, JOB_TYPES, type CallStatus, type JobType, type Me, type OfficeJob, type TeamMember } from "../../../shared/domain";
import { api } from "../api";
import { CallPill, ErrorText, PhotoGrid, StagePill } from "../components/bits";
import { callLabel, fmtDateTime, fmtDay, jobTypeLabel, money } from "../util";

export function JobDrawer({ id, me, drivers, onClose }: { id: string; me: Me; drivers: TeamMember[]; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["job", id], queryFn: () => api.get<OfficeJob>(`/jobs/${id}`) });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [callNote, setCallNote] = useState("");
  const pdfInput = useRef<HTMLInputElement>(null);

  useEffect(() => setEdit({}), [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const after = (job: OfficeJob) => {
    qc.setQueryData(["job", id], job);
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["pending"] });
  };
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch<OfficeJob>(`/jobs/${id}`, body), onSuccess: after });
  const del = useMutation({
    mutationFn: () => api.del(`/jobs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board"] }); onClose(); },
  });
  const uploadPdf = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return api.put<OfficeJob>(`/jobs/${id}/pdf`, fd); },
    onSuccess: after,
  });

  const job = q.data;
  const canEdit = me.permissions.editSchedule;
  const locked = job ? job.stage === "submitted" || job.stage === "approved" : true;
  const field = (k: keyof OfficeJob, label: string, opts: { area?: boolean; money?: boolean } = {}) => {
    if (!job) return null;
    const original = opts.money ? (job.balanceCents === null ? "" : String(job.balanceCents / 100)) : String(job[k] ?? "");
    const val = edit[k] ?? original;
    const props = {
      value: val,
      disabled: !canEdit,
      onChange: (e: { target: { value: string } }) => setEdit({ ...edit, [k]: e.target.value }),
      onBlur: () => {
        if (edit[k] === undefined || edit[k] === original) return;
        patch.mutate({ [opts.money ? "balance" : k]: edit[k] }, { onSuccess: () => setEdit((x) => { const { [k]: _, ...rest } = x; return rest; }) });
      },
    };
    return <label className={opts.area ? "span2" : ""}>{label}{opts.area ? <textarea rows={2} {...props} /> : <input {...props} />}</label>;
  };

  return (
    <div className="drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label="Job details">
        {!job ? (
          <div className="muted pad">{q.isError ? "Couldn't load this job." : "Loading…"}</div>
        ) : (
          <>
            <div className="row drawer-head">
              <div>
                <h2>{job.customerName}</h2>
                <div className="row-wrap" style={{ marginTop: 4 }}>
                  <StagePill stage={job.stage} />
                  {job.scheduledDate && <span className="muted small">{fmtDay(job.scheduledDate)}{job.scheduledTime ? ` · ${job.scheduledTime}` : ""}</span>}
                  {job.driverName && <span className="small"><i className="dot" style={{ background: job.driverColor ?? "#999" }} /> {job.driverName}</span>}
                </div>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <ErrorText error={patch.error || del.error || uploadPdf.error} />

            {canEdit && !locked && (
              <section className="drawer-sec">
                <h3>Calls</h3>
                <div className="row-wrap">
                  {CALL_STATUSES.map((s) => (
                    <button
                      key={s}
                      className={`btn small cs-btn cs-${s}${job.callStatus === s ? " on" : ""}`}
                      onClick={() => { patch.mutate({ callStatus: s as CallStatus, callNote }); setCallNote(""); }}
                    >
                      {s === "attempted" ? "Log attempt" : callLabel(s)}
                    </button>
                  ))}
                </div>
                <input className="mt" placeholder="Optional note for the call log (e.g. left voicemail)" value={callNote} onChange={(e) => setCallNote(e.target.value)} />
                <div className="muted small mt">Current: <CallPill status={job.callStatus} attempts={job.callAttempts} /> · {job.callAttempts} attempt{job.callAttempts === 1 ? "" : "s"}</div>
              </section>
            )}

            {canEdit && !locked && (
              <section className="drawer-sec">
                <h3>Schedule</h3>
                <div className="form grid2">
                  <label>Day<input type="date" value={job.scheduledDate ?? ""} onChange={(e) => e.target.value && patch.mutate({ scheduledDate: e.target.value, driverId: job.driverId ?? drivers[0]?.id })} /></label>
                  <label>Driver
                    <select value={job.driverId ?? ""} onChange={(e) => patch.mutate({ driverId: e.target.value || null })}>
                      <option value="">— none —</option>
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                  {field("scheduledTime", "Time")}
                  <div style={{ alignSelf: "end" }}>
                    {job.stage === "scheduled" && <button className="btn small" onClick={() => patch.mutate({ scheduledDate: null })}>Move back to pipeline</button>}
                  </div>
                </div>
              </section>
            )}

            <section className="drawer-sec">
              <h3>Customer & building</h3>
              <div className="form grid2">
                {field("customerName", "Customer name")}
                {field("phone", "Phone")}
                {field("address", "Address")}
                {field("city", "City")}
                {field("serial", "Serial #")}
                {field("building", "Building")}
                {me.permissions.viewFinancial && field("balanceCents", `Balance owed (${money(job.balanceCents)})`, { money: true })}
                <label>Job type
                  <select value={job.jobType} disabled={!canEdit} onChange={(e) => patch.mutate({ jobType: e.target.value as JobType })}>
                    {JOB_TYPES.map((t) => <option key={t} value={t}>{jobTypeLabel(t)}</option>)}
                  </select>
                </label>
                {field("officeNotes", "Notes for the driver", { area: true })}
              </div>
              <div className="row-wrap mt">
                {job.hasPdf && <a className="btn small" href={`/api/jobs/${job.id}/pdf`} target="_blank" rel="noreferrer">📄 View customer PDF</a>}
                {canEdit && <button className="btn small" onClick={() => pdfInput.current?.click()} disabled={uploadPdf.isPending}>{uploadPdf.isPending ? "Uploading…" : job.hasPdf ? "Replace PDF" : "Upload customer PDF"}</button>}
                <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf.mutate(f); e.target.value = ""; }} />
              </div>
            </section>

            {(job.stage !== "pipeline" || job.photos.length > 0) && (
              <section className="drawer-sec">
                <div className="row">
                  <h3 style={{ margin: 0 }}>Driver photos & notes</h3>
                  {me.role === "scheduler" && job.stage === "scheduled" && (
                    <Link className="btn small pri" to={`/job/${job.id}`}>Fill in driver steps</Link>
                  )}
                </div>
                <div style={{ height: 10 }} />
                <PhotoGrid
                  photos={job.photos}
                  editable={me.role === "scheduler" && (job.stage === "scheduled" || job.stage === "submitted")}
                  onUpload={async (f) => { const fd = new FormData(); fd.append("file", f); await api.post(`/jobs/${id}/photos`, fd); await q.refetch(); }}
                  onDelete={async (pid) => { await api.del(`/photos/${pid}`); await q.refetch(); }}
                />
                {job.driverNotes ? <div className="note-box mt"><b>Driver notes:</b> {job.driverNotes}</div> : <div className="muted small mt">No driver notes yet.</div>}
              </section>
            )}

            <section className="drawer-sec">
              <h3>History</h3>
              <ul className="events">
                {(job.events ?? []).map((e) => (
                  <li key={e.id}><span className="muted small">{fmtDateTime(e.createdAt)} · {e.userName}</span><div>{e.detail}</div></li>
                ))}
              </ul>
            </section>

            {canEdit && !locked && (
              <div className="pad-y">
                <button className="btn danger small" onClick={() => confirm("Delete this job? This can't be undone.") && del.mutate()}>Delete job</button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
