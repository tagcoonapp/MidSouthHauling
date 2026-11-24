import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfficeJob } from "../../../shared/domain";
import { api } from "../api";
import { JobTypePill } from "../components/bits";
import { useMe } from "../App";
import { JobDrawer } from "./JobDrawer";
import { useTeam } from "./Board";
import { fmtDay } from "../util";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Approved jobs and their expenses. Owners and the scheduler. */
export function Completed() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["completed"], queryFn: () => api.get<OfficeJob[]>("/completed") });
  const drivers = (useTeam().data ?? []).filter((u) => u.role === "driver");
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState<string>("");
  const entered = useMutation({
    mutationFn: (v: { id: string; entered: boolean }) => api.post(`/jobs/${v.id}/entered`, { entered: v.entered }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["completed"] }),
  });
  if (!q.data) return <div className="muted">Loading…</div>;

  const monthOf = (j: OfficeJob) => (j.expenses?.[0]?.approvedAt ?? j.createdAt).slice(0, 7);
  const months = [...new Set(q.data.map(monthOf))].sort().reverse();
  const jobs = month ? q.data.filter((j) => monthOf(j) === month) : q.data;
  const sum = (j: OfficeJob) => (j.expenses ?? []).reduce((t, e) => t + e.amountCents, 0);
  const total = jobs.reduce((t, j) => t + sum(j), 0);
  const fuel = jobs.reduce((t, j) => t + (j.expenses ?? []).filter((e) => e.kind === "fuel").reduce((s, e) => s + e.amountCents, 0), 0);
  const notEntered = jobs.filter((j) => j.expenses?.length && !j.expenses[0]!.enteredAt).length;
  const canMark = me.permissions.approveExpenses;

  return (
    <div>
      <div className="top">
        <div><h1>Completed</h1><div className="muted">Approved jobs and their expenses, newest first.</div></div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 180 }}>
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{new Date(m + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
        </select>
      </div>
      <div className="kpis">
        <div className="card kpi"><div className="l">Expensed</div><div className="v">{usd(total)}</div></div>
        <div className="card kpi"><div className="l">Jobs</div><div className="v">{jobs.length}</div></div>
        <div className="card kpi"><div className="l">Repo fuel charges</div><div className="v">{usd(fuel)}</div></div>
        {canMark && <div className="card kpi"><div className="l">Not yet in NetSuite</div><div className="v">{notEntered}</div></div>}
      </div>
      {jobs.length === 0 ? (
        <div className="card empty-state">No approved jobs yet.</div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Job date</th><th>Customer</th><th>Type</th><th>Serial #</th><th>Driver</th><th>Collected</th><th>Expense</th>{canMark && <th>In NetSuite</th>}</tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => setOpen(j.id)}>
                  <td>{j.scheduledDate ? fmtDay(j.scheduledDate, { month: "numeric", day: "numeric" }) : "—"}</td>
                  <td><b>{j.customerName}</b></td>
                  <td><JobTypePill type={j.jobType} /></td>
                  <td>{j.serial}</td>
                  <td><i className="dot" style={{ background: j.driverColor ?? "#999" }} /> {j.driverName}</td>
                  <td>{j.collectedCents ? <>{usd(j.collectedCents)}<div className="muted small">{j.collectedMethod ?? ""}</div></> : <span className="muted">—</span>}</td>
                  <td>
                    {j.jobType === "private_move" ? <span className="muted">Not expensed</span> : <b>{usd(sum(j))}</b>}
                    {(j.expenses?.length ?? 0) > 1 && <div className="muted small">{j.expenses!.map((e) => (e.kind === "fuel" ? `fuel ${usd(e.amountCents)}` : usd(e.amountCents))).join(" + ")}</div>}
                  </td>
                  {canMark && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <label className="checkbox small">
                        <input type="checkbox" checked={!!j.expenses?.[0]?.enteredAt} onChange={(e) => entered.mutate({ id: j.id, entered: e.target.checked })} />
                        {j.expenses?.[0]?.enteredAt ? "Entered" : "Not yet"}
                      </label>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <JobDrawer id={open} me={me} drivers={drivers} onClose={() => setOpen(null)} />}
    </div>
  );
}
