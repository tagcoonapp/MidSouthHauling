import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { ROLE_LABELS, type Me, type OfficeJob } from "../../../shared/domain";
import { api } from "../api";
import { Logo } from "./bits";
import { useSchedulingNotes } from "../pages/SchedulingNotes";

export function OfficeLayout({ me }: { me: Me }) {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["pending"],
    queryFn: () => api.get<OfficeJob[]>("/pending"),
    enabled: me.permissions.viewPendingExpenses,
    refetchInterval: 60_000,
  });

  const notes = useSchedulingNotes(me.permissions.editSchedule);

  async function logout() {
    await api.post("/logout");
    qc.clear();
    location.href = "/";
  }

  return (
    <div className="office">
      <aside className="side">
        <Logo light />
        <nav>
          <NavLink to="/" end>Schedule</NavLink>
          {me.permissions.editSchedule && (
            <NavLink to="/notes">Sched. notes {notes.data?.length ? <span className="badge soft">{notes.data.length}</span> : null}</NavLink>
          )}
          {me.permissions.viewPendingExpenses && (
            <NavLink to="/pending">
              Pending {pending.data?.length ? <span className="badge">{pending.data.length}</span> : null}
            </NavLink>
          )}
          <NavLink to="/completed">Completed</NavLink>
          {me.permissions.viewFinancial && <NavLink to="/accounting">Accounting</NavLink>}
          {me.permissions.approveExpenses && <NavLink to="/pricing">Pricing</NavLink>}
          {me.permissions.manageTeam && <NavLink to="/team">Team</NavLink>}
          <NavLink to="/account">My account</NavLink>
        </nav>
        <div className="who">
          <div>{me.name}</div>
          <div className="muted-light">{ROLE_LABELS[me.role]}</div>
          <button className="link-light" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
