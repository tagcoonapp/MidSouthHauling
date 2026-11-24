import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ROLE_LABELS, type Me } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText } from "../components/bits";

export function Account({ me }: { me: Me }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => api.post("/me/password", { current, next }),
    onSuccess: () => { setCurrent(""); setNext(""); },
  });
  return (
    <div className={me.role === "driver" ? "pad" : ""} style={{ maxWidth: 440 }}>
      {me.role === "driver" && <Link to="/" className="small">‹ Back</Link>}
      <h1 style={{ marginTop: 8 }}>My account</h1>
      <p className="muted">{me.name} · {me.username} · {ROLE_LABELS[me.role]}</p>
      <form className="form card pad" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <h2>Change password</h2>
        <label>Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>New password (8+ characters)<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></label>
        <ErrorText error={change.error} />
        {change.isSuccess && <div className="ok-box">Password changed.</div>}
        <button className="btn pri" disabled={change.isPending}>Change password</button>
      </form>
    </div>
  );
}
