import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ErrorText, Logo } from "../components/bits";

function AuthShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card card">
        <Logo />
        <h1 style={{ marginTop: 18 }}>{title}</h1>
        {sub && <p className="muted" style={{ marginTop: 4 }}>{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/login", { username, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="form">
        <label>Username<input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorText error={err} />
        <button className="btn pri big" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small">Forgot your password? Ask the scheduler to reset it.</p>
      </form>
    </AuthShell>
  );
}

export function Setup() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/setup", { name, username, password });
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome! Create the scheduler account" sub="This is the main account. It can add drivers and owners and sees everything.">
      <form onSubmit={submit} className="form">
        <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Username<input autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>Password (8+ characters)<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></label>
        <ErrorText error={err} />
        <button className="btn pri big" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
    </AuthShell>
  );
}
