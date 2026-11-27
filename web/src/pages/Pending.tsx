import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { OfficeJob } from "../../../shared/domain";
import { sizeLabel } from "../../../shared/pricing";
import { api, ApiError } from "../api";
import { ErrorText, JobTypePill, PhotoGrid } from "../components/bits";
import { DownloadPhotos } from "../components/DownloadPhotos";
import { fmtDateTime, fmtDay, money } from "../util";

/** Scheduler only: submitted jobs with the drafted expense, checks, and Approve / Send back. */
export function Pending() {
  const q = useQuery({
    queryKey: ["pending"],
    queryFn: () => api.get<OfficeJob[]>("/pending"),
    // While Claude is reading someone's photos, check back every few seconds.
    refetchInterval: (query) => ((query.state.data as OfficeJob[] | undefined)?.some((j) => j.photoRead.status === "reading") ? 4000 : 60_000),
  });
  const [openId, setOpenId] = useState<string | null>(null);
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
      <div className="pending-rows">
        {q.data.map((j) => (
          <div key={j.id} className={`card pending-item${openId === j.id ? " open" : ""}`}>
            <PendingRow job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} />
            {openId === j.id && <PendingCard job={j} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Everything that needs a look before approving, without duplicates. */
export function flagsFor(j: OfficeJob): string[] {
  const d = j.draft;
  if (!d) return [];
  const out = [
    ...d.problems.filter((p) => !p.startsWith("Photos: ")),
    ...d.photoChecks.filter((c) => !c.ok).map((c) => c.text),
  ];
  if (j.photoRead.status === "error" || j.photoRead.status === "unavailable") out.push(j.photoRead.error ?? "Photos couldn't be read.");
  return [...new Set(out)];
}

function PendingRow({ job: j, open, onToggle }: { job: OfficeJob; open: boolean; onToggle: () => void }) {
  const d = j.draft!;
  const flags = flagsFor(j);
  const total = d.lines.reduce((t, l) => t + l.amountCents, 0);
  const reading = j.photoRead.status === "reading";
  return (
    <button className="pending-row" onClick={onToggle} aria-expanded={open}>
      <div className="thumb">{j.photos[0] ? <img src={j.photos[0].url} alt="" loading="lazy" /> : <span>No photo</span>}</div>
      <div className="pr-main">
        <div className="pr-name">{j.customerName} <JobTypePill type={j.jobType} /></div>
        <div className="muted small">
          <i className="dot" style={{ background: j.driverColor ?? "#999" }} /> {j.driverName}
          {j.scheduledDate ? ` · ${fmtDay(j.scheduledDate)}` : ""} · {j.photos.length} photo{j.photos.length === 1 ? "" : "s"}
        </div>
        <div className="pr-flag">
          {reading ? <span className="flag reading">⏳ Reading photos…</span>
          : flags.length ? <span className="flag warn" title={flags.join("\n")}>⚠️ {flags.length} check{flags.length === 1 ? "" : "s"}: {flags[0]}</span>
          : <span className="flag ok">✅ All clear</span>}
        </div>
      </div>
      <div className="pr-amt">
        <b>{j.jobType === "private_move" ? "Record only" : d.lines.length ? (total / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "No amount"}</b>
        {d.lines.length > 1 && <div className="muted small">{d.lines.length} expenses</div>}
        <div className="muted small">{open ? "Close ▲" : "Review ▼"}</div>
      </div>
    </button>
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
  const [escort, setEscort] = useState(j.escortCents === null ? "" : (j.escortCents / 100).toFixed(2));
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
  const remove = useMutation({ mutationFn: () => api.del(`/jobs/${j.id}`), onSuccess: refresh });
  const total = d.lines.reduce((t, l) => t + l.amountCents, 0);
  const date = j.scheduledDate ? fmtDay(j.scheduledDate, { month: "numeric", day: "numeric", year: "numeric" }) : "";
  const showMiles = j.jobType === "shop_build" || j.jobType === "repo" || j.jobType === "new" || j.jobType === "used";

  return (
    <article className="pad pending-card">
      <div className="muted small">Submitted {fmtDateTime(j.submittedAt!)}{j.scheduledDate ? ` · job date ${fmtDay(j.scheduledDate)}` : ""}</div>

      <div className="pending-body">
        <div>
          <PhotoGrid photos={j.photos} editable={false} />
          {j.driverNotes && <div className="note-box mt"><b>Driver notes:</b> {j.driverNotes}</div>}
          {(j.collectCents !== null || j.jobType === "private_move") && (
            <div className={`check ${j.collectCents === null || (j.collectedCents ?? 0) >= j.collectCents ? "ok" : "warn"} mt`}>
              💵 <div>
                {j.jobType === "private_move" ? <><b>Customer gave {money(j.collectedCents ?? 0) === "Paid" ? "$0.00" : money(j.collectedCents ?? 0)}.</b> Recorded only, no expense.</>
                : <><b>Collected {j.collectedCents === null ? "nothing entered" : money(j.collectedCents) === "Paid" ? "$0.00" : money(j.collectedCents)}</b> of {money(j.collectCents)} due{j.collectedMethod ? ` · ${j.collectedMethod}` : ""}{j.collectedRef ? ` · ${j.collectedRef}` : ""}.</>}
              </div>
            </div>
          )}

          <PhotoReadBox job={j} />

          <h3 className="sec-head">Checks</h3>
          {j.reportedCustomerName && (
            <div className={`check ${d.nameMatches ? "ok" : "warn"}`}>
              {d.nameMatches ? "✅" : "⚠️"} <div><b>Customer name {d.nameMatches ? "matches" : "doesn't match"}.</b> Driver wrote “{j.reportedCustomerName}”; job is “{j.customerName}”.</div>
            </div>
          )}
          {d.serialInfo && (
            <div className="check ok">✅ <div><b>Serial {d.serialFromPhoto ? (j.photoRead.result?.serialOnHappySheet ?? j.photoRead.result?.serialOnBuilding) : j.serial}</b> = {sizeLabel(d.serialInfo)}{d.listPriceCents !== null ? `, list price ${money(d.listPriceCents)}` : ""}.{d.serialFromPhoto ? " (Read from the photos; the job had no serial.)" : ""}</div></div>
          )}
          {d.photoChecks.map((c) => (
            <div key={c.text} className={`check ${c.ok ? "ok" : "warn"}`}>{c.ok ? "✅" : "⚠️"} <div>{c.text}</div></div>
          ))}
          {d.problems.filter((p) => !p.startsWith("Driver wrote") && !p.startsWith("Photos: ")).map((p) => (
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
                <span>Building came from the <b>Moody</b> lot (pays like a shop build: 10% for 0–50 mi, +1% per 50 mi)</span>
              </label>
            )}
            {j.jobType === "repo" && (d.serialInfo?.width ?? 0) >= 14 && (
              <label>Escort fees ($)
                <input value={escort} inputMode="decimal" placeholder="0 if none" onChange={(e) => setEscort(e.target.value)}
                  onBlur={() => escort !== (j.escortCents === null ? "" : (j.escortCents / 100).toFixed(2)) && patch.mutate({ escort: escort === "" ? null : escort })} />
              </label>
            )}
            {j.jobType === "attempted_repo" && (
              <label className="checkbox span2">
                <input type="checkbox" checked={j.keptPaidInFull === true} onChange={(e) => patch.mutate({ keptPaidInFull: e.target.checked })} />
                <span>Customer paid in full to keep the building (pays more)</span>
              </label>
            )}
            <label>Custom amount ($)
              <input value={override} inputMode="decimal" placeholder="Leave blank to use the calculation"
                onChange={(e) => setOverride(e.target.value)}
                onBlur={() => override !== (j.amountOverrideCents === null ? "" : (j.amountOverrideCents / 100).toFixed(2)) && patch.mutate({ amountOverride: override === "" ? null : override })} />
            </label>
          </div>

          <h3 className="sec-head">Expense report draft {d.lines.length > 1 && <span className="muted">({d.lines.length} separate expenses)</span>}</h3>
          {d.lines.length === 0 && j.jobType === "private_move" && <div className="check ok">✅ <div>Private moves aren't expensed. Approving just records the job.</div></div>}
          {d.lines.length === 0 && j.jobType !== "private_move" && <div className="check warn">⚠️ <div>No amount yet. Fix the items on the left or type a custom amount.</div></div>}
          {d.lines.map((l, i) => (
            <div key={i} className="expense-block">
              {d.lines.length > 1 && <div className="muted small" style={{ marginBottom: 4 }}>Expense {i + 1}{l.kind === "fuel" ? " · fuel" : ""}</div>}
              {date && <CopyRow label="Date" value={date} />}
              <CopyRow label="Amount" value={(l.amountCents / 100).toFixed(2)} big />
              <CopyRow label="Memo" value={l.description} />
              {i === 0 && j.photos.length > 0 && (
                <div className="copyrow"><div className="k">Photos</div><div className="v">{j.photos.length} attached to this job</div><div className="c-wrap"><Link className="btn small" to={`/photos/${j.id}`}>🖼 Photos page</Link><DownloadPhotos job={j} small /></div></div>
              )}
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
            <button className="btn grn big" style={{ width: "100%", marginTop: 12 }} disabled={(!d.lines.length && j.jobType !== "private_move") || approve.isPending} onClick={() => approve.mutate(false)}>
              ✓ {j.jobType === "private_move" ? "Approve (record only)" : `Approve ${d.lines.length ? (total / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : ""}`}
            </button>
          )}
          <div className="row-wrap mt">
            <input placeholder="Reason, if sending back to the driver" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" onClick={() => sendBack.mutate()}>Send back</button>
          </div>
          <div className="row-end mt">
            <button className="btn danger small" disabled={remove.isPending}
              onClick={() => confirm(`Delete ${j.customerName}'s job, photos and drafted expense? This can't be undone.`) && remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Delete job"}
            </button>
          </div>
          <ErrorText error={remove.error} />
        </div>
      </div>
    </article>
  );
}

function PhotoReadBox({ job }: { job: OfficeJob }) {
  const qc = useQueryClient();
  const reread = useMutation({
    mutationFn: () => api.post(`/jobs/${job.id}/read-photos`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["pending"] }),
  });
  const pr = job.photoRead;
  const r = pr.result;
  return (
    <div className="photo-read">
      <div className="row">
        <h3 className="sec-head" style={{ margin: 0 }}>What the photos say</h3>
        {pr.status !== "reading" && job.photos.length > 0 && (
          <button className="btn small" disabled={reread.isPending} onClick={() => reread.mutate()}>{reread.isPending ? "Reading…" : r ? "Read again" : "Read photos"}</button>
        )}
      </div>
      {pr.status === "reading" && <div className="muted small mt">Claude is reading the photos…</div>}
      {(pr.status === "error" || pr.status === "unavailable") && <div className="check warn mt">⚠️ <div>{pr.error}</div></div>}
      {pr.status === "none" && !r && <div className="muted small mt">Not read yet.</div>}
      {r && (
        <dl className="facts read-facts mt">
          <dt>Serial on sheet</dt><dd>{r.serialOnHappySheet ?? "—"}</dd>
          <dt>Serial on building</dt><dd>{r.serialOnBuilding ?? "not visible"}</dd>
          <dt>Customer</dt><dd>{r.customerName ?? "—"}{r.customerSigned ? " · signed" : r.customerSigned === false ? " · NOT signed" : ""}</dd>
          <dt>Top line</dt><dd>{r.topLineRaw ?? "—"}</dd>
          <dt>Lot</dt><dd>{r.topLineLot ?? "—"}</dd>
          <dt>Balance on sheet</dt><dd>{r.balanceDueOnSheet ?? "—"}{r.paymentTypeOnSheet ? ` · ${r.paymentTypeOnSheet}` : ""}</dd>
          <dt>Date · driver</dt><dd>{[r.sheetDate, r.driverName].filter(Boolean).join(" · ") || "—"}</dd>
        </dl>
      )}
      <ErrorText error={reread.error} />
    </div>
  );
}
