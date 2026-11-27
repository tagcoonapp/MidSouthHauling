import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FuelReceipt, Me } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText } from "../components/bits";
import { compressImage, fmtDay } from "../util";
import { DriverShell } from "./DriverHome";

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const todayLocal = () => new Date().toLocaleDateString("en-CA");

/** Drivers photograph fuel receipts and type gallons and the odometer. Claude reads the amount. */
export function DriverFuel({ me }: { me: Me }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["my-fuel"], queryFn: () => api.get<FuelReceipt[]>("/fuel/mine"), refetchInterval: (q) => (q.state.data?.some((r) => r.aiStatus === "reading") ? 4000 : false) });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [f, setF] = useState({ date: todayLocal(), gallons: "", odometer: "", amount: "" });
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (file) fd.append("file", await compressImage(file));
      fd.append("date", f.date);
      fd.append("gallons", f.gallons);
      fd.append("odometer", f.odometer);
      if (f.amount) fd.append("amount", f.amount);
      return api.post<FuelReceipt>("/fuel", fd);
    },
    onSuccess: () => {
      setFile(null); setPreview(null); setF({ date: todayLocal(), gallons: "", odometer: "", amount: "" }); setDone(true);
      qc.invalidateQueries({ queryKey: ["my-fuel"] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/fuel/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-fuel"] }),
  });

  const pick = (fl: File | undefined) => {
    if (!fl) return;
    setFile(fl); setDone(false);
    setPreview(URL.createObjectURL(fl));
  };
  const ready = !!file && f.gallons !== "" && f.odometer !== "";
  const lastOdo = list.data?.find((r) => r.odometer)?.odometer ?? null;

  return (
    <DriverShell me={me}>
      <div className="card pad" style={{ margin: "14px" }}>
        <h3 style={{ marginTop: 0 }}>⛽ Add a fuel receipt</h3>
        <form className="form" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          {preview ? (
            <button type="button" className="receipt-preview" onClick={() => input.current?.click()} aria-label="Retake photo">
              <img src={preview} alt="Receipt" />
              <span className="small">Tap to retake</span>
            </button>
          ) : (
            <button type="button" className="btn big-btn" onClick={() => input.current?.click()}>📷 Take photo of receipt</button>
          )}
          <div className="grid2">
            <label>Gallons<input value={f.gallons} inputMode="decimal" placeholder="e.g. 42.5" onChange={(e) => setF({ ...f, gallons: e.target.value.replace(/[^\d.]/g, "") })} required /></label>
            <label>Odometer<input value={f.odometer} inputMode="numeric" placeholder={lastOdo ? `last ${lastOdo.toLocaleString()}` : "e.g. 182340"} onChange={(e) => setF({ ...f, odometer: e.target.value.replace(/\D/g, "") })} required /></label>
            <label>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label>Total ($) <span className="muted small">optional</span><input value={f.amount} inputMode="decimal" placeholder="read from photo" onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></label>
          </div>
          {lastOdo !== null && f.odometer !== "" && Number(f.odometer) < lastOdo && (
            <div className="warn-box small">That's lower than your last reading ({lastOdo.toLocaleString()}). Double-check the odometer.</div>
          )}
          <ErrorText error={send.error} />
          <button className="btn pri big-btn" disabled={!ready || send.isPending}>{send.isPending ? "Sending…" : "Send receipt"}</button>
          {done && <div className="ok-box small">✓ Receipt sent. Thanks!</div>}
        </form>
      </div>

      <h3 className="day-head">My receipts <span className="muted">(last 90 days)</span></h3>
      {list.data?.length === 0 && <div className="card empty-state">No receipts yet.</div>}
      <ErrorText error={del.error} />
      {(list.data ?? []).map((r) => (
        <div key={r.id} className="card job-card fuel-card">
          <div className="row">
            <div>
              <b>{fmtDay(r.date, { weekday: "short", month: "short", day: "numeric" })}</b>
              <div className="muted small">{r.station || (r.aiStatus === "reading" ? "Reading receipt…" : "")}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <b>{r.amountCents !== null ? usd(r.amountCents) : r.aiStatus === "reading" ? "…" : "—"}</b>
              <div className="muted small">{r.gallons ?? "—"} gal · {r.odometer?.toLocaleString() ?? "—"} mi</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {r.photoUrl ? <a className="small" href={r.photoUrl} target="_blank" rel="noreferrer">View photo</a> : <span />}
            {Date.now() - Date.parse(r.createdAt) < 7 * 86_400_000 && (
              <button className="link-btn small danger-text" onClick={() => confirm("Delete this receipt?") && del.mutate(r.id)}>Delete</button>
            )}
          </div>
        </div>
      ))}
    </DriverShell>
  );
}
