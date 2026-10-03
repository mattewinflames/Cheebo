import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Prenotazioni from "./pages/Prenotazioni";
const Admin = lazy(() => import("./pages/AdminCassa"));
const EsitoPagamento = lazy(() => import("./pages/EsitoPagamento"));

const router = createBrowserRouter(
  [
    { path: "/", element: <Prenotazioni /> },
    { path: "/admin", element: <Suspense fallback={null}><Admin /></Suspense> },
    { path: "/pagamento/ok", element: <Suspense fallback={null}><EsitoPagamento esito="ok" /></Suspense> },
    { path: "/pagamento/annullato", element: <Suspense fallback={null}><EsitoPagamento esito="annullato" /></Suspense> },
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
