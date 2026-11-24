import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { DriverJob, Me } from "../../../shared/domain";
import { api } from "../api";
import { CallPill, JobTypePill, StagePill } from "../components/bits";
import { addDays, fmtDateTime, fmtDay, mapsUrl, weekStart, addressLine } from "../util";

type Tab = "today" | "week" | "log";

export function DriverShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const qc = useQueryClient();
  return (
    <div className="phone-app">
      <header className="ptop">
        <div className="row">
          <div>
            <div className="muted-light small">Midsouth Hauling</div>
            <h1>{me.name}</h1>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <Link to="/account" className="chip-light">Account</Link>
            <button
              className="chip-light"
              onClick={async () => { await api.post("/logout"); qc.clear(); location.href = "/"; }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <nav className="tabs">
        <NavLink to="/" end>Today</NavLink>
        <NavLink to="/week">This week</NavLink>
        <NavLink to="/log">My log</NavLink>
      </nav>
      {children}
    </div>
  );
}

function JobCard({ job, me }: { job: DriverJob; me: Me }) {
  const navigate = useNavigate();
  const open = () => navigate(`/job/${job.id}`);
  return (
    <div role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} className="card job-card" style={{ borderLeftColor: me.color }}>
      <div className="row">
        <div className="job-name">{job.customerName}</div>
        {job.stage === "scheduled" ? <CallPill status={job.callStatus} /> : <StagePill stage={job.stage} />}
      </div>
      {(job.address || job.city) ? (
        <a className="map-link big" href={mapsUrl(job.address, job.city)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          📍 {addressLine(job.address, job.city)}
        </a>
      ) : <div className="muted small">No address</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <JobTypePill type={job.jobType} />
        <span className="muted small">{[job.building, job.scheduledTime].filter(Boolean).join(" · ")}</span>
      </div>
      {job.collectCents !== null && job.stage === "scheduled" && (
        <div className="collect-pill">💵 Collect {(job.collectCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</div>
      )}
    </div>
  );
}

export function DriverHome({ me, tab = "today" }: { me: Me; tab?: Tab }) {
  return (
    <DriverShell me={me}>
      {tab === "log" ? <LogTab /> : <ScheduleTab me={me} week={tab === "week"} />}
    </DriverShell>
  );
}

function ScheduleTab({ me, week }: { me: Me; week: boolean }) {
  const today = useQuery({ queryKey: ["my-today"], queryFn: () => api.get<{ today: string }>("/my/schedule"), staleTime: 300_000 });
  const base = today.data?.today;
  const from = base ? (week ? weekStart(base) : base) : null;
  const to = from ? (week ? addDays(from, 6) : from) : null;
  const q = useQuery({
    queryKey: ["my-schedule", from, to],
    queryFn: () => api.get<{ jobs: DriverJob[] }>(`/my/schedule?from=${from}&to=${to}`),
    enabled: !!from,
    refetchInterval: 120_000,
  });

  if (!q.data) return <div className="pad muted">Loading…</div>;
  const jobs = q.data.jobs;
  const done = jobs.filter((j) => j.stage !== "scheduled").length;

  if (!week) {
    return (
      <div>
        <div className="pad-x muted" style={{ paddingTop: 12 }}>
          <b className="ink">{fmtDay(from!, { weekday: "long", month: "long", day: "numeric" })}</b> · {jobs.length} stop{jobs.length === 1 ? "" : "s"}
        </div>
        {jobs.length === 0 && <div className="card empty-state">No jobs today.</div>}
        {jobs.map((j) => <JobCard key={j.id} job={j} me={me} />)}
        {jobs.length > 0 && (
          <div className="card pad" style={{ margin: "16px 14px" }}>
            <div className="row">
              <div><b>Done today</b><div className="muted small">{done} of {jobs.length} submitted</div></div>
              <div className="bar" style={{ width: 120 }}><i style={{ width: `${(done / jobs.length) * 100}%` }} /></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(from!, i));
  return (
    <div>
      {days.map((d) => {
        const dayJobs = jobs.filter((j) => j.scheduledDate === d);
        if (!dayJobs.length) return null;
        return (
          <section key={d}>
            <h3 className="day-head">{fmtDay(d, { weekday: "long", month: "short", day: "numeric" })}{d === base ? " · Today" : ""}</h3>
            {dayJobs.map((j) => <JobCard key={j.id} job={j} me={me} />)}
          </section>
        );
      })}
      {jobs.length === 0 && <div className="card empty-state">Nothing scheduled this week yet.</div>}
    </div>
  );
}

function LogTab() {
  const q = useQuery({ queryKey: ["my-log"], queryFn: () => api.get<{ today: string; jobs: DriverJob[] }>("/my/log") });
  if (!q.data) return <div className="pad muted">Loading…</div>;
  const { today, jobs } = q.data;
  const wk = weekStart(today);
  const month = today.slice(0, 7);
  const localDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA");
  const groups: [string, DriverJob[]][] = [
    ["This week", jobs.filter((j) => localDate(j.submittedAt!) >= wk)],
    ["This month", jobs.filter((j) => localDate(j.submittedAt!) < wk && localDate(j.submittedAt!).startsWith(month))],
    ["Older", jobs.filter((j) => localDate(j.submittedAt!) < wk && !localDate(j.submittedAt!).startsWith(month))],
  ];
  return (
    <div>
      {jobs.length === 0 && <div className="card empty-state">Jobs you submit show up here for 60 days.</div>}
      {groups.map(([label, list]) =>
        list.length ? (
          <section key={label}>
            <h3 className="day-head">{label} <span className="muted">({list.length})</span></h3>
            {list.map((j) => (
              <Link key={j.id} to={`/job/${j.id}`} className="card job-card log-card">
                <div className="row">
                  <div className="job-name">{j.customerName}</div>
                  <StagePill stage={j.stage} />
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <JobTypePill type={j.jobType} />
                  <span className="muted small">{fmtDateTime(j.submittedAt!)} · {j.photos.length} photo{j.photos.length === 1 ? "" : "s"}</span>
                </div>
              </Link>
            ))}
          </section>
        ) : null,
      )}
      <p className="muted small pad">Jobs older than 60 days drop off this list.</p>
    </div>
  );
}
