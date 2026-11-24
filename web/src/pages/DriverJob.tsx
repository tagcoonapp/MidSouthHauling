import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { JOB_TYPES, type DriverJob, type JobType } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText, PhotoGrid, StagePill } from "../components/bits";
import { fmtDay, jobTypeLabel, mapsUrl } from "../util";

export function DriverJobPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["job", id], queryFn: () => api.get<DriverJob>(`/jobs/${id}`) });
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");

  useEffect(() => {
    if (q.data) { setNotes(q.data.driverNotes); setSavedNotes(q.data.driverNotes); }
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (job: DriverJob) => {
    qc.setQueryData(["job", id], job);
    qc.invalidateQueries({ queryKey: ["my-schedule"] });
    qc.invalidateQueries({ queryKey: ["my-log"] });
  };

  const work = useMutation({
    mutationFn: (body: { jobType?: JobType; driverNotes?: string }) => api.patch<DriverJob>(`/jobs/${id}/work`, body),
    onSuccess: (job) => { refresh(job); setSavedNotes(job.driverNotes); },
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (notes !== savedNotes) await api.patch(`/jobs/${id}/work`, { driverNotes: notes });
      return api.post<DriverJob>(`/jobs/${id}/submit`);
    },
    onSuccess: refresh,
  });

  if (q.isError) return <div className="pad">This job isn't available. <Link to="/">Back</Link></div>;
  if (!q.data) return <div className="pad muted">Loading…</div>;
  const job = q.data;
  const editable = job.stage === "scheduled" || job.stage === "submitted";
  const tel = job.phone.replace(/[^\d+]/g, "");

  return (
    <div className="phone-app">
      <header className="ptop">
        <Link to="/" className="muted-light small">‹ Back</Link>
        <h1 style={{ marginTop: 6 }}>{job.customerName}</h1>
        <div className="muted-light small" style={{ marginTop: 2 }}>{[job.address, job.city].filter(Boolean).join(", ")}</div>
        <div className="row-wrap" style={{ marginTop: 12 }}>
          {tel && <a className="btn ghost-light" href={`tel:${tel}`}>📞 Call</a>}
          {(job.address || job.city) && <a className="btn ghost-light" href={mapsUrl(job.address, job.city)} target="_blank" rel="noreferrer">🧭 Directions</a>}
          {job.hasPdf && <a className="btn ghost-light" href={`/api/jobs/${job.id}/pdf`} target="_blank" rel="noreferrer">📄 Customer PDF</a>}
        </div>
      </header>

      <div className="card pad" style={{ margin: 14 }}>
        <dl className="facts">
          {job.building && <><dt>Building</dt><dd>{job.building}</dd></>}
          {job.serial && <><dt>Serial #</dt><dd>{job.serial}</dd></>}
          {job.scheduledDate && <><dt>Scheduled</dt><dd>{fmtDay(job.scheduledDate)}{job.scheduledTime ? ` · ${job.scheduledTime}` : ""}</dd></>}
          {job.phone && <><dt>Phone</dt><dd>{job.phone}</dd></>}
          <dt>Status</dt><dd><StagePill stage={job.stage} /></dd>
        </dl>
        {job.officeNotes && <div className="note-box"><b>From the office:</b> {job.officeNotes}</div>}
      </div>

      <div className="field">
        <label htmlFor="jt">Job type</label>
        <select
          id="jt"
          value={job.jobType}
          disabled={!editable || work.isPending}
          onChange={(e) => work.mutate({ jobType: e.target.value as JobType })}
        >
          {JOB_TYPES.map((t) => <option key={t} value={t}>{jobTypeLabel(t)}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Photos ({job.photos.length} of 4)</label>
        <PhotoGrid
          photos={job.photos}
          editable={editable}
          onUpload={async (f) => { const fd = new FormData(); fd.append("file", f); refresh(await api.post<DriverJob>(`/jobs/${id}/photos`, fd)); }}
          onDelete={async (pid) => { await api.del(`/photos/${pid}`); await q.refetch(); }}
        />
        {editable && <p className="muted small" style={{ marginTop: 6 }}>Happy sheet, serial plate, and the building.</p>}
      </div>

      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          rows={4}
          value={notes}
          disabled={!editable}
          placeholder="Anything the office should know: damage, gate code, customer not home…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== savedNotes && work.mutate({ driverNotes: notes })}
        />
        {notes !== savedNotes && editable && <div className="muted small">Not saved yet. Tap outside the box to save.</div>}
      </div>

      <div className="pad-x" style={{ paddingBottom: 28 }}>
        <ErrorText error={work.error || submit.error} />
        {job.stage === "scheduled" && (
          <button
            className="btn pri big"
            style={{ width: "100%" }}
            disabled={submit.isPending}
            onClick={() => {
              if (!job.photos.length && !confirm("No photos yet. Submit anyway?")) return;
              submit.mutate();
            }}
          >
            {submit.isPending ? "Submitting…" : "Submit job"}
          </button>
        )}
        {job.stage === "submitted" && <div className="ok-box">✓ Submitted. You can still fix photos or notes until the office approves it.</div>}
        {job.stage === "approved" && <div className="ok-box">✓ Approved by the office.</div>}
      </div>
    </div>
  );
}
