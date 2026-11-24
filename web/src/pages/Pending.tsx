import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfficeJob } from "../../../shared/domain";
import { sizeLabel } from "../../../shared/pricing";
import { api, ApiError } from "../api";
import { ErrorText, JobTypePill, PhotoGrid } from "../components/bits";
import { fmtDateTime, fmtDay, money } from "../util";

/** Scheduler only: submitted jobs with the drafted expense, checks, and Approve / Send back. */
export function Pending() {
  const q = useQuery({ queryKey: ["pending"], queryFn: () => api.get<OfficeJob[]>("/pending") });
  if (!q.data) return <div className="muted">Loading…</div>;
  const total = q.data.reduce((t, j) => t + (j.draft?.lines.reduce((s, l) => s + l.amountCents, 0) ?? 0), 0);
  return (
    <div>
      <div className="top">
        <div>
          <h1>Pending <span className="muted">({q.data.length})</span></h1>
          <div className="muted">Submitted jobs with their drafted expense. Only you can see this page.</div>
        </div>
        {q.data.length > 0 && <div className="card pad"><div className="muted small">Total if all approved</div><b style={{ fontSize: 20 }}>{money(total) === "Paid" ? "$0.00" : money(total)}</b></div>}
      </div>
      {q.data.length === 0 && <div className="card empty-state">Nothing waiting. Submitted jobs show up here.</div>}
      <div className="pending-list">
        {q.data.map((j) => <PendingCard key={j.id} job={j} />)}
      </div>
    </div>
  );
}

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyrow">
      <div className="k">{label}</div>
      <div className="v" style={big ? { fontSize: 17 } : undefined}>{value}</div>
      <button
        className="c"
        onClick={async () => { await navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function PendingCard({ job: j }: { job: OfficeJob }) {
  const qc = useQueryClient();
  const d = j.draft!;
  const [miles, setMiles] = useState(j.miles === null ? "" : String(j.miles));
  const [lot, setLot] = useState(j.lotTakenTo);
  const [override, setOverride] = useState(j.amountOverrideCents === null ? "" : (j.amountOverrideCents / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [moody, setMoody] = useState(j.moody);
  const [confirmProblems, setConfirmProblems] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pending"] });
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["completed"] });
  };
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/jobs/${j.id}`, body), onSuccess: refresh });
  const approve = useMutation({
    mutationFn: (force: boolean) => api.post(`/jobs/${j.id}/approve`, { force }),
    onSuccess: refresh,
    onError: (e) => { if (e instanceof ApiError && e.status === 409) setConfirmProblems(true); },
  });
  const sendBack = useMutation({ mutationFn: () => api.post(`/jobs/${j.id}/send-back`, { reason }), onSuccess: refresh });
  const total = d.lines.reduce((t, l) => t + l.amountCents, 0);
  const date = j.scheduledDate ? fmtDay(j.scheduledDate, { month: "numeric", day: "numeric", year: "numeric" }) : "";
  const showMiles = j.jobType === "shop_build" || j.jobType === "repo" || j.jobType === "new" || j.jobType === "used";

  return (
    <article className="card pad pending-card">
      <div className="row">
        <div>
          <h2>{j.customerName} · <JobTypePill type={j.jobType} /></h2>
          <div className="muted small">
            <i className="dot" style={{ background: j.driverColor ?? "#999" }} /> {j.driverName} · submitted {fmtDateTime(j.submittedAt!)}
            {j.scheduledDate ? ` · job date ${fmtDay(j.scheduledDate)}` : ""}
          </div>
        </div>
      </div>

      <div className="pending-body">
        <div>
          <PhotoGrid photos={j.photos} editable={false} />
          {j.driverNotes && <div className="note-box mt"><b>Driver notes:</b> {j.driverNotes}</div>}

          <h3 className="sec-head">Checks</h3>
          {j.reportedCustomerName && (
            <div className={`check ${d.nameMatches ? "ok" : "warn"}`}>
              {d.nameMatches ? "✅" : "⚠️"} <div><b>Customer name {d.nameMatches ? "matches" : "doesn't match"}.</b> Driver wrote “{j.reportedCustomerName}”; job is “{j.customerName}”.</div>
            </div>
          )}
          {d.serialInfo && (
            <div className="check ok">✅ <div><b>Serial {j.serial}</b> = {sizeLabel(d.serialInfo)}{d.listPriceCents !== null ? `, list price ${money(d.listPriceCents)}` : ""}. Compare with the serial plate photo.</div></div>
          )}
          {d.problems.filter((p) => !p.startsWith("Driver wrote")).map((p) => (
            <div key={p} className="check warn">⚠️ <div>{p}</div></div>
          ))}
        </div>

        <div>
          <h3 className="sec-head" style={{ marginTop: 0 }}>Expense details</h3>
          <div className="form grid2" style={{ marginTop: 0 }}>
            {showMiles && (
              <label>Miles
                <input value={miles} inputMode="decimal" onChange={(e) => setMiles(e.target.value)} onBlur={() => miles !== (j.miles === null ? "" : String(j.miles)) && patch.mutate({ miles: miles === "" ? null : Number(miles) })} />
              </label>
            )}
            {j.jobType === "repo" && (
              <label>Lot taken to
                <input value={lot} onChange={(e) => setLot(e.target.value)} onBlur={() => lot !== j.lotTakenTo && patch.mutate({ lotTakenTo: lot })} />
              </label>
            )}
            {j.jobType === "new" && (
              <label className="checkbox span2">
                <input type="checkbox" checked={moody} onChange={(e) => { setMoody(e.target.checked); patch.mutate({ moody: e.target.checked }, { onError: () => setMoody(j.moody) }); }} />
                <span>Happy sheet says <b>Moody</b> (10% instead of 5%)</span>
              </label>
            )}
            <label>Custom amount ($)
              <input value={override} inputMode="decimal" placeholder="Leave blank to use the calculation"
                onChange={(e) => setOverride(e.target.value)}
                onBlur={() => override !== (j.amountOverrideCents === null ? "" : (j.amountOverrideCents / 100).toFixed(2)) && patch.mutate({ amountOverride: override === "" ? null : override })} />
            </label>
          </div>

          <h3 className="sec-head">Expense report draft {d.lines.length > 1 && <span className="muted">({d.lines.length} separate expenses)</span>}</h3>
          {d.lines.length === 0 && <div className="check warn">⚠️ <div>No amount yet. Fix the items on the left or type a custom amount.</div></div>}
          {d.lines.map((l, i) => (
            <div key={i} className="expense-block">
              {d.lines.length > 1 && <div className="muted small" style={{ marginBottom: 4 }}>Expense {i + 1}{l.kind === "fuel" ? " · fuel" : ""}</div>}
              {date && <CopyRow label="Date" value={date} />}
              <CopyRow label="Amount" value={(l.amountCents / 100).toFixed(2)} big />
              <CopyRow label="Memo" value={l.description} />
              <div className="muted small basis">{l.basis}</div>
            </div>
          ))}
          {d.lines.length > 0 && <div className="row" style={{ marginTop: 8 }}><span className="muted">Total</span><b style={{ fontSize: 18 }}>{(total / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</b></div>}

          <ErrorText error={patch.error || sendBack.error || (approve.error instanceof ApiError && approve.error.status === 409 ? null : approve.error)} />
          {confirmProblems ? (
            <div className="check warn" style={{ display: "block" }}>
              <b>There are warnings above.</b> Approve anyway?
              <div className="row-end mt">
                <button className="btn" onClick={() => setConfirmProblems(false)}>Go back</button>
                <button className="btn grn" onClick={() => approve.mutate(true)}>Approve anyway</button>
              </div>
            </div>
          ) : (
            <button className="btn grn big" style={{ width: "100%", marginTop: 12 }} disabled={!d.lines.length || approve.isPending} onClick={() => approve.mutate(false)}>
              ✓ Approve {d.lines.length ? (total / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : ""}
            </button>
          )}
          <div className="row-wrap mt">
            <input placeholder="Reason, if sending back to the driver" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" onClick={() => sendBack.mutate()}>Send back</button>
          </div>
        </div>
      </div>
    </article>
  );
}
