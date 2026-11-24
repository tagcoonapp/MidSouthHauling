import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DRIVER_COLORS, ROLES, ROLE_LABELS, type Me, type Role, type TeamMember } from "../../../shared/domain";
import { api } from "../api";
import { ErrorText, Modal } from "../components/bits";
import { useTeam } from "./Board";

const ROLE_HELP: Record<Role, string> = {
  driver: "Sees only their own schedule. Uploads photos and notes. Never sees money.",
  owner: "Sees the calendar, pipeline and completed jobs, and can edit the calendar. Doesn't see pending expenses.",
  scheduler: "Sees and edits everything, approves expenses, manages the team.",
};

export function Team({ me }: { me: Me }) {
  const qc = useQueryClient();
  const team = useTeam();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const toggle = useMutation({
    mutationFn: (u: TeamMember) => api.patch(`/team/${u.id}`, { active: !u.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }),
  });
  return (
    <div>
      <div className="top">
        <div><h1>Team</h1><div className="muted">Add drivers and owners and give them a username and password.</div></div>
        <button className="btn pri" onClick={() => setAdding(true)}>＋ Add person</button>
      </div>
      <ErrorText error={toggle.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Color</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(team.data ?? []).map((u) => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                <td><b>{u.name}</b></td>
                <td>{u.username}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td><i className="dot big" style={{ background: u.color }} /></td>
                <td>{u.active ? "Active" : "Turned off"}</td>
                <td className="row-end">
                  <button className="btn small" onClick={() => setEditing(u)}>Edit</button>
                  {u.id !== me.id && <button className="btn small" onClick={() => toggle.mutate(u)}>{u.active ? "Turn off" : "Turn on"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <PersonModal me={me} onClose={() => setAdding(false)} />}
      {editing && <PersonModal me={me} person={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonModal({ me, person, onClose }: { me: Me; person?: TeamMember; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(person?.name ?? "");
  const [username, setUsername] = useState(person?.username ?? "");
  const [role, setRole] = useState<Role>(person?.role ?? "driver");
  const [color, setColor] = useState(person?.color ?? "");
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      person
        ? api.patch(`/team/${person.id}`, { name, role, color: color || undefined, password: password || undefined })
        : api.post("/team", { name, username, role, color: color || undefined, password }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); onClose(); },
  });
  return (
    <Modal title={person ? `Edit ${person.name}` : "Add a person"} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Username<input value={username} disabled={!!person} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={person?.id === me.id}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <p className="muted small">{ROLE_HELP[role]}</p>
        <label>Calendar color</label>
        <div className="row-wrap">
          {DRIVER_COLORS.map((c) => (
            <button type="button" key={c} className={`swatch${color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
        <label>{person ? "New password (leave blank to keep)" : "Password (8+ characters)"}
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required={!person} minLength={person ? undefined : 8} autoComplete="off" />
        </label>
        {!person && <p className="muted small">Give them this username and password. They can change the password later under My account.</p>}
        <ErrorText error={save.error} />
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
