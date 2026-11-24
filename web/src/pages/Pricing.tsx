import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERCENT_RULES, type PriceRow, type PricingSettings, type RepoRate } from "../../../shared/pricing";
import { api, ApiError } from "../api";
import { ErrorText } from "../components/bits";

interface PricingData { prices: PriceRow[]; repoRates: RepoRate[]; settings: PricingSettings }

const dollars = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Scheduler only: price sheet, repo mileage rates, fuel charge. */
export function Pricing() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pricing"], queryFn: () => api.get<PricingData>("/pricing") });
  const done = (d: PricingData) => { qc.setQueryData(["pricing"], d); qc.invalidateQueries({ queryKey: ["pending"] }); };

  if (!q.data) return <div className="muted">Loading…</div>;
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="top"><div><h1>Pricing</h1><div className="muted">How expenses are calculated. Changes apply to pending jobs right away (approved ones stay as they were).</div></div></div>
      <div className="pricing-grid">
        <Rules data={q.data} onSaved={done} />
        <RepoRates data={q.data} onSaved={done} />
      </div>
      <PriceSheet data={q.data} onSaved={done} />
    </div>
  );
}

function Rules({ data, onSaved }: { data: PricingData; onSaved: (d: PricingData) => void }) {
  const [fuel, setFuel] = useState((data.settings.fuelChargeCents / 100).toFixed(2));
  const [attempted, setAttempted] = useState((data.settings.attemptedRepoCents / 100).toFixed(2));
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api.put<PricingData>("/pricing/settings", body), onSuccess: onSaved });
  return (
    <section className="card pad">
      <h2>Rules</h2>
      <ul className="rules">
        <li><b>New:</b> {PERCENT_RULES.new}% of list price ({PERCENT_RULES.newMoody}% if the happy sheet says Moody)</li>
        <li><b>Used:</b> {PERCENT_RULES.used}% of list price</li>
        <li><b>Shop Build:</b> {PERCENT_RULES.shopBuildBase}% for 0–50 mi, +1% for every 50 mi after (50.1–100 = 11%, 100.1–150 = 12% …)</li>
        <li><b>Repo:</b> mileage rate from the table →</li>
        <li><b>Attempted Repo:</b> flat amount below</li>
      </ul>
      <div className="form">
        <label className="checkbox">
          <input type="checkbox" checked={data.settings.fuelChargeOn} onChange={(e) => save.mutate({ fuelChargeOn: e.target.checked })} />
          Add a separate “(Customer) Fuel” expense on successful repos
        </label>
        <div className="grid2 form" style={{ marginTop: 0 }}>
          <label>Fuel charge ($)<input value={fuel} inputMode="decimal" onChange={(e) => setFuel(e.target.value)} onBlur={() => save.mutate({ fuelCharge: fuel })} /></label>
          <label>Attempted repo ($)<input value={attempted} inputMode="decimal" onChange={(e) => setAttempted(e.target.value)} onBlur={() => save.mutate({ attemptedRepo: attempted })} /></label>
        </div>
        <ErrorText error={save.error} />
      </div>
    </section>
  );
}

function RepoRates({ data, onSaved }: { data: PricingData; onSaved: (d: PricingData) => void }) {
  const toRows = (r: RepoRate[]) =>
    [...r].sort((a, b) => (a.upToMiles ?? Infinity) - (b.upToMiles ?? Infinity)).map((x) => ({ upToMiles: x.upToMiles === null ? "" : String(x.upToMiles), amount: (x.amountCents / 100).toFixed(2) }));
  const [rows, setRows] = useState(toRows(data.repoRates));
  useEffect(() => setRows(toRows(data.repoRates)), [data.repoRates]);
  const save = useMutation({ mutationFn: () => api.put<PricingData>("/pricing/repo-rates", { rates: rows.filter((r) => r.amount.trim()) }), onSuccess: onSaved });
  return (
    <section className="card pad">
      <h2>Repo rates by miles</h2>
      <p className="muted small">The first row that covers the trip is used. Leave “up to” blank on the last row for “and up”.</p>
      <table className="rates">
        <thead><tr><th>Up to miles</th><th>Pay ($)</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.upToMiles} placeholder="and up" inputMode="decimal" onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, upToMiles: e.target.value } : x)))} /></td>
              <td><input value={r.amount} inputMode="decimal" onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} /></td>
              <td><button className="icon-btn" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label="Remove row">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="muted small">No rates yet. Repos can't be priced until these are filled in.</div>}
      <div className="row-end mt">
        <button className="btn small" onClick={() => setRows([...rows, { upToMiles: "", amount: "" }])}>＋ Add row</button>
        <button className="btn pri small" onClick={() => save.mutate()} disabled={save.isPending}>Save rates</button>
      </div>
      <ErrorText error={save.error} />
      {save.isSuccess && <div className="ok-box mt">Saved.</div>}
    </section>
  );
}

function PriceSheet({ data, onSaved }: { data: PricingData; onSaved: (d: PricingData) => void }) {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [bad, setBad] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: (ignoreBad: boolean) => api.put<PricingData & { saved: number }>("/pricing/prices", { text, ignoreBad }),
    onSuccess: (d) => { onSaved(d); setText(""); setBad([]); },
    onError: (e) => setBad(e instanceof ApiError && Array.isArray(e.body.bad) ? (e.body.bad as string[]) : []),
  });
  const rows = [...data.prices]
    .sort((a, b) => a.style.localeCompare(b.style) || a.width - b.width || a.length - b.length)
    .filter((p) => !filter || `${p.style} ${p.width}x${p.length}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="card pad" style={{ marginTop: 16 }}>
      <div className="row"><h2>Price sheet <span className="muted">({data.prices.length} sizes)</span></h2></div>
      <p className="muted small">Paste the whole sheet: one line per building, like <code>CC 12x32 9695</code>. Saving replaces the current sheet.</p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"CC 12x32 9695\nCC 12x28 8795\nLB 10x16 5495"} />
      {bad.length > 0 && (
        <div className="error">
          These lines couldn't be read:<ul>{bad.slice(0, 10).map((b) => <li key={b}><code>{b}</code></li>)}</ul>{bad.length > 10 && `…and ${bad.length - 10} more`}
          <div className="row-end mt"><button className="btn small" onClick={() => save.mutate(true)}>Save the rest anyway</button></div>
        </div>
      )}
      <ErrorText error={bad.length ? null : save.error} />
      <div className="row-end mt"><button className="btn pri" disabled={!text.trim() || save.isPending} onClick={() => save.mutate(false)}>Save price sheet</button></div>

      {data.prices.length > 0 && (
        <>
          <input className="mt" placeholder="Search, e.g. CC 12x" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} />
          <div className="table-wrap mt" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Style</th><th>Size</th><th>List price</th><th>New 5%</th><th>New Moody 10%</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={`${p.style}-${p.width}-${p.length}`}>
                    <td><b>{p.style}</b></td><td>{p.width}x{p.length}</td><td>{dollars(p.priceCents)}</td>
                    <td className="muted">{dollars(Math.round(p.priceCents * 0.05))}</td><td className="muted">{dollars(Math.round(p.priceCents * 0.1))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
