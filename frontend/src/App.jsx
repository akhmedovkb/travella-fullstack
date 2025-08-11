import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Register from "./pages/Register";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PrivateRoute from "./pages/PrivateRoute";
import Marketplace from "./pages/Marketplace";

// Клиентские
import ClientRegister from "./pages/ClientRegister";
import ClientLogin from "./pages/ClientLogin";
import ClientDashboard from "./pages/ClientDashboard";

import Header from "./components/Header";

function ClientPrivateRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" replace />;
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100 p-4">
        <Header />

        <Routes>
          {/* Поставщик */}
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

          {/* Клиент */}
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

          <Route path="*" element={<Navigate to="/marketplace" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
