import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  JOB_TYPES, KEPT_PAID_TO_LABELS, TRUCK_COST_CATEGORIES, TRUCK_COST_LABELS,
  type AccountingReport, type FuelReceipt, type PayJob, type TruckCost, type TruckCostCategory,
} from "../../../shared/domain";
import { api } from "../api";
import { ErrorText, JobTypePill, Modal } from "../components/bits";
import { addDays, compressImage, fmtDay, jobTypeLabel, weekStart } from "../util";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const usd0 = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const today = () => new Date().toLocaleDateString("en-CA");
const short = (d: string) => fmtDay(d, { month: "numeric", day: "numeric" });

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "this-year" | "last-year" | "custom";
const PRESETS: [Preset, string][] = [
  ["this-week", "This week"], ["last-week", "Last week"], ["this-month", "This month"], ["last-month", "Last month"],
  ["this-year", "This year"], ["last-year", "Last year"], ["custom", "Custom dates"],
];
function rangeFor(p: Preset): [string, string] {
  const t = today();
  const y = Number(t.slice(0, 4));
  switch (p) {
    case "this-week": return [weekStart(t), addDays(weekStart(t), 6)];
    case "last-week": return [addDays(weekStart(t), -7), addDays(weekStart(t), -1)];
    case "this-month": return [t.slice(0, 8) + "01", t];
    case "last-month": {
      const first = t.slice(0, 8) + "01";
      const end = addDays(first, -1);
      return [end.slice(0, 8) + "01", end];
    }
    case "this-year": return [`${y}-01-01`, t];
    case "last-year": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return [t.slice(0, 8) + "01", t];
  }
}

function csv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const dollars = (c: number | null) => (c === null ? null : (c / 100).toFixed(2));

/** Scheduler and owners: money in and out, driver pay, fuel, truck costs. Drivers never get here. */
export function Accounting() {
  const qc = useQueryClient();
  const [preset, setPreset] = useState<Preset>("this-month");
  const [[from, to], setRange] = useState<[string, string]>(rangeFor("this-month"));
  const q = useQuery({ queryKey: ["accounting", from, to], queryFn: () => api.get<AccountingReport>(`/accounting?from=${from}&to=${to}`) });
  const unpaid = useQuery({ queryKey: ["accounting-unpaid"], queryFn: () => api.get<PayJob[]>("/accounting/unpaid") });
  const [fuelEdit, setFuelEdit] = useState<FuelReceipt | "new" | null>(null);
  const [costEdit, setCostEdit] = useState<TruckCost | "new" | null>(null);
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["accounting"] }); qc.invalidateQueries({ queryKey: ["accounting-unpaid"] }); };
  const markPaid = useMutation({
    mutationFn: (v: { jobIds: string[]; paid: boolean }) => api.post("/accounting/pay", v),
    onSuccess: refresh,
  });

  const r = q.data;
  const sums = useMemo(() => {
    if (!r) return null;
    const expensed = r.jobs.reduce((t, j) => t + j.expensedCents, 0);
    const pay = r.jobs.reduce((t, j) => t + (j.payCents ?? 0), 0);
    const payUnset = r.jobs.filter((j) => j.payCents === null && j.driverId).length;
    const fuel = r.fuel.reduce((t, f) => t + (f.amountCents ?? 0), 0);
    const gallons = r.fuel.reduce((t, f) => t + (f.gallons ?? 0), 0);
    const truck = r.truckCosts.reduce((t, c) => t + c.amountCents, 0);
    const miles = Object.values(r.odometerMiles).reduce((t, m) => t + m, 0);
    const jobMiles = r.jobs.reduce((t, j) => t + (j.miles ?? 0), 0);
    return { expensed, pay, payUnset, fuel, gallons, truck, miles, jobMiles, net: expensed - pay - fuel - truck };
  }, [r]);

  if (!r || !sums) return <div className="muted">{q.isError ? "Couldn't load accounting." : "Loading…"}</div>;

  const drivers = r.drivers.filter((d) => r.jobs.some((j) => j.driverId === d.id) || r.fuel.some((f) => f.driverId === d.id) || d.payHaulPct !== null);
  const earlierUnpaid = (unpaid.data ?? []).filter((j) => j.date < from && (j.payCents ?? 0) > 0);
  const months = [...new Set([...r.jobs.map((j) => j.date), ...r.fuel.map((f) => f.date), ...r.truckCosts.map((c) => c.date)].map((d) => d.slice(0, 7)))].sort();

  const exportJobs = () => csv(`jobs-and-pay-${from}-to-${to}.csv`, [
    ["Date", "Customer", "Type", "Serial", "Driver", "Miles", "Expensed (NetSuite)", "Of which repo fuel", "Driver pay", "Pay basis", "Pay paid", "Collected", "Collected how", "Kept building paid to"],
    ...r.jobs.map((j) => [j.date, j.customerName, jobTypeLabel(j.jobType), j.serial, j.driverName, j.miles, dollars(j.expensedCents), dollars(j.fuelLineCents),
      dollars(j.payCents), j.payBasis, j.payPaidAt ? j.payPaidAt.slice(0, 10) : "", dollars(j.collectedCents), j.collectedMethod, j.keptPaidTo ? KEPT_PAID_TO_LABELS[j.keptPaidTo] : ""]),
  ]);
  const exportFuel = () => csv(`fuel-${from}-to-${to}.csv`, [
    ["Date", "Driver", "Station", "Gallons", "Odometer", "Amount", "Notes", "Checks"],
    ...r.fuel.map((f) => [f.date, f.driverName ?? "", f.station, f.gallons, f.odometer, dollars(f.amountCents), f.notes, (f.checks ?? []).join("; ")]),
  ]);
  const exportCosts = () => csv(`truck-costs-${from}-to-${to}.csv`, [
    ["Date", "Category", "Vehicle", "Driver", "Vendor", "Description", "Amount"],
    ...r.truckCosts.map((c) => [c.date, TRUCK_COST_LABELS[c.category], c.vehicle, c.driverName ?? "", c.vendor, c.description, dollars(c.amountCents)]),
  ]);
  const exportSummary = () => csv(`summary-${from}-to-${to}.csv`, [
    ["Month", "Jobs", "Expensed (NetSuite)", "Driver pay", "Fuel", "Truck & trailer", "Left after costs"],
    ...months.map((m) => {
      const js = r.jobs.filter((j) => j.date.startsWith(m));
      const e = js.reduce((t, j) => t + j.expensedCents, 0), p = js.reduce((t, j) => t + (j.payCents ?? 0), 0);
      const f = r.fuel.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + (x.amountCents ?? 0), 0);
      const c = r.truckCosts.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + x.amountCents, 0);
      return [m, js.length, dollars(e), dollars(p), dollars(f), dollars(c), dollars(e - p - f - c)];
    }),
    ["Total", r.jobs.length, dollars(sums.expensed), dollars(sums.pay), dollars(sums.fuel), dollars(sums.truck), dollars(sums.net)],
  ]);

  return (
    <div>
      <div className="top">
        <div><h1>Accounting</h1><div className="muted">Approved jobs by the day they were hauled. Drivers never see this page.</div></div>
        <div className="acct-period">
          <label>Period
            <select value={preset} onChange={(e) => { const p = e.target.value as Preset; setPreset(p); if (p !== "custom") setRange(rangeFor(p)); }}>
              {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>From<input type="date" value={from} onChange={(e) => { setPreset("custom"); e.target.value && setRange([e.target.value, to]); }} /></label>
          <label>To<input type="date" value={to} onChange={(e) => { setPreset("custom"); e.target.value && setRange([from, e.target.value]); }} /></label>
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="l">Expensed (NetSuite)</div><div className="v">{usd0(sums.expensed)}</div><div className="sub">{r.jobs.length} jobs</div></div>
        <div className="card kpi"><div className="l">Driver pay</div><div className="v">{usd0(sums.pay)}</div>{sums.payUnset > 0 && <div className="sub danger-text">{sums.payUnset} jobs need a pay rate</div>}</div>
        <div className="card kpi"><div className="l">Fuel</div><div className="v">{usd0(sums.fuel)}</div><div className="sub">{sums.gallons.toFixed(1)} gal{sums.gallons ? ` · ${usd(Math.round(sums.fuel / sums.gallons))}/gal` : ""}</div></div>
        <div className="card kpi"><div className="l">Truck & trailer</div><div className="v">{usd0(sums.truck)}</div><div className="sub">{r.truckCosts.length} entries</div></div>
        <div className={`card kpi${sums.net < 0 ? " neg" : ""}`}><div className="l">Left after costs</div><div className="v">{usd0(sums.net)}</div><div className="sub">expensed − pay − fuel − truck</div></div>
        <div className="card kpi"><div className="l">Miles (odometer)</div><div className="v">{sums.miles.toLocaleString()}</div>
          <div className="sub">{sums.miles ? `${usd(Math.round((sums.fuel + sums.truck) / sums.miles))}/mi · ${sums.gallons ? (sums.miles / sums.gallons).toFixed(1) : "—"} mpg` : "needs 2+ fuel readings"}</div></div>
      </div>

      <div className="row-wrap" style={{ gap: 8 }}>
        <span className="muted small">Download for Excel:</span>
        <button className="btn small" onClick={exportSummary}>⬇ Summary by month</button>
        <button className="btn small" onClick={exportJobs}>⬇ Jobs & pay</button>
        <button className="btn small" onClick={exportFuel}>⬇ Fuel</button>
        <button className="btn small" onClick={exportCosts}>⬇ Truck costs</button>
      </div>

      {/* ---------- Driver pay ---------- */}
      <section className="acct-sec">
        <div className="row"><h2>Driver pay</h2><span className="muted small">Set pay rates on the Team page.</span></div>
        <ErrorText error={markPaid.error} />
        {earlierUnpaid.length > 0 && (
          <div className="warn-box small" style={{ marginBottom: 10 }}>
            {earlierUnpaid.length} job{earlierUnpaid.length === 1 ? "" : "s"} from before {short(from)} still unpaid ({usd(earlierUnpaid.reduce((t, j) => t + (j.payCents ?? 0), 0))}).{" "}
            <button className="link-btn" onClick={() => { setPreset("custom"); setRange([earlierUnpaid[0]!.date, to]); }}>Show them</button>
          </div>
        )}
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Driver</th><th>Rates</th><th className="num">Jobs</th><th className="num">Expensed</th><th className="num">Pay</th><th className="num">Paid</th><th className="num">Owed</th><th className="num">Fuel</th><th className="num">Miles</th><th></th></tr></thead>
            <tbody>
              {drivers.map((d) => {
                const js = r.jobs.filter((j) => j.driverId === d.id);
                const pay = js.reduce((t, j) => t + (j.payCents ?? 0), 0);
                const paid = js.filter((j) => j.payPaidAt).reduce((t, j) => t + (j.payCents ?? 0), 0);
                const owedJobs = js.filter((j) => !j.payPaidAt && j.payCents !== null);
                const fuel = r.fuel.filter((f) => f.driverId === d.id).reduce((t, f) => t + (f.amountCents ?? 0), 0);
                const open = openDriver === d.id;
                return [
                  <tr key={d.id} className="clickable" onClick={() => setOpenDriver(open ? null : d.id)}>
                    <td><i className="dot" style={{ background: d.color }} /> <b>{d.name}</b> <span className="muted small">{open ? "▾" : "▸"}</span></td>
                    <td className="small">{d.payHaulPct === null && d.payRepoPct === null ? <span className="danger-text">Not set</span> : `Hauls ${d.payHaulPct ?? "—"}% · Repos ${d.payRepoPct ?? "—"}%`}</td>
                    <td className="num">{js.length}</td>
                    <td className="num">{usd(js.reduce((t, j) => t + j.expensedCents, 0))}</td>
                    <td className="num"><b>{usd(pay)}</b></td>
                    <td className="num">{usd(paid)}</td>
                    <td className="num"><b>{usd(pay - paid)}</b></td>
                    <td className="num">{usd(fuel)}</td>
                    <td className="num">{(r.odometerMiles[d.id] ?? 0).toLocaleString()}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {owedJobs.length > 0 && (
                        <button className="btn small pri" disabled={markPaid.isPending}
                          onClick={() => confirm(`Mark ${owedJobs.length} job${owedJobs.length === 1 ? "" : "s"} paid to ${d.name} (${usd(owedJobs.reduce((t, j) => t + (j.payCents ?? 0), 0))})?`) && markPaid.mutate({ jobIds: owedJobs.map((j) => j.id), paid: true })}>
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>,
                  open && (
                    <tr key={d.id + "-jobs"}>
                      <td colSpan={10} style={{ background: "var(--bg)" }}>
                        {js.length === 0 ? <div className="muted small">No approved jobs in this period.</div> : (
                          <table>
                            <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th className="num">Expensed</th><th className="num">Pay</th><th>How</th><th>Paid</th></tr></thead>
                            <tbody>
                              {js.map((j) => (
                                <tr key={j.id}>
                                  <td>{short(j.date)}</td>
                                  <td>{j.customerName}{j.keptPaidTo && <div className="muted small">Kept building · {KEPT_PAID_TO_LABELS[j.keptPaidTo]}</div>}</td>
                                  <td><JobTypePill type={j.jobType} /></td>
                                  <td className="num">{usd(j.expensedCents)}{j.fuelLineCents > 0 && <div className="muted small">incl. fuel {usd(j.fuelLineCents)}</div>}</td>
                                  <td className="num"><b>{j.payCents === null ? "—" : usd(j.payCents)}</b></td>
                                  <td className="small muted">{j.payBasis}</td>
                                  <td>
                                    <label className="checkbox small">
                                      <input type="checkbox" checked={!!j.payPaidAt} disabled={markPaid.isPending || j.payCents === null}
                                        onChange={(e) => markPaid.mutate({ jobIds: [j.id], paid: e.target.checked })} />
                                      {j.payPaidAt ? short(j.payPaidAt.slice(0, 10)) : "Not yet"}
                                    </label>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
              {drivers.length === 0 && <tr><td colSpan={10} className="muted">No drivers with jobs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- By job type ---------- */}
      <section className="acct-sec">
        <div className="row"><h2>By job type</h2></div>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Type</th><th className="num">Jobs</th><th className="num">Expensed</th><th className="num">Driver pay</th><th className="num">Avg per job</th></tr></thead>
            <tbody>
              {JOB_TYPES.map((t) => {
                const js = r.jobs.filter((j) => j.jobType === t);
                if (!js.length) return null;
                const e = js.reduce((s, j) => s + j.expensedCents, 0);
                return (
                  <tr key={t}>
                    <td><JobTypePill type={t} /></td>
                    <td className="num">{js.length}</td>
                    <td className="num">{usd(e)}</td>
                    <td className="num">{usd(js.reduce((s, j) => s + (j.payCents ?? 0), 0))}</td>
                    <td className="num">{usd(Math.round(e / js.length))}</td>
                  </tr>
                );
              })}
              {r.jobs.length === 0 && <tr><td colSpan={5} className="muted">No approved jobs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- By month ---------- */}
      {months.length > 1 && (
        <section className="acct-sec">
          <div className="row"><h2>By month</h2></div>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Month</th><th className="num">Jobs</th><th className="num">Expensed</th><th className="num">Driver pay</th><th className="num">Fuel</th><th className="num">Truck & trailer</th><th className="num">Left</th></tr></thead>
              <tbody>
                {months.map((m) => {
                  const js = r.jobs.filter((j) => j.date.startsWith(m));
                  const e = js.reduce((t, j) => t + j.expensedCents, 0), p = js.reduce((t, j) => t + (j.payCents ?? 0), 0);
                  const f = r.fuel.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + (x.amountCents ?? 0), 0);
                  const c = r.truckCosts.filter((x) => x.date.startsWith(m)).reduce((t, x) => t + x.amountCents, 0);
                  return (
                    <tr key={m}>
                      <td>{new Date(m + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</td>
                      <td className="num">{js.length}</td><td className="num">{usd(e)}</td><td className="num">{usd(p)}</td>
                      <td className="num">{usd(f)}</td><td className="num">{usd(c)}</td><td className={`num${e - p - f - c < 0 ? " danger-text" : ""}`}><b>{usd(e - p - f - c)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Fuel ---------- */}
      <section className="acct-sec">
        <div className="row"><h2>Fuel receipts</h2><button className="btn small" onClick={() => setFuelEdit("new")}>＋ Add receipt</button></div>
        <div className="card table-wrap">
          <table>
            <thead><tr><th></th><th>Date</th><th>Driver</th><th>Station</th><th className="num">Gallons</th><th className="num">Odometer</th><th className="num">Amount</th><th>Checks</th></tr></thead>
            <tbody>
              {r.fuel.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => setFuelEdit(f)}>
                  <td onClick={(e) => e.stopPropagation()}>{f.photoUrl ? <a className="thumb-link" href={f.photoUrl} target="_blank" rel="noreferrer"><img src={f.photoUrl} alt="Receipt" loading="lazy" /></a> : <span className="muted">—</span>}</td>
                  <td>{short(f.date)}</td>
                  <td><i className="dot" style={{ background: f.driverColor ?? "#999" }} /> {f.driverName}</td>
                  <td className="small">{f.station || <span className="muted">—</span>}</td>
                  <td className="num">{f.gallons ?? "—"}</td>
                  <td className="num">{f.odometer?.toLocaleString() ?? "—"}</td>
                  <td className="num"><b>{f.amountCents === null ? "—" : usd(f.amountCents)}</b></td>
                  <td className="small">
                    {f.aiStatus === "reading" ? <span className="muted">Reading…</span>
                      : f.checks?.length ? f.checks.map((c) => <span key={c} className="flag warn">{c}</span>)
                      : f.aiStatus === "done" ? <span className="muted">✓ matches photo</span>
                      : f.aiError ? <span className="muted">{f.aiError}</span> : null}
                  </td>
                </tr>
              ))}
              {r.fuel.length === 0 && <tr><td colSpan={8} className="muted">No fuel receipts in this period. Drivers add them from the Fuel tab on their phone.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Truck and trailer ---------- */}
      <section className="acct-sec">
        <div className="row"><h2>Truck & trailer costs</h2><button className="btn small pri" onClick={() => setCostEdit("new")}>＋ Add cost</button></div>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Vehicle</th><th>Vendor</th><th>What</th><th className="num">Amount</th><th>Receipt</th></tr></thead>
            <tbody>
              {r.truckCosts.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setCostEdit(c)}>
                  <td>{short(c.date)}</td>
                  <td>{TRUCK_COST_LABELS[c.category]}</td>
                  <td>{c.vehicle || (c.driverName ? `${c.driverName}'s truck` : <span className="muted">—</span>)}</td>
                  <td>{c.vendor}</td>
                  <td className="small">{c.description}</td>
                  <td className="num"><b>{usd(c.amountCents)}</b></td>
                  <td onClick={(e) => e.stopPropagation()}>{c.photoUrl ? <a href={c.photoUrl} target="_blank" rel="noreferrer">View</a> : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {r.truckCosts.length > 0 && (
                <tr className="total-row"><td colSpan={5}>Total</td><td className="num">{usd(sums.truck)}</td><td /></tr>
              )}
              {r.truckCosts.length === 0 && <tr><td colSpan={7} className="muted">No truck or trailer costs in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {fuelEdit && <FuelModal receipt={fuelEdit === "new" ? null : fuelEdit} drivers={r.drivers} onClose={() => setFuelEdit(null)} onSaved={refresh} />}
      {costEdit && <CostModal cost={costEdit === "new" ? null : costEdit} drivers={r.drivers} onClose={() => setCostEdit(null)} onSaved={refresh} />}
    </div>
  );
}

type DriverOpt = AccountingReport["drivers"][number];

function FuelModal({ receipt, drivers, onClose, onSaved }: { receipt: FuelReceipt | null; drivers: DriverOpt[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    driverId: receipt?.driverId ?? drivers[0]?.id ?? "",
    date: receipt?.date ?? today(),
    gallons: receipt?.gallons?.toString() ?? "",
    odometer: receipt?.odometer?.toString() ?? "",
    amount: receipt?.amountCents != null ? (receipt.amountCents / 100).toFixed(2) : "",
    station: receipt?.station ?? "",
    notes: receipt?.notes ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (receipt) return api.patch(`/fuel/${receipt.id}`, f);
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append("file", await compressImage(file));
      return api.post("/fuel", fd);
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  const del = useMutation({ mutationFn: () => api.del(`/fuel/${receipt!.id}`), onSuccess: () => { onSaved(); onClose(); } });
  const reread = useMutation({ mutationFn: () => api.post(`/fuel/${receipt!.id}/read`), onSuccess: () => { onSaved(); onClose(); } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={receipt ? "Fuel receipt" : "Add a fuel receipt"} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {receipt?.photoUrl && <a href={receipt.photoUrl} target="_blank" rel="noreferrer"><img src={receipt.photoUrl} alt="Receipt" style={{ maxHeight: 260, maxWidth: "100%", borderRadius: 8 }} /></a>}
        {receipt?.checks?.length ? <div className="warn-box small">{receipt.checks.join(" · ")}</div> : null}
        <div className="grid2">
          <label>Driver<select value={f.driverId} onChange={set("driverId")}>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Date<input type="date" value={f.date} onChange={set("date")} /></label>
          <label>Gallons<input value={f.gallons} inputMode="decimal" onChange={set("gallons")} /></label>
          <label>Odometer<input value={f.odometer} inputMode="numeric" onChange={set("odometer")} /></label>
          <label>Amount ($)<input value={f.amount} inputMode="decimal" onChange={set("amount")} /></label>
          <label>Station<input value={f.station} onChange={set("station")} /></label>
          <label className="span2">Notes<input value={f.notes} onChange={set("notes")} /></label>
          {!receipt && <label className="span2">Receipt photo (optional)<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
        </div>
        <ErrorText error={save.error || del.error || reread.error} />
        <div className="row">
          <span className="row-wrap" style={{ gap: 6 }}>
            {receipt && <button type="button" className="btn small danger" onClick={() => confirm("Delete this receipt?") && del.mutate()}>Delete</button>}
            {receipt?.photoUrl && <button type="button" className="btn small" disabled={reread.isPending} onClick={() => reread.mutate()}>{reread.isPending ? "Reading…" : "Read photo again"}</button>}
          </span>
          <span className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn pri" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

function CostModal({ cost, drivers, onClose, onSaved }: { cost: TruckCost | null; drivers: DriverOpt[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    date: cost?.date ?? today(),
    category: (cost?.category ?? "repair") as TruckCostCategory,
    vehicle: cost?.vehicle ?? "",
    driverId: cost?.driverId ?? "",
    vendor: cost?.vendor ?? "",
    description: cost?.description ?? "",
    amount: cost ? (cost.amountCents / 100).toFixed(2) : "",
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (cost) return api.patch(`/truck-costs/${cost.id}`, f);
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append("file", file.type.startsWith("image/") ? await compressImage(file) : file);
      return api.post("/truck-costs", fd);
    },
    onSuccess: () => { onSaved(); onClose(); },
  });
  const del = useMutation({ mutationFn: () => api.del(`/truck-costs/${cost!.id}`), onSuccess: () => { onSaved(); onClose(); } });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={cost ? "Truck / trailer cost" : "Add a truck or trailer cost"} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid2">
          <label>Date<input type="date" value={f.date} onChange={set("date")} /></label>
          <label>Category<select value={f.category} onChange={set("category")}>{TRUCK_COST_CATEGORIES.map((c) => <option key={c} value={c}>{TRUCK_COST_LABELS[c]}</option>)}</select></label>
          <label>Vehicle<input value={f.vehicle} placeholder="e.g. Truck 1, Trailer" onChange={set("vehicle")} /></label>
          <label>Driver's truck (optional)<select value={f.driverId} onChange={set("driverId")}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Vendor<input value={f.vendor} placeholder="e.g. Discount Tire" onChange={set("vendor")} /></label>
          <label>Amount ($)<input value={f.amount} inputMode="decimal" required onChange={set("amount")} /></label>
          <label className="span2">What was it<input value={f.description} placeholder="e.g. 2 steer tires" onChange={set("description")} /></label>
          {!cost && <label className="span2">Receipt (optional)<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
          {cost?.photoUrl && <a className="span2" href={cost.photoUrl} target="_blank" rel="noreferrer">View receipt</a>}
        </div>
        <ErrorText error={save.error || del.error} />
        <div className="row">
          {cost ? <button type="button" className="btn small danger" onClick={() => confirm("Delete this cost?") && del.mutate()}>Delete</button> : <span />}
          <span className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn pri" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
