import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { RequireAuth, RequireProfile, RequireStaff } from "./auth/guards";
import { useAuth } from "./auth/AuthProvider";
import { Shell, Spinner } from "./components/Shell";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import Welcome from "./pages/Welcome";
import Notifications from "./pages/Notifications";
import JobDetail from "./pages/JobDetail";
import JobList from "./pages/JobList";
import CustomerHome from "./pages/customer/Home";
import RequestNew from "./pages/customer/RequestNew";
import Requests from "./pages/customer/Requests";
import RequestDetail from "./pages/customer/RequestDetail";
import ProviderProfile from "./pages/customer/ProviderProfile";
import ProviderDashboard from "./pages/provider/Dashboard";
import Register from "./pages/provider/Register";
import ProviderRequests from "./pages/provider/Requests";
import RequestOffer from "./pages/provider/RequestOffer";
import AdminQueue from "./pages/admin/Queue";
import CaseDetail from "./pages/admin/CaseDetail";
import Disputes from "./pages/admin/Disputes";
import Account from "./pages/Account";
import Legal from "./pages/Legal";
import PaymentReturn from "./pages/PaymentReturn";
import ProviderEarnings from "./pages/provider/Earnings";
import Finance from "./pages/admin/Finance";
import AdminProviders from "./pages/admin/Providers";
import AdminServices from "./pages/admin/Services";

function HomeRedirect() {
  const { profile, isStaff, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!profile?.full_name) return <Navigate to="/welcome" replace />;
  return <Navigate to={isStaff ? "/admin" : "/customer"} replace />;
}
function WithShell() { return <Shell><Outlet /></Shell>; }

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/legal/:doc" element={<Legal />} />
      <Route element={<RequireAuth />}>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/app" element={<HomeRedirect />} />
        <Route element={<RequireProfile />}>
          <Route element={<WithShell />}>
            <Route path="/customer" element={<CustomerHome />} />
            <Route path="/customer/new/:slug" element={<RequestNew />} />
            <Route path="/customer/requests" element={<Requests />} />
            <Route path="/customer/requests/:id" element={<RequestDetail />} />
            <Route path="/customer/providers/:id" element={<ProviderProfile />} />
            <Route path="/customer/jobs" element={<JobList role="customer" />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/account" element={<Account />} />
            <Route path="/payments/return" element={<PaymentReturn />} />
            <Route path="/provider/earnings" element={<ProviderEarnings />} />
            <Route path="/provider" element={<ProviderDashboard />} />
            <Route path="/provider/register" element={<Register />} />
            <Route path="/provider/requests" element={<ProviderRequests />} />
            <Route path="/provider/requests/:id" element={<RequestOffer />} />
            <Route path="/provider/jobs" element={<JobList role="provider" />} />
            <Route element={<RequireStaff />}>
              <Route path="/admin" element={<AdminQueue />} />
              <Route path="/admin/cases/:id" element={<CaseDetail />} />
              <Route path="/admin/disputes" element={<Disputes />} />
              <Route path="/admin/services" element={<AdminServices />} />
              <Route path="/admin/finance" element={<Finance />} />
              <Route path="/admin/providers" element={<AdminProviders />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
