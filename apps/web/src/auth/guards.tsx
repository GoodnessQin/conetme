import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { Spinner } from "../components/Shell";

/** Signed-in users only. */
export function RequireAuth() {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/sign-in" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

/** Signed-in users who have entered their full name. */
export function RequireProfile() {
  const { profile, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!profile?.full_name) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

/** Staff roles only. The database enforces this too; this only hides the screens. */
export function RequireStaff() {
  const { isStaff, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!isStaff) return <Navigate to="/app" replace />;
  return <Outlet />;
}
