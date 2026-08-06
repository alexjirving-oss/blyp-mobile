import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";

// Lazy-load authenticated surfaces so login boot does not evaluate heavy
// chart/lodash chunks (some of which currently break under Vite/Rolldown CJS interop).
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const People = lazy(() => import("./pages/People"));
const PersonDetail = lazy(() => import("./pages/PersonDetail"));
const Economy = lazy(() => import("./pages/Economy"));
const Ops = lazy(() => import("./pages/Ops"));
const Content = lazy(() => import("./pages/Content"));
const Live = lazy(() => import("./pages/Live"));
const Safety = lazy(() => import("./pages/Safety"));
const Access = lazy(() => import("./pages/Access"));
const Growth = lazy(() => import("./pages/Growth"));
const Comms = lazy(() => import("./pages/Comms"));
const Config = lazy(() => import("./pages/Config"));
const Teams = lazy(() => import("./pages/Teams"));
const Workbook = lazy(() => import("./pages/Workbook"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{children}</Suspense>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<PageSuspense><CommandCenter /></PageSuspense>} />
            <Route path="/people" element={<PageSuspense><People /></PageSuspense>} />
            <Route path="/people/:userId" element={<PageSuspense><PersonDetail /></PageSuspense>} />
            <Route path="/content" element={<PageSuspense><Content /></PageSuspense>} />
            <Route path="/live" element={<PageSuspense><Live /></PageSuspense>} />
            <Route path="/teams" element={<PageSuspense><Teams /></PageSuspense>} />
            <Route path="/safety" element={<PageSuspense><Safety /></PageSuspense>} />
            <Route path="/economy" element={<PageSuspense><Economy /></PageSuspense>} />
            <Route path="/growth" element={<PageSuspense><Growth /></PageSuspense>} />
            <Route path="/comms" element={<PageSuspense><Comms /></PageSuspense>} />
            <Route path="/config" element={<PageSuspense><Config /></PageSuspense>} />
            <Route path="/ops" element={<PageSuspense><Ops /></PageSuspense>} />
            <Route path="/access" element={<PageSuspense><Access /></PageSuspense>} />
            <Route
              path="/workbook"
              element={
                <Suspense fallback={<Spinner label="Loading product workbook…" />}>
                  <Workbook />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
