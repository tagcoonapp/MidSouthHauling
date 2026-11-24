import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { importInstructions, type ImportRow } from "../../../shared/import";
import { api } from "../api";
import { ErrorText, JobTypePill } from "../components/bits";
import { money, addressLine } from "../util";

type PreviewRow = ImportRow & { status: "new" | "exists" | "duplicate_in_list"; reason: string };
interface ImportResult { rows: PreviewRow[]; bad: { entry: string; reason: string }[]; newCount?: number; added?: number; skipped?: number }

export function copyImportInstructions(): Promise<void> {
  return navigator.clipboard?.writeText(importInstructions(location.origin)) ?? Promise.resolve();
}

/** Where Claude in Chrome (or you) pastes jobs read from NetSuite's In Progress list. */
export function ImportPage() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const preview = useMutation({ mutationFn: () => api.post<ImportResult>("/import", { text }) });
  const add = useMutation({
    mutationFn: () => api.post<ImportResult>("/import", { text, commit: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["board"] }); preview.reset(); },
  });
  const data = preview.data;

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="top">
        <div>
          <h1>Import from NetSuite</h1>
          <div className="muted">Adds the In Progress jobs that aren't on the site yet. Jobs already here are skipped.</div>
        </div>
        <Link to="/" className="btn">‹ Back to schedule</Link>
      </div>

      <section className="card pad steps">
        <ol>
          <li>
            <b>Copy the instructions for Claude in Chrome.</b>{" "}
            <button className="btn small pri" onClick={async () => { await copyImportInstructions(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? "✓ Copied" : "Copy instructions"}
            </button>
          </li>
          <li><b>Open your NetSuite tab</b> (signed in to Employee Center), open the <b>Claude in Chrome</b> side panel, and paste.</li>
          <li><b>Claude reads the In Progress jobs</b>, pastes them below, previews, and clicks Add. You can watch it work. It doesn't change anything in NetSuite.</li>
        </ol>
      </section>

      <section className="card pad" style={{ marginTop: 14 }}>
        <label className="sec-head" htmlFor="import-box" style={{ display: "block", marginTop: 0 }}>Jobs to import</label>
        <textarea
          id="import-box"
          rows={8}
          value={text}
          onChange={(e) => { setText(e.target.value); preview.reset(); add.reset(); }}
          placeholder={'Paste here: a JSON list from Claude, or one job per line:\nName | Address | City | Phone | Serial | Balance | Type'}
        />
        <div className="row-end mt">
          <button className="btn" disabled={!text.trim() || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? "Checking…" : "Preview"}</button>
        </div>
        <ErrorText error={preview.error || add.error} />
        {add.data && (
          <div className="ok-box mt">
            ✓ Added {add.data.added} job{add.data.added === 1 ? "" : "s"} to the pipeline{add.data.skipped ? `, skipped ${add.data.skipped} already on the site` : ""}.{" "}
            <Link to="/">See the pipeline</Link>
          </div>
        )}
      </section>

      {data && (
        <section className="card pad" style={{ marginTop: 14 }}>
          <div className="row">
            <h2>{data.rows.length} job{data.rows.length === 1 ? "" : "s"} found · {data.newCount} new</h2>
            <button className="btn pri" disabled={!data.newCount || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? "Adding…" : `Add ${data.newCount} new job${data.newCount === 1 ? "" : "s"}`}
            </button>
          </div>
          <div className="table-wrap mt">
            <table>
              <thead><tr><th></th><th>Customer</th><th>Address</th><th>Phone</th><th>Serial #</th><th>Balance</th><th>Type</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.status === "new" ? 1 : 0.5 }}>
                    <td>{r.status === "new" ? <span className="pill st-scheduled">New</span> : <span className="pill st-pipeline" title={r.reason}>{r.reason}</span>}</td>
                    <td><b>{r.customerName}</b></td>
                    <td>{addressLine(r.address, r.city) || <span className="muted">—</span>}</td>
                    <td>{r.phone || <span className="muted">—</span>}</td>
                    <td>{r.serial || <span className="pill cs-attempted">No serial</span>}</td>
                    <td>{r.balanceCents === null ? <span className="muted">—</span> : money(r.balanceCents)}</td>
                    <td><JobTypePill type={r.jobType} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.bad.length > 0 && <div className="check warn mt">⚠️ <div>{data.bad.length} entr{data.bad.length === 1 ? "y" : "ies"} couldn't be read: {data.bad.map((b) => b.reason).join("; ")}</div></div>}
        </section>
      )}
    </div>
  );
}
