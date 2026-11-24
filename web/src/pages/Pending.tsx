import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfficeJob } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText, JobTypePill, PhotoGrid } from "../components/bits";
import { fmtDateTime, fmtDay, money } from "../util";

/** Scheduler only: jobs drivers have submitted, waiting for review. Pricing and NetSuite drafts arrive in a later part. */
export function Pending() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pending"], queryFn: () => api.get<OfficeJob[]>("/pending") });
  const [reason, setReason] = useState<Record<string, string>>({});
  const done = () => { qc.invalidateQueries({ queryKey: ["pending"] }); qc.invalidateQueries({ queryKey: ["board"] }); qc.invalidateQueries({ queryKey: ["completed"] }); };
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/jobs/${id}/approve`), onSuccess: done });
  const sendBack = useMutation({ mutationFn: (id: string) => api.post(`/jobs/${id}/send-back`, { reason: reason[id] ?? "" }), onSuccess: done });

  if (!q.data) return <div className="muted">Loading…</div>;
  return (
    <div>
      <div className="top">
        <div>
          <h1>Pending <span className="muted">({q.data.length})</span></h1>
          <div className="muted">Jobs drivers submitted. Only you can see this page.</div>
        </div>
      </div>
      <ErrorText error={approve.error || sendBack.error} />
      {q.data.length === 0 && <div className="card empty-state">Nothing waiting. Submitted jobs show up here.</div>}
      <div className="pending-list">
        {q.data.map((j) => (
          <article key={j.id} className="card pad pending-card">
            <div className="row">
              <div>
                <h2>{j.customerName} · <JobTypePill type={j.jobType} /></h2>
                <div className="muted small">
                  <i className="dot" style={{ background: j.driverColor ?? "#999" }} /> {j.driverName} · submitted {fmtDateTime(j.submittedAt!)}
                  {j.scheduledDate ? ` · scheduled ${fmtDay(j.scheduledDate)}` : ""}
                </div>
              </div>
              <div className="row-wrap">
                <input placeholder="Reason (if sending back)" value={reason[j.id] ?? ""} onChange={(e) => setReason({ ...reason, [j.id]: e.target.value })} />
                <button className="btn" onClick={() => sendBack.mutate(j.id)}>Send back</button>
                <button className="btn grn" onClick={() => approve.mutate(j.id)}>✓ Approve</button>
              </div>
            </div>
            <div className="pending-body">
              <PhotoGrid photos={j.photos} editable={false} />
              <dl className="facts">
                <dt>Address</dt><dd>{[j.address, j.city].filter(Boolean).join(", ") || "—"}</dd>
                <dt>Serial #</dt><dd>{j.serial || "—"}</dd>
                <dt>Building</dt><dd>{j.building || "—"}</dd>
                <dt>Balance</dt><dd>{money(j.balanceCents)}</dd>
                <dt>Driver notes</dt><dd>{j.driverNotes || "—"}</dd>
              </dl>
            </div>
          </article>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>Coming next: the AI checks the happy sheet and serial plate, prices the job from your price sheets, and lays out the expense report for you.</p>
    </div>
  );
}
