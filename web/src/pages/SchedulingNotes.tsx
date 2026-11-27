import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { baseCustomerName, type OfficeJob, type SchedulingNote } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText } from "../components/bits";
import { fmtDateTime, fmtDay } from "../util";

export function useSchedulingNotes(enabled = true) {
  return useQuery({ queryKey: ["scheduling-notes"], queryFn: () => api.get<SchedulingNote[]>("/scheduling-notes"), enabled, staleTime: 30_000 });
}

/** Yellow box listing a customer's scheduling notes (shown when scheduling them). */
export function NotesWarning({ notes }: { notes: SchedulingNote[] }) {
  if (!notes.length) return null;
  return (
    <div className="sched-warn">
      <b>🗒 Scheduling note{notes.length > 1 ? "s" : ""} for this customer</b>
      {notes.map((n) => (
        <div key={n.id} className="sched-warn-item">
          “{n.text}”
          <div className="muted small">{n.author} · {fmtDateTime(n.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

/** Add a note for a customer; pick them from the job list (or type a name). */
export function AddSchedulingNote({ jobs, fixedJob, onAdded }: { jobs: OfficeJob[]; fixedJob?: OfficeJob; onAdded?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const match = fixedJob ?? jobs.find((j) => j.customerName.toLowerCase() === name.trim().toLowerCase());
  const add = useMutation({
    mutationFn: () => api.post("/scheduling-notes", { jobId: match?.id ?? null, customerName: fixedJob ? fixedJob.customerName : name, text }),
    onSuccess: () => { setName(""); setText(""); qc.invalidateQueries({ queryKey: ["scheduling-notes"] }); onAdded?.(); },
  });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      {!fixedJob && (
        <label>Customer
          <input list="sched-note-jobs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Start typing a name from the job list" required />
          <datalist id="sched-note-jobs">{jobs.map((j) => <option key={j.id} value={j.customerName}>{j.stage === "pipeline" ? "Pipeline" : j.scheduledDate ? fmtDay(j.scheduledDate) : ""}</option>)}</datalist>
          {name.trim() && <span className="muted small">{match ? "✓ Linked to this job" : "Not on the job list. The note will match any job with this name."}</span>}
        </label>
      )}
      <label>Note
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Customer won't be ready for delivery until the 12th" required />
      </label>
      <ErrorText error={add.error} />
      <div className="row-end"><button className="btn pri small" disabled={add.isPending || !text.trim() || (!fixedJob && !name.trim())}>Add note</button></div>
    </form>
  );
}

/** Side tab: office notes about scheduling customers. Drivers never see these. */
export function SchedulingNotes() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const notes = useQuery({ queryKey: ["scheduling-notes", showDone], queryFn: () => api.get<SchedulingNote[]>(`/scheduling-notes${showDone ? "?done=1" : ""}`) });
  const board = useQuery({ queryKey: ["board-today"], queryFn: () => api.get<{ pipeline: OfficeJob[]; scheduled: OfficeJob[] }>("/jobs/board"), staleTime: 300_000 });
  const jobs = [...(board.data?.pipeline ?? []), ...(board.data?.scheduled ?? []).filter((j) => j.stage === "scheduled")];
  const [search, setSearch] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["scheduling-notes"] });
  const done = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api.patch(`/scheduling-notes/${v.id}`, { done: v.done }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/scheduling-notes/${id}`), onSuccess: refresh });
  const q = search.trim().toLowerCase();
  const list = (notes.data ?? []).filter((n) => !q || n.customerName.toLowerCase().includes(q) || n.text.toLowerCase().includes(q));

  return (
    <div>
      <div className="top">
        <div><h1>Scheduling notes</h1><div className="muted">Office notes about a customer. You'll see them when you drag that customer onto the calendar. Drivers never see these.</div></div>
      </div>
      <div className="sched-layout">
        <div className="card pad">
          <h2 style={{ marginTop: 0 }}>New note</h2>
          <AddSchedulingNote jobs={jobs} />
        </div>
        <div>
          <div className="row" style={{ marginBottom: 10, gap: 10 }}>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or note" style={{ maxWidth: 320 }} />
            <label className="checkbox small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done (last 60 days)</label>
          </div>
          <ErrorText error={done.error || del.error} />
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Note</th><th>By</th><th>Job</th><th>Done</th><th></th></tr></thead>
              <tbody>
                {list.map((n) => (
                  <tr key={n.id} style={{ opacity: n.doneAt ? 0.55 : 1 }}>
                    <td><b>{baseCustomerName(n.customerName)}</b>{n.customerName.includes("|") && <div className="muted small">{n.customerName.split("|")[1]!.trim()}</div>}</td>
                    <td style={{ maxWidth: 420 }}>{n.text}</td>
                    <td className="small">{n.author}<div className="muted">{fmtDateTime(n.createdAt)}</div></td>
                    <td className="small">{n.jobStage === "pipeline" ? "Pipeline" : n.jobDate ? fmtDay(n.jobDate) : n.jobStage ?? <span className="muted">by name</span>}</td>
                    <td><label className="checkbox small"><input type="checkbox" checked={!!n.doneAt} onChange={(e) => done.mutate({ id: n.id, done: e.target.checked })} />{n.doneAt ? n.doneBy ?? "Done" : ""}</label></td>
                    <td><button className="link-btn small danger-text" onClick={() => confirm("Delete this note?") && del.mutate(n.id)}>Delete</button></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="muted">{notes.isLoading ? "Loading…" : "No notes."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
