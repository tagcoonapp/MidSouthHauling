import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Me } from "../../shared/domain";
import { api, ApiError } from "./api";
import { Login, Setup } from "./pages/Auth";
import { DriverHome } from "./pages/DriverHome";
import { DriverJobPage } from "./pages/DriverJob";
import { OfficeLayout } from "./components/OfficeLayout";
import { Board } from "./pages/Board";
import { Pending } from "./pages/Pending";
import { Completed } from "./pages/Completed";
import { Team } from "./pages/Team";
import { Account } from "./pages/Account";
import { Pricing } from "./pages/Pricing";
import { ImportPage } from "./pages/Import";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function App() {
  const me = useMe();
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: () => api.get<{ needsSetup: boolean }>("/setup"),
    enabled: me.data === null,
  });

  if (me.isLoading || (me.data === null && setup.isLoading)) return <div className="center-screen muted">Loading…</div>;
  if (me.isError) return <div className="center-screen">Can't reach the server. Check your connection and refresh.</div>;
  if (!me.data) return setup.data?.needsSetup ? <Setup /> : <Login />;

  const user = me.data;
  if (user.role === "driver") {
    return (
      <Routes>
        <Route path="/" element={<DriverHome me={user} />} />
        <Route path="/log" element={<DriverHome me={user} tab="log" />} />
        <Route path="/week" element={<DriverHome me={user} tab="week" />} />
        <Route path="/job/:id" element={<DriverJobPage />} />
        <Route path="/account" element={<Account me={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<OfficeLayout me={user} />}>
        <Route path="/" element={<Board me={user} />} />
        {user.permissions.viewPendingExpenses && <Route path="/pending" element={<Pending />} />}
        <Route path="/completed" element={<Completed />} />
        {user.permissions.editSchedule && <Route path="/import" element={<ImportPage />} />}
        {user.permissions.approveExpenses && <Route path="/pricing" element={<Pricing />} />}
        {user.permissions.manageTeam && <Route path="/team" element={<Team me={user} />} />}
        {user.permissions.submitJobs && <Route path="/job/:id" element={<DriverJobPage />} />}
        <Route path="/account" element={<Account me={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
