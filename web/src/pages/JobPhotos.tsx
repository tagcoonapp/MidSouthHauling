import { useMutation, useQuery } from "@tanstack/react-query";
import { useMe } from "../App";
import { Link, useParams } from "react-router-dom";
import { baseCustomerName, type OfficeJob } from "../../../shared/domain";
import { api } from "../api";
import { DownloadPhotos } from "../components/DownloadPhotos";
import { addressLine, fmtDay, jobTypeLabel } from "../util";

/**
 * One job's photos, full size and clearly labeled, so Claude in Chrome (or anyone) can find and grab them
 * when entering the expense report in NetSuite.
 */
export function JobPhotos() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["job", id], queryFn: () => api.get<OfficeJob>(`/jobs/${id}`) });
  const me = useMe().data;
  const mark = useMutation({ mutationFn: (entered: boolean) => api.post(`/jobs/${id}/entered`, { entered }), onSuccess: () => q.refetch() });
  if (q.isError) return <div>Job not found. <Link to="/completed">Back</Link></div>;
  if (!q.data) return <div className="muted">Loading…</div>;
  const j = q.data;
  const name = baseCustomerName(j.customerName);
  const file = name.replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/\s+/g, "-") || "photo";
  return (
    <div className="job-photos">
      <div className="top">
        <div>
          <h1>Photos for {name}</h1>
          <div className="muted">
            {jobTypeLabel(j.jobType)}{j.serial ? ` · SN ${j.serial}` : ""}{j.scheduledDate ? ` · ${fmtDay(j.scheduledDate)}` : ""}{j.address || j.city ? ` · ${addressLine(j.address, j.city)}` : ""}
          </div>
        </div>
        <div className="row-wrap">
          <DownloadPhotos job={j} />
          <Link className="btn" to="/completed">‹ Back</Link>
        </div>
      </div>
      {(j.expenses?.length ?? 0) > 0 && (
        <div className="card pad expense-box">
          <div className="row">
            <h2 style={{ margin: 0 }}>Expense line{j.expenses!.length > 1 ? "s" : ""} for NetSuite</h2>
            {me?.permissions.approveExpenses && (
              j.expenses![0]!.enteredAt
                ? <span className="row-wrap" style={{ gap: 8 }}><b className="ok-text">✓ Entered in NetSuite</b><button className="link-btn small" onClick={() => confirm("Unmark this job as entered in NetSuite?") && mark.mutate(false)}>Undo</button></span>
                : <button className="btn pri" disabled={mark.isPending} onClick={() => mark.mutate(true)}>Mark entered in NetSuite</button>
            )}
          </div>
          <table className="mt">
            <thead><tr><th>Memo</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {j.expenses!.map((e) => (
                <tr key={e.id}><td>{e.description}</td><td className="num"><b>{(e.amountCents / 100).toFixed(2)}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {j.photos.length === 0 && <div className="card empty-state">No photos on this job.</div>}
      {j.photos.map((p, i) => (
        <figure key={p.id} className="card photo-full" id={`photo-${i + 1}`}>
          <figcaption>
            <b>{name} – photo {i + 1} of {j.photos.length}</b>
            <span className="row-wrap">
              <a href={p.url} target="_blank" rel="noreferrer">Open image</a>
              <a href={`${p.url}?download=${encodeURIComponent(`${file}-${i + 1}`)}`}>Download</a>
            </span>
          </figcaption>
          <img src={p.url} alt={`${name} photo ${i + 1} of ${j.photos.length}`} />
        </figure>
      ))}
    </div>
  );
}
