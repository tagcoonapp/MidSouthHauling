import { baseCustomerName, type DriverJob } from "../../../shared/domain";

/**
 * Saves a job's photos to the computer with clear names (e.g. Linda-Hargrove-1.jpg) so they can be attached
 * to the NetSuite expense report. Browsers can't hand files from one site to another, so this is the handoff.
 */
export function DownloadPhotos({ job, small }: { job: Pick<DriverJob, "customerName" | "photos">; small?: boolean }) {
  if (!job.photos.length) return null;
  const base = baseCustomerName(job.customerName).replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/\s+/g, "-") || "photo";
  const saveAll = async () => {
    for (const [i, p] of job.photos.entries()) {
      const a = document.createElement("a");
      a.href = `${p.url}?download=${encodeURIComponent(`${base}-${i + 1}`)}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 400)); // browsers drop rapid back-to-back downloads
    }
  };
  return (
    <button type="button" className={`btn${small ? " small" : ""}`} onClick={saveAll} title="Saves the photos to your Downloads folder to attach in NetSuite">
      ⬇ Download {job.photos.length} photo{job.photos.length === 1 ? "" : "s"}
    </button>
  );
}
