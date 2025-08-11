import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PrivateRoute from "./pages/PrivateRoute";
import Marketplace from "./pages/Marketplace";
import LanguageSelector from "./components/LanguageSelector";

// Клиентские страницы
import ClientRegister from "./pages/ClientRegister";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";

// Приватный роут для клиента (отдельный токен)
function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100 p-4">
        <LanguageSelector />

        <Routes>
          {/* ===== Ваши существующие роуты (поставщик) ===== */}
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route path="/marketplace" element={<Marketplace />} />

          {/* ===== Клиент ===== */}
          <Route path="/client/register" element={<ClientRegister />} />
          <Route path="/client/login" element={<ClientLogin />} />
          <Route
            path="/client/dashboard"
            element={
              <ClientPrivateRoute>
                <ClientDashboard />
              </ClientPrivateRoute>
            }
          />

          {/* Опционально можно выставить дефолтный редирект */}
          {/* <Route path="*" element={<Navigate to="/marketplace" replace />} /> */}
        </Routes>
      </div>
    </Router>
  );
}

export default App;
