import { useQuery } from "@tanstack/react-query";
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
