import { useRef, useState, type ReactNode } from "react";
import { MAX_PHOTOS_PER_JOB, type CallStatus, type JobType, type Photo } from "../../../shared/domain";
import { callLabel, compressImage, jobTypeLabel } from "../util";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="logo" style={{ color: light ? "#fff" : "var(--ink)" }}>
      <img src="/icon.svg" alt="" width={28} height={28} />
      <span>
        Midsouth <b>Hauling</b>
      </span>
    </span>
  );
}

export function JobTypePill({ type }: { type: JobType }) {
  return <span className={`pill jt-${type}`}>{jobTypeLabel(type)}</span>;
}

export function CallPill({ status, attempts }: { status: CallStatus; attempts?: number }) {
  return (
    <span className={`pill cs-${status}`}>
      <i className="dot" />
      {callLabel(status)}
      {status === "attempted" && attempts && attempts > 1 ? ` ×${attempts}` : ""}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const map: Record<string, [string, string]> = {
    pipeline: ["Pipeline", "st-pipeline"],
    scheduled: ["Scheduled", "st-scheduled"],
    submitted: ["Submitted", "st-submitted"],
    approved: ["Approved", "st-approved"],
  };
  const [label, cls] = map[stage] ?? [stage, ""];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal card${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="row modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Up to four photos with add/delete. Used by drivers on the job screen and by the scheduler in the job drawer. */
export function PhotoGrid({
  photos,
  editable,
  onUpload,
  onDelete,
}: {
  photos: Photo[];
  editable: boolean;
  onUpload?: (f: File) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [view, setView] = useState<string | null>(null);
  const slotsLeft = MAX_PHOTOS_PER_JOB - photos.length;

  async function pick(files: FileList | null) {
    if (!files || !onUpload) return;
    setErr(null);
    setBusy(true);
    try {
      for (const f of [...files].slice(0, slotsLeft)) await onUpload(await compressImage(f));
      if (files.length > slotsLeft) setErr(new Error(`Only ${MAX_PHOTOS_PER_JOB} photos per job. Extra photos were skipped.`));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo">
            <img src={p.url} alt="Job photo" loading="lazy" onClick={() => setView(p.url)} />
            {editable && onDelete && (
              <button
                className="photo-del"
                aria-label="Delete photo"
                onClick={async () => {
                  if (!confirm("Delete this photo?")) return;
                  try { await onDelete(p.id); } catch (e) { setErr(e); }
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {editable && slotsLeft > 0 && (
          <button className="photo add" onClick={() => input.current?.click()} disabled={busy}>
            <span className="plus">{busy ? "…" : "＋"}</span>
            {busy ? "Uploading" : "Add photo"}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
      <ErrorText error={err} />
      {view && (
        <div className="lightbox" onClick={() => setView(null)}>
          <img src={view} alt="Job photo full size" />
        </div>
      )}
    </div>
  );
}
