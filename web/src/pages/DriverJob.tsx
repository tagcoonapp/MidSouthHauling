import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { DRIVER_QUESTIONS, JOB_TYPES, KEPT_PAID_TO, KEPT_PAID_TO_LABELS, PAYMENT_LABELS, PAYMENT_METHODS, missingDriverAnswers, type DriverJob, type JobType, type KeptPaidTo, type PaymentMethod } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText, JobTypePill, PhotoGrid, StagePill } from "../components/bits";
import { fmtDay, jobTypeLabel, mapsUrl, addressLine } from "../util";

type WorkBody = { jobType?: JobType; driverNotes?: string; reportedCustomerName?: string; miles?: number | null; lotTakenTo?: string; collected?: string | null; collectedMethod?: PaymentMethod | null; collectedRef?: string; keptPaidInFull?: boolean; keptPaidTo?: KeptPaidTo | null };
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Text fields the driver fills in. Saved when they leave the box (and before submit). */
interface Answers { notes: string; name: string; miles: string; lot: string; collected: string; ref: string }
const fromJob = (j: DriverJob): Answers => ({ notes: j.driverNotes, name: j.reportedCustomerName, miles: j.miles === null ? "" : String(j.miles), lot: j.lotTakenTo, collected: j.collectedCents === null ? "" : (j.collectedCents / 100).toFixed(2), ref: j.collectedRef });

function changes(a: Answers, saved: Answers): WorkBody {
  const body: WorkBody = {};
  if (a.notes !== saved.notes) body.driverNotes = a.notes;
  if (a.name !== saved.name) body.reportedCustomerName = a.name;
  if (a.miles !== saved.miles) body.miles = a.miles.trim() === "" ? null : Number(a.miles);
  if (a.lot !== saved.lot) body.lotTakenTo = a.lot;
  if (a.collected !== saved.collected) body.collected = a.collected.trim() === "" ? null : a.collected;
  if (a.ref !== saved.ref) body.collectedRef = a.ref;
  return body;
}

export function DriverJobPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["job", id], queryFn: () => api.get<DriverJob>(`/jobs/${id}`) });
  const lots = useQuery({ queryKey: ["lots"], queryFn: () => api.get<string[]>("/lots"), staleTime: 300_000 });
  const [a, setA] = useState<Answers>({ notes: "", name: "", miles: "", lot: "", collected: "", ref: "" });
  // Step 1 shows the job's info; "Send expense" opens step 2 (questions, photos, notes, submit).
  const [step, setStep] = useState<"info" | "expense">("info");
  const [saved, setSaved] = useState<Answers>(a);

  useEffect(() => {
    if (q.data) { const v = fromJob(q.data); setA(v); setSaved(v); }
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (job: DriverJob) => {
    qc.setQueryData(["job", id], job);
    qc.invalidateQueries({ queryKey: ["my-schedule"] });
    qc.invalidateQueries({ queryKey: ["my-log"] });
  };

  const work = useMutation({
    mutationFn: (body: WorkBody) => api.patch<DriverJob>(`/jobs/${id}/work`, body),
    // Show taps (checkbox, buttons) right away; the server's answer replaces this.
    onMutate: (body) => {
      const instant: Partial<DriverJob> = {};
      if (body.keptPaidInFull !== undefined) { instant.keptPaidInFull = body.keptPaidInFull; if (!body.keptPaidInFull) instant.keptPaidTo = null; }
      if (body.keptPaidTo !== undefined) instant.keptPaidTo = body.keptPaidTo;
      if (Object.keys(instant).length) qc.setQueryData(["job", id], (old: DriverJob | undefined) => (old ? { ...old, ...instant } : old));
    },
    onSuccess: (job) => { refresh(job); setSaved(fromJob(job)); },
  });
  const save = () => { const body = changes(a, saved); if (Object.keys(body).length) work.mutate(body); };
  const submit = useMutation({
    mutationFn: async () => {
      const body = changes(a, saved);
      if (Object.keys(body).length) await api.patch(`/jobs/${id}/work`, body);
      return api.post<DriverJob>(`/jobs/${id}/submit`);
    },
    onSuccess: (job) => { refresh(job); setSaved(fromJob(job)); },
  });

  if (q.isError) return <div className="pad">This job isn't available. <Link to="/">Back</Link></div>;
  if (!q.data) return <div className="pad muted">Loading…</div>;
  const job = q.data;
  const editable = job.stage === "scheduled" || job.stage === "submitted";
  const tel = job.phone.replace(/[^\d+]/g, "");
  const ask = DRIVER_QUESTIONS[job.jobType];
  const milesNum = a.miles.trim() === "" ? null : Number(a.miles);
  const collectedNum = a.collected.trim() === "" ? null : Math.round(Number(a.collected.replace(/[$,]/g, "")) * 100);
  const missing = missingDriverAnswers({
    jobType: job.jobType, reportedCustomerName: a.name, miles: Number.isFinite(milesNum) ? milesNum : null, lotTakenTo: a.lot,
    collectCents: job.collectCents, collectedCents: collectedNum !== null && Number.isFinite(collectedNum) ? collectedNum : null, collectedMethod: job.collectedMethod,
    keptPaidInFull: job.keptPaidInFull, keptPaidTo: job.keptPaidTo,
  });
  const unsaved = Object.keys(changes(a, saved)).length > 0;

  return (
    <div className="phone-app">
      <header className="ptop">
        {step === "info" ? <Link to="/" className="muted-light small">‹ Back to my jobs</Link> : <button className="link-light back-btn" onClick={() => { setStep("info"); window.scrollTo(0, 0); }}>‹ Back to job info</button>}
        {"balanceCents" in job && <div className="office-note">You're filling in the driver's steps for this job.</div>}
        <h1 style={{ marginTop: 6 }}>{job.customerName}</h1>
        <div className="row-wrap" style={{ marginTop: 6 }}>
          <JobTypePill type={job.jobType} />
          <StagePill stage={job.stage} />
          {job.scheduledDate && <span className="muted-light small">{fmtDay(job.scheduledDate)}{job.scheduledTime ? ` · ${job.scheduledTime}` : ""}</span>}
        </div>
      </header>

      {step === "info" && (
        <>
          <div className="info-list">
            <div className="info-row">
              <div className="info-label">Serial number</div>
              <div className="info-value mono">{job.serial || <span className="muted">Not listed</span>}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Phone number</div>
              <div className="info-value">{tel ? <a href={`tel:${tel}`}>📞 {job.phone}</a> : <span className="muted">Not listed</span>}</div>
            </div>
            <div className={`info-row${job.collectCents ? " due" : ""}`}>
              <div className="info-label">Balance due</div>
              <div className="info-value">{usd(job.collectCents ?? 0)}{job.collectCents ? <span className="info-hint">Collect this from the customer</span> : null}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Address</div>
              <div className="info-value">{job.address || job.city ? <a href={mapsUrl(job.address, job.city)} target="_blank" rel="noreferrer">📍 {addressLine(job.address, job.city)}</a> : <span className="muted">Not listed</span>}</div>
            </div>
            {job.building && (
              <div className="info-row">
                <div className="info-label">Building</div>
                <div className="info-value">{job.building}</div>
              </div>
            )}
          </div>

          {(job.officeNotes || job.tloNotes.trim() || job.hasPdf) && (
            <div className="card pad" style={{ margin: "0 14px 14px" }}>
              {job.officeNotes && <div className="note-box" style={{ marginTop: 0 }}><b>From the office:</b> {job.officeNotes}</div>}
              {job.tloNotes.trim() && (
                <div className="note-box tlo">
                  <b>Other addresses (TLO):</b>
                  {job.tloNotes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => (
                    <a key={i} className="map-link big" href={mapsUrl(l, "")} target="_blank" rel="noreferrer">📍 {l}</a>
                  ))}
                </div>
              )}
              {job.hasPdf && <a className="btn" style={{ marginTop: 10 }} href={`/api/jobs/${job.id}/pdf`} target="_blank" rel="noreferrer">📄 Customer PDF</a>}
            </div>
          )}

          <div className="pad-x" style={{ paddingBottom: 28 }}>
            <button className="btn pri big" style={{ width: "100%" }} onClick={() => { setStep("expense"); window.scrollTo(0, 0); }}>
              {job.stage === "scheduled" ? "Send expense ›" : job.stage === "submitted" ? "View or fix expense ›" : "View expense ›"}
            </button>
            {job.stage === "submitted" && <div className="ok-box mt">✓ Submitted. Waiting for the office to approve.</div>}
            {job.stage === "approved" && <div className="ok-box mt">✓ Approved by the office.</div>}
          </div>
        </>
      )}

      {step === "expense" && (<>
      {job.collectCents !== null && (
        <div className="collect-banner">💵 Collect <b>{usd(job.collectCents)}</b> from the customer</div>
      )}

      <div className="field">
        <label htmlFor="jt">What was this job?</label>
        <select id="jt" value={job.jobType} disabled={!editable || work.isPending} onChange={(e) => work.mutate({ jobType: e.target.value as JobType })}>
          {JOB_TYPES.map((t) => <option key={t} value={t}>{jobTypeLabel(t)}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="cn">Customer name <span className="req">(as written on the happy sheet)</span></label>
        <input id="cn" value={a.name} disabled={!editable} autoCapitalize="words" placeholder="First and last name" onChange={(e) => setA({ ...a, name: e.target.value })} onBlur={save} />
      </div>

      {ask.miles && (
        <div className="field">
          <label htmlFor="mi">Miles</label>
          <input id="mi" value={a.miles} disabled={!editable} inputMode="decimal" placeholder="e.g. 42" onChange={(e) => setA({ ...a, miles: e.target.value.replace(/[^\d.]/g, "") })} onBlur={save} />
        </div>
      )}

      {ask.lot && (
        <div className="field">
          <label htmlFor="lot">Lot taken to</label>
          <input id="lot" list="lot-list" value={a.lot} disabled={!editable} placeholder="Which lot did the building go to?" onChange={(e) => setA({ ...a, lot: e.target.value })} onBlur={save} />
          <datalist id="lot-list">{(lots.data ?? []).map((l) => <option key={l} value={l} />)}</datalist>
        </div>
      )}

      {ask.keptPaid && (
        <div className="field">
          <label className="checkbox">
            <input type="checkbox" disabled={!editable} checked={job.keptPaidInFull === true} onChange={(e) => work.mutate({ keptPaidInFull: e.target.checked })} />
            <span>Customer paid to keep the building</span>
          </label>
          {job.keptPaidInFull === true && (
            <>
              <label style={{ marginTop: 12 }}>How did they pay?</label>
              <div className="seg">
                {KEPT_PAID_TO.map((k) => (
                  <button key={k} type="button" disabled={!editable} className={job.keptPaidTo === k ? "on" : ""} onClick={() => work.mutate({ keptPaidTo: k })}>{KEPT_PAID_TO_LABELS[k]}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {ask.amountGiven && (
        <div className="field">
          <label htmlFor="given">How much was given ($)</label>
          <input id="given" value={a.collected} disabled={!editable} inputMode="decimal" placeholder="e.g. 300" onChange={(e) => setA({ ...a, collected: e.target.value.replace(/[^\d.]/g, "") })} onBlur={save} />
        </div>
      )}

      {job.collectCents !== null && (
        <div className="field">
          <label htmlFor="col">Amount collected ($)</label>
          <input id="col" value={a.collected} disabled={!editable} inputMode="decimal" placeholder={(job.collectCents / 100).toFixed(2)} onChange={(e) => setA({ ...a, collected: e.target.value.replace(/[^\d.]/g, "") })} onBlur={save} />
          <label style={{ marginTop: 12 }}>How was it paid?</label>
          <div className="seg">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" disabled={!editable} className={job.collectedMethod === m ? "on" : ""} onClick={() => work.mutate({ collectedMethod: m })}>{PAYMENT_LABELS[m]}</button>
            ))}
          </div>
          {(job.collectedMethod === "card" || job.collectedMethod === "check") && (
            <input style={{ marginTop: 10 }} value={a.ref} disabled={!editable} placeholder={job.collectedMethod === "card" ? "Trans ID (optional)" : "Check number (optional)"} onChange={(e) => setA({ ...a, ref: e.target.value })} onBlur={save} />
          )}
        </div>
      )}

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
        <textarea id="notes" rows={4} value={a.notes} disabled={!editable} placeholder="Anything the office should know: damage, gate code, customer not home…" onChange={(e) => setA({ ...a, notes: e.target.value })} onBlur={save} />
      </div>

      <div className="pad-x" style={{ paddingBottom: 28 }}>
        <ErrorText error={work.error || submit.error} />
        {editable && unsaved && <div className="muted small" style={{ marginBottom: 8 }}>Not saved yet. Tap outside the box or submit to save.</div>}
        {job.stage === "scheduled" && (
          <>
            {missing.length > 0 && <div className="muted small" style={{ marginBottom: 8 }}>Still need: {missing.join(", ")}.</div>}
            <button
              className="btn pri big"
              style={{ width: "100%" }}
              disabled={submit.isPending || missing.length > 0}
              onClick={() => {
                if (!job.photos.length && !confirm("No photos yet. Submit anyway?")) return;
                submit.mutate();
              }}
            >
              {submit.isPending ? "Submitting…" : "Submit job"}
            </button>
          </>
        )}
        {job.stage === "submitted" && (
          <>
            {unsaved && <button className="btn big" style={{ width: "100%", marginBottom: 10 }} onClick={save}>Save changes</button>}
            <div className="ok-box">✓ Submitted. You can still fix photos or answers until the office approves it.</div>
          </>
        )}
        {job.stage === "approved" && <div className="ok-box">✓ Approved by the office.</div>}
      </div>
      </>)}
    </div>
  );
}
