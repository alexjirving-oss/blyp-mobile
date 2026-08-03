import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import CommandCenter from "./pages/CommandCenter";
import People from "./pages/People";
import PersonDetail from "./pages/PersonDetail";
import Economy from "./pages/Economy";
import Ops from "./pages/Ops";
import Content from "./pages/Content";
import Live from "./pages/Live";
import Safety from "./pages/Safety";
import Access from "./pages/Access";
import Growth from "./pages/Growth";
import Comms from "./pages/Comms";
import Config from "./pages/Config";
import Teams from "./pages/Teams";

const Workbook = lazy(() => import("./pages/Workbook"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
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
            <Route path="/" element={<CommandCenter />} />
            <Route path="/people" element={<People />} />
            <Route path="/people/:userId" element={<PersonDetail />} />
            <Route path="/content" element={<Content />} />
            <Route path="/live" element={<Live />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/safety" element={<Safety />} />
            <Route path="/economy" element={<Economy />} />
            <Route path="/growth" element={<Growth />} />
            <Route path="/comms" element={<Comms />} />
            <Route path="/config" element={<Config />} />
            <Route path="/ops" element={<Ops />} />
            <Route path="/access" element={<Access />} />
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
    </AuthProvider>
  );
}
