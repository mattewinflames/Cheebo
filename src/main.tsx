import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Prenotazioni from "./pages/Prenotazioni";
//import Admin from "./pages/Admin";
import Admin from "./pages/AdminCassa";
import EsitoPagamento from "./pages/EsitoPagamento";

const router = createBrowserRouter(
  [
    { path: "/", element: <Prenotazioni /> },
    { path: "/admin", element: <Admin /> },
    { path: "/pagamento/ok", element: <EsitoPagamento esito="ok" /> },
    { path: "/pagamento/annullato", element: <EsitoPagamento esito="annullato" /> },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  }
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>
);
