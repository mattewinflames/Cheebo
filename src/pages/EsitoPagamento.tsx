/* ============================================================================
   CHEEBO · Esito del pagamento (dopo il redirect da Stripe)
   ----------------------------------------------------------------------------
   Stripe rimanda qui: /pagamento/ok?session_id=... (o /pagamento/annullato).
   Il redirect NON è la conferma — quella la dà il webhook. Quindi qui si
   INTERROGA /api/order-status finché lo stato diventa "confermato", poi si
   mostrano codice di ritiro e link WhatsApp. Il client non può leggere `orders`
   (regole admin-only), per questo passa dall'endpoint.
   ========================================================================== */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MapPin, Navigation, Clock, Ticket } from "lucide-react";
import { fmt } from "../lib/dispatch";
import { buildConfirmMessage, waLink } from "../lib/whatsapp";
import { LOCALE_ADDRESS, LOCALE_MAPS_URL } from "../lib/firebase";

const C = {
  bg: "#FFFFFF", surface: "#F5F5FB", line: "#E8E8F2",
  blue: "#2E2C8B", ink: "#1B1B47", muted: "#8786A4", wa: "#25D366", amber: "#E1902F", red: "#C8321B",
};

type Stato = "loading" | "confermato" | "in_attesa" | "scaduto" | "annullato" | "errore";

interface Confermato {
  code: number | null;
  readyMin: number;
  items: string[];
  name: string;
  serviceKey: string;
}

const WEEK = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
/** "Ven 30 · Cena" da un serviceKey YYYY-MM-DD-Label, per il messaggio WhatsApp. */
function dayLabelFromKey(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (!m) return key;
  const [, y, mo, d, label] = m;
  const wd = new Date(Number(y), Number(mo) - 1, Number(d)).getDay();
  return `${WEEK[wd]} ${Number(d)} · ${label}`;
}

export default function EsitoPagamento({ esito }: { esito: "ok" | "annullato" }) {
  const [sp] = useSearchParams();
  const sessionId = sp.get("session_id");
  const [stato, setStato] = useState<Stato>(esito === "annullato" ? "annullato" : "loading");
  const [dati, setDati] = useState<Confermato | null>(null);

  useEffect(() => {
    if (esito === "annullato") return;
    if (!sessionId) { setStato("errore"); return; }

    let alive = true;
    let tries = 0;
    const MAX = 40; // ~60s a 1,5s l'uno: copre il ritardo del webhook

    const poll = async () => {
      try {
        const r = await fetch(`/api/order-status?session_id=${encodeURIComponent(sessionId)}`);
        const d = await r.json().catch(() => ({} as Record<string, unknown>));
        if (!alive) return;
        if (d?.stato === "confermato") {
          setDati({
            code: typeof d.code === "number" ? d.code : null,
            readyMin: Number(d.readyMin) || 0,
            items: Array.isArray(d.items) ? d.items : [],
            name: typeof d.name === "string" ? d.name : "Cliente",
            serviceKey: typeof d.serviceKey === "string" ? d.serviceKey : "",
          });
          setStato("confermato");
          return;
        }
        if (d?.stato === "scaduto") { setStato("scaduto"); return; }
        // in_attesa / sconosciuto: il webhook non ha ancora confermato, riprova
        if (tries++ < MAX) setTimeout(poll, 1500);
        else setStato("in_attesa");
      } catch {
        if (!alive) return;
        if (tries++ < MAX) setTimeout(poll, 1500);
        else setStato("errore");
      }
    };
    poll();
    return () => { alive = false; };
  }, [sessionId, esito]);

  const waHref = dati
    ? waLink(buildConfirmMessage(dati.name, dayLabelFromKey(dati.serviceKey), fmt(dati.readyMin), dati.items, true, dati.code ?? undefined))
    : "#";

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, color: C.ink, fontFamily: "'Inter',system-ui,sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap');.arch{font-family:'Archivo',system-ui,sans-serif}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <img src="/cheebo-logo.png" alt="Cheebo" width={52} height={52} style={{ marginBottom: 22 }} />

      {(stato === "loading" || stato === "in_attesa") && (
        <>
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid ${C.line}`, borderTopColor: C.blue, animation: "spin .8s linear infinite", margin: "0 auto 18px" }} />
          <h1 className="arch" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Sto confermando il pagamento…</h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 8, maxWidth: 320 }}>
            {stato === "in_attesa"
              ? "Ci sta mettendo più del solito. Tieni aperta la pagina ancora un momento."
              : "Un attimo: sto registrando la tua prenotazione."}
          </p>
        </>
      )}

      {stato === "confermato" && dati && (
        <div style={{ width: "100%", maxWidth: 400, margin: "0 auto" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: C.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 20px" }}>✓</div>
          <h1 className="arch" style={{ fontSize: 25, fontWeight: 900, margin: 0 }}>Prenotazione confermata</h1>
          <p style={{ color: C.muted, fontSize: 14, margin: "8px 0 26px" }}>È tutto pronto: ti aspettiamo al banco.</p>

          {/* Orario e codice: due tessere affiancate, con aria attorno */}
          <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: C.muted, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
                <Clock size={13} /> Pronto per le
              </div>
              <div className="arch" style={{ fontWeight: 900, fontSize: 44, lineHeight: 1.05, color: C.blue, marginTop: 6 }}>{fmt(dati.readyMin)}</div>
            </div>
            {dati.code != null && (
              <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: C.muted, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
                  <Ticket size={13} /> Codice
                </div>
                <div className="arch" style={{ fontWeight: 900, fontSize: 44, lineHeight: 1.05, color: C.ink, marginTop: 6 }}>#{dati.code}</div>
              </div>
            )}
          </div>

          {dati.items.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", marginBottom: 14, textAlign: "left" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: C.muted, marginBottom: 8 }}>Il tuo ordine</div>
              {dati.items.map((it, i) => <div key={i} style={{ fontSize: 14, padding: "3px 0", lineHeight: 1.4 }}>{it}</div>)}
            </div>
          )}

          {/* Ritiro: dove andare e come arrivare */}
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, marginBottom: 22, textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "#EDECFA", color: C.blue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><MapPin size={19} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Vieni a ritirare qui</div>
                <div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{LOCALE_ADDRESS}</div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, margin: "12px 0 14px", lineHeight: 1.5 }}>
              Presentati in cassa <strong style={{ color: C.ink }}>alle {fmt(dati.readyMin)}</strong>{dati.code != null && <> e mostra il codice <strong style={{ color: C.ink }}>#{dati.code}</strong></>}: il tuo ordine sarà pronto.
            </div>
            <a href={LOCALE_MAPS_URL} target="_blank" rel="noreferrer"
               style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.blue, color: "#fff", fontWeight: 700, fontSize: 15, padding: "13px 18px", borderRadius: 12, textDecoration: "none" }}>
              <Navigation size={17} /> Come arrivare
            </a>
          </div>

          <a href={waHref} target="_blank" rel="noreferrer"
             style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.wa, color: "#fff", fontWeight: 700, fontSize: 15, padding: "14px 22px", borderRadius: 12, textDecoration: "none" }}>
            Invia conferma su WhatsApp
          </a>
          <div style={{ marginTop: 18 }}>
            <a href="/" style={{ color: C.muted, fontSize: 13.5, textDecoration: "underline" }}>Torna al menù</a>
          </div>
        </div>
      )}

      {stato === "scaduto" && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.amber, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 16px" }}>!</div>
          <h1 className="arch" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Prenotazione scaduta</h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 8, maxWidth: 340 }}>
            Il tempo per completare il pagamento è finito e lo slot è stato liberato. Se ti è stato addebitato qualcosa, verrà stornato. Puoi rifare la prenotazione.
          </p>
          <a href="/" style={{ display: "inline-block", marginTop: 18, background: C.blue, color: "#fff", fontWeight: 700, fontSize: 15, padding: "14px 22px", borderRadius: 12, textDecoration: "none" }}>Rifai la prenotazione</a>
        </>
      )}

      {stato === "annullato" && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.surface, border: `1px solid ${C.line}`, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 16px" }}>×</div>
          <h1 className="arch" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Pagamento annullato</h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 8, maxWidth: 340 }}>
            Non è stato addebitato nulla. Lo slot che avevi scelto viene rilasciato a breve: se vuoi, puoi ricominciare.
          </p>
          <a href="/" style={{ display: "inline-block", marginTop: 18, background: C.blue, color: "#fff", fontWeight: 700, fontSize: 15, padding: "14px 22px", borderRadius: 12, textDecoration: "none" }}>Torna al menù</a>
        </>
      )}

      {stato === "errore" && (
        <>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 16px" }}>×</div>
          <h1 className="arch" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Qualcosa è andato storto</h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 8, maxWidth: 340 }}>
            Non riesco a leggere lo stato della prenotazione. Se hai completato il pagamento, contatta il locale per conferma prima di riprovare.
          </p>
          <a href="/" style={{ display: "inline-block", marginTop: 18, background: C.blue, color: "#fff", fontWeight: 700, fontSize: 15, padding: "14px 22px", borderRadius: 12, textDecoration: "none" }}>Torna al menù</a>
        </>
      )}
    </div>
  );
}
