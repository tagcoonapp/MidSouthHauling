import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OfficeJob } from "../../../shared/domain";
import { api } from "../api";
import { JobTypePill } from "../components/bits";
import { useMe } from "../App";
import { JobDrawer } from "./JobDrawer";
import { useTeam } from "./Board";
import { fmtDay } from "../util";

/** Approved jobs. Owners and the scheduler. Expense amounts and totals arrive with the accounting part. */
export function Completed() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ["completed"], queryFn: () => api.get<OfficeJob[]>("/completed") });
  const drivers = (useTeam().data ?? []).filter((u) => u.role === "driver");
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data) return <div className="muted">Loading…</div>;
  return (
    <div>
      <div className="top"><div><h1>Completed</h1><div className="muted">Approved jobs, newest first.</div></div></div>
      {q.data.length === 0 ? (
        <div className="card empty-state">No approved jobs yet.</div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Serial #</th><th>Driver</th><th>Photos</th></tr></thead>
            <tbody>
              {q.data.map((j) => (
                <tr key={j.id} onClick={() => setOpen(j.id)} className="clickable">
                  <td>{j.scheduledDate ? fmtDay(j.scheduledDate, { month: "numeric", day: "numeric" }) : "—"}</td>
                  <td><b>{j.customerName}</b></td>
                  <td><JobTypePill type={j.jobType} /></td>
                  <td>{j.serial}</td>
                  <td><i className="dot" style={{ background: j.driverColor ?? "#999" }} /> {j.driverName}</td>
                  <td>{j.photos.length} 📷</td>
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
