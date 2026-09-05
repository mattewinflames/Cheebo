import { useState, useEffect, useMemo, useRef } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { upcomingSessions, resolveService, dateKey, type UpcomingSession } from "../lib/schedule";
import { CAP, totalWindows, windowStartMin, windowEndMin, planFirst, fmt, type Service } from "../lib/dispatch";
import { subscribeOrders, subscribeLedger, setStatus, submitBooking, type Order, type OrderStatus, type PayMethod, type Tender } from "../lib/orders";
import { subscribeMenu, saveItem, setActive, removeItem } from "../lib/menuStore";
import { fetchOrdersRange, buildRows, summarize, downloadCSV, downloadXLSX } from "../lib/export";
import { computeAnalytics, prevPeriod, addDays, localISODate, type Analytics } from "../lib/analytics";
import { euro, isPanino, occupiesGriddle, FORMATS, ingredientsOf, menuDrinkSurcharge, griddlePatty, cartLineOf, cartPrice, cartItemStrings, cartPatties, cartTotal, cartSpecials, specialCartLine, specialLeft, type FormatId, type CartType, type CartLine, type MenuItem, type MenuType, type PaninoConfig } from "../lib/menu";
import { ClipboardList, UtensilsCrossed, LogOut, Flame, Clock, Printer, Check, ChevronRight, Store, Pencil, Trash2, X, GripVertical, Leaf, RotateCcw, Wallet, Calendar, ChevronDown, Banknote, CreditCard, Receipt, ShoppingBag, AlertTriangle, Download, Settings, BarChart2 } from "lucide-react";
import { subscribeSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { bluetoothSupported, printESCPOS } from "../lib/bluetoothPrinter";
import { logBLE } from "../lib/bleLogger";

const C = {
  bg: "#FFFFFF", surface: "#F5F5FB", line: "#E8E8F2",
  blue: "#2E2C8B", ghost: "#E3E2F4", ink: "#1B1B47", muted: "#8786A4",
  amber: "#E0820F", green: "#1E9E57", redline: "#C8441A", veg: "#1E9E57", danger: "#C8441A",
};
const STATUS: Record<OrderStatus, { label: string; color: string; next: OrderStatus | null; action: string | null }> = {
  nuovo: { label: "Nuovo", color: C.blue, next: "in_consegna", action: "Segna in consegna" },
  in_consegna: { label: "In consegna", color: C.amber, next: "consegnato", action: "Segna consegnato" },
  consegnato: { label: "Consegnato", color: C.green, next: null, action: null },
};
const SECTIONS: { type: MenuType; label: string }[] = [{ type: "smash", label: "Smashburgers" }, { type: "burger", label: "Burgers" }, { type: "side", label: "Sides" }, { type: "salsa", label: "Salse" }, { type: "dolce", label: "Dolci" }, { type: "drink", label: "Drinks" }];

export default function AdminCassa() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);
  useEffect(() => { document.title = "Cheebo Admin · Cassa"; }, []);
  if (user === undefined) return <Center>Caricamento…</Center>;
  if (!user) return <Login />;
  return <AdminShell onLogout={() => signOut(auth)} />;
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"cassa" | "ordini" | "incassi" | "menu" | "opzioni" | "stats">("cassa");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => subscribeSettings(setSettings), []);

  // se la cassa viene disattivata mentre sei sulla sua scheda, spostati altrove
  useEffect(() => {
    if (!settings.cassaEnabled && tab === "cassa") setTab("ordini");
  }, [settings.cassaEnabled, tab]);

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');
        .arch{font-family:'Archivo',system-ui,sans-serif}::placeholder{color:#a8a8be}*:focus-visible{outline:2px solid ${C.blue};outline-offset:2px}
        .cols{display:grid;grid-template-columns:380px 1fr;gap:20px;align-items:start}.piastra{position:sticky;top:20px}
        .cassa{display:grid;grid-template-columns:1fr 350px;gap:18px;align-items:start}.scontrino{position:sticky;top:20px}
        .griglia{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:9px}
        @media(max-width:980px){.cassa{grid-template-columns:1fr}.scontrino{position:static}}
        @media(max-width:860px){.cols{grid-template-columns:1fr}.piastra{position:static}}
        .comanda-print{display:none}`}</style>
      <div className="screen">
        <div style={{ position: "sticky", top: 0, background: C.bg, zIndex: 6, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ maxWidth: 1140, margin: "0 auto", padding: "16px 20px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}><img src="/cheebo-logo.png" alt="Cheebo" width={38} height={38} /><div className="arch" style={{ fontWeight: 900, fontSize: 26, color: C.blue }}>CHEEBO <span style={{ color: C.muted, fontWeight: 700 }}>Admin</span></div></div>
              <button onClick={onLogout} style={{ ...btn("soft"), display: "flex", alignItems: "center", gap: 6 }}><LogOut size={14} /> Esci</button>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
              {settings.cassaEnabled && <NavTab icon={<Store size={16} />} label="Cassa" on={tab === "cassa"} onClick={() => setTab("cassa")} />}
              <NavTab icon={<ClipboardList size={16} />} label="Ordini" on={tab === "ordini"} onClick={() => setTab("ordini")} />
              <NavTab icon={<Wallet size={16} />} label="Incassi" on={tab === "incassi"} onClick={() => setTab("incassi")} />
              <NavTab icon={<UtensilsCrossed size={16} />} label="Menu" on={tab === "menu"} onClick={() => setTab("menu")} />
              <NavTab icon={<Settings size={16} />} label="Opzioni" on={tab === "opzioni"} onClick={() => setTab("opzioni")} />
              <NavTab icon={<BarChart2 size={16} />} label="Stats" on={tab === "stats"} onClick={() => setTab("stats")} />
            </div>
          </div>
        </div>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "20px 20px 60px", position: "relative" }}>
          <img src="/cheebo-logo.png" alt="" aria-hidden="true" style={{ position: "fixed", left: "50%", top: "55%", transform: "translate(-50%,-50%)", width: "min(70vw,560px)", opacity: 0.04, pointerEvents: "none", zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1 }}>
          {tab === "cassa" && settings.cassaEnabled ? <CassaSection />
            : tab === "ordini" ? <OrdiniSection />
            : tab === "incassi" ? <IncassiSection />
            : tab === "menu" ? <MenuSection />
            : tab === "stats" ? <StatisticheSection />
            : tab === "opzioni" ? <OpzioniSection settings={settings} />
            : <OrdiniSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   OPZIONI UTENTE — impostazioni dell'attività, condivise su tutti i dispositivi.
   Contenitore pensato per crescere: oggi c'è la sola "Modalità cassa", domani
   qui vivranno gli altri interruttori dello scheletro riconfigurabile.
   ========================================================================== */
/* Chiusure: helper per lavorare con date "YYYY-MM-DD" come giorni singoli,
   mostrandole però raggruppate per periodi consecutivi. */
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Espande un intervallo inclusivo in tutte le sue date. */
function espandiPeriodo(fromISO: string, toISO: string): string[] {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const end = new Date(ty, tm - 1, td);
  const out: string[] = [];
  for (const d = new Date(fy, fm - 1, fd); d <= end; d.setDate(d.getDate() + 1)) out.push(isoOf(d));
  return out;
}

/** Raggruppa date in blocchi di giorni consecutivi. */
function raggruppaConsecutivi(dates: string[]): { start: string; end: string; days: string[] }[] {
  const sorted = [...new Set(dates)].sort();
  const groups: { start: string; end: string; days: string[] }[] = [];
  for (const d of sorted) {
    const last = groups[groups.length - 1];
    const [ly, lm, ld] = last ? last.end.split("-").map(Number) : [0, 0, 0];
    const next = last ? isoOf(new Date(ly, lm - 1, ld + 1)) : "";
    if (last && next === d) { last.end = d; last.days.push(d); }
    else groups.push({ start: d, end: d, days: [d] });
  }
  return groups;
}

/** Etichetta leggibile di un gruppo: "12/08/2026" o "12/08 – 20/08/2026". */
function labelGruppo(g: { start: string; end: string }): string {
  const full = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  const short = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  if (g.start === g.end) return full(g.start);
  const sameYear = g.start.slice(0, 4) === g.end.slice(0, 4);
  return `${sameYear ? short(g.start) : full(g.start)} – ${full(g.end)}`;
}

function OpzioniSection({ settings }: { settings: AppSettings }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nuovaData, setNuovaData] = useState("");
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");

  const toggle = async (patch: Partial<AppSettings>) => {
    setBusy(true); setErr(null);
    try {
      await saveSettings(patch);
    } catch {
      setErr("Non salvato. Serve un admin autorizzato e le regole Firestore aggiornate (settings).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="arch" style={{ fontWeight: 800, fontSize: 20, color: C.blue }}>Opzioni utente</div>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 18px" }}>
        Impostazioni dell'attività. Valgono su tutti i dispositivi collegati.
      </div>

      {err && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FDECE8", border: `1px solid ${C.danger}`, color: C.danger, borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {err}
        </div>
      )}

      <OptionRow
        title="Modalità cassa"
        desc="Abilita la scheda Cassa per registrare gli ordini al banco e farli pesare sulla piastra. Se la disattivi, la scheda sparisce e resta la gestione di prenotazioni, incassi e menu."
        on={settings.cassaEnabled}
        busy={busy}
        onToggle={() => toggle({ cassaEnabled: !settings.cassaEnabled })}
      />

      <OptionRow
        title="Blocca prenotazioni"
        desc="Sospende SUBITO tutte le nuove prenotazioni online (imprevisti: chiusura improvvisa, guasto). Il sito mostra 'prenotazioni non disponibili'. Non tocca le prenotazioni già pagate."
        on={settings.bookingBlocked}
        busy={busy}
        onToggle={() => toggle({ bookingBlocked: !settings.bookingBlocked })}
      />

      {/* Prenotazioni solo fuori orario — per giorno della settimana */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Solo prenotazioni fuori orario</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>
              Quando attivo, i clienti possono prenotare online solo mentre il negozio è chiuso.
              Gli orari sono precompilati con quelli reali e modificabili per ogni giorno.
              Disattivare quando l'app fungerà da registratore di cassa.
            </div>
          </div>
          <div style={{ paddingTop: 2 }}>
            <Switch on={settings.onlyClosedBooking} onClick={() => { if (!busy) toggle({ onlyClosedBooking: !settings.onlyClosedBooking }); }} />
          </div>
        </div>

        {settings.onlyClosedBooking && (() => {
          const DOW_LABELS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
          const schedule = settings.onlyClosedSchedule ?? {};
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
              {([0, 1, 2, 3, 4, 5, 6] as const).map((dow) => {
                const services = schedule[dow] ?? [];
                if (services.length === 0) return (
                  <div key={dow} style={{ fontSize: 13, color: C.muted, paddingLeft: 2 }}>
                    <span style={{ fontWeight: 600 }}>{DOW_LABELS[dow]}:</span> chiuso
                  </div>
                );
                return (
                  <div key={dow} style={{ background: C.surface, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{DOW_LABELS[dow]}</div>
                    {services.map((svc, idx) => (
                      <div key={svc.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: idx < services.length - 1 ? 6 : 0, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, color: C.muted, minWidth: 46 }}>{svc.label}</span>
                        <span style={{ fontSize: 12, color: C.muted }}>blocca</span>
                        <input
                          type="time" value={svc.start} disabled={busy}
                          onChange={(e) => {
                            const updated = { ...schedule, [dow]: services.map((s, i) => i === idx ? { ...s, start: e.target.value } : s) };
                            toggle({ onlyClosedSchedule: updated });
                          }}
                          style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", fontSize: 13, background: busy ? C.bg : "#fff", color: C.ink }}
                        />
                        <span style={{ fontSize: 12, color: C.muted }}>→</span>
                        <input
                          type="time" value={svc.end} disabled={busy}
                          onChange={(e) => {
                            const updated = { ...schedule, [dow]: services.map((s, i) => i === idx ? { ...s, end: e.target.value } : s) };
                            toggle({ onlyClosedSchedule: updated });
                          }}
                          style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", fontSize: 13, background: busy ? C.bg : "#fff", color: C.ink }}
                        />
                        <span style={{ fontSize: 11, color: C.muted }}>prenotazioni bloccate in questa fascia</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Giorni di chiusura</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>
          Date in cui il locale è chiuso (ferie, festivi): in quei giorni non si può prenotare online. Non tocca le prenotazioni già pagate.
        </div>

        {/* Singolo giorno */}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px" }}>Un giorno</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" value={nuovaData} onChange={(e) => setNuovaData(e.target.value)}
            style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, color: C.ink }} />
          <button
            disabled={busy || !nuovaData || settings.closedDays.includes(nuovaData)}
            onClick={() => { toggle({ closedDays: [...settings.closedDays, nuovaData].sort() }); setNuovaData(""); }}
            style={{ background: (busy || !nuovaData || settings.closedDays.includes(nuovaData)) ? C.line : C.blue, color: (busy || !nuovaData || settings.closedDays.includes(nuovaData)) ? C.muted : "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            Aggiungi
          </button>
        </div>

        {/* Periodo dal / al */}
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px" }}>Un periodo</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={dal} onChange={(e) => setDal(e.target.value)} aria-label="Dal"
            style={{ flex: 1, minWidth: 130, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, color: C.ink }} />
          <span style={{ color: C.muted, fontSize: 13 }}>→</span>
          <input type="date" value={al} min={dal || undefined} onChange={(e) => setAl(e.target.value)} aria-label="Al"
            style={{ flex: 1, minWidth: 130, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, color: C.ink }} />
          <button
            disabled={busy || !dal || !al || al < dal}
            onClick={() => { toggle({ closedDays: [...new Set([...settings.closedDays, ...espandiPeriodo(dal, al)])].sort() }); setDal(""); setAl(""); }}
            style={{ background: (busy || !dal || !al || al < dal) ? C.line : C.blue, color: (busy || !dal || !al || al < dal) ? C.muted : "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
            Aggiungi periodo
          </button>
        </div>
        {dal && al && al < dal && <div style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>La data finale è precedente a quella iniziale.</div>}

        {/* Elenco, raggruppato per periodi consecutivi */}
        {settings.closedDays.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            {raggruppaConsecutivi(settings.closedDays).map((g) => (
              <span key={g.start} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 6px 5px 11px", fontSize: 13 }}>
                {labelGruppo(g)}
                {g.days.length > 1 && <span style={{ color: C.muted, fontSize: 11 }}>({g.days.length}gg)</span>}
                <button onClick={() => toggle({ closedDays: settings.closedDays.filter((x) => !g.days.includes(x)) })} disabled={busy}
                  aria-label="Rimuovi" style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, display: "flex", padding: 0 }}>
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 16 }}>Nessun giorno di chiusura impostato.</div>
        )}
      </div>

      {/* Costo servizio di prenotazione */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Costo servizio di prenotazione</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
              Importo fisso aggiunto a ogni prenotazione online (es. 0,50€). Appare come voce separata nel riepilogo del cliente.
            </div>
          </div>
          <button
            onClick={() => toggle({ costoServizioAttivo: !settings.costoServizioAttivo })}
            disabled={busy}
            style={{ flexShrink: 0, width: 44, height: 26, borderRadius: 13, border: "none", cursor: busy ? "default" : "pointer",
              background: settings.costoServizioAttivo ? C.blue : C.line, position: "relative", transition: "background .2s" }}>
            <span style={{ position: "absolute", top: 3, left: settings.costoServizioAttivo ? 21 : 3,
              width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: C.muted, whiteSpace: "nowrap" }}>Importo (€)</span>
          <input
            type="number" min="0" step="0.01"
            value={settings.costoServizio ?? 0}
            disabled={busy}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= 0) toggle({ costoServizio: Math.round(v * 100) / 100 });
            }}
            style={{ width: 90, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px",
              fontSize: 14, fontWeight: 600, background: busy ? C.bg : "#fff" }}
          />
          <span style={{ fontSize: 12, color: settings.costoServizioAttivo ? C.blue : C.muted, fontWeight: 600 }}>
            {settings.costoServizioAttivo ? "ATTIVO" : "NON ATTIVO"}
          </span>
        </div>
      </div>
    </div>
  );
}

function OptionRow({ title, desc, on, busy, onToggle }: {
  title: string; desc: string; on: boolean; busy?: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
                  border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, opacity: busy ? 0.6 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <div style={{ paddingTop: 2 }}><Switch on={on} onClick={() => { if (!busy) onToggle(); }} /></div>
    </div>
  );
}

/* ============================================================================
   CASSA (prototipo) — inserimento rapido degli ordini AL BANCO.
   ----------------------------------------------------------------------------
   Perché esiste: il banco è l'afflusso principale ma oggi è invisibile al
   sistema, quindi il registro della piastra riflette solo le prenotazioni e i
   tempi promessi sono ottimistici. Facendo passare anche il banco da qui, il
   registro diventa lo STATO REALE della piastra: prenotazioni e banco pescano
   dalla stessa capacità (13 patty / 10 min) e gli orari tornano affidabili.

   ⚠️ NON è un registratore di cassa fiscale. Non emette documenti commerciali
   e non trasmette corrispettivi: il documento fiscale resta in carico all'RT
   del locale. La soluzione software sostitutiva dell'RT dev'essere approvata
   dall'Agenzia delle Entrate e rilasciata da un erogatore accreditato, quindi
   lo strato fiscale va delegato (RT esistente via protocollo, o provider
   accreditato via API). Qui `tender` serve solo a sapere come è stato incassato.
   ========================================================================== */
function CassaSection() {
  const sessions = useMemo(() => upcomingSessions(), []);
  const active = useMemo(() => resolveService(), []);
  const [sessionKey, setSessionKey] = useState(active?.serviceKey ?? sessions[0]?.serviceKey ?? "");
  const session = sessions.find((s) => s.serviceKey === sessionKey) ?? sessions[0];
  const service: Service | null = session ? { startMin: session.startMin, endMin: session.endMin, label: session.label } : null;

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [ledger, setLedger] = useState<number[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [cfg, setCfg] = useState<MenuItem | null>(null); // panino aperto nel menù contestuale
  const [name, setName] = useState("");
  const [tender, setTender] = useState<Tender>("contanti");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: number; readyMin: number; total: number } | null>(null);

  useEffect(() => subscribeMenu(setMenu, true), []);
  useEffect(() => {
    if (!service || !sessionKey) return;
    return subscribeLedger(sessionKey, totalWindows(service), (l, st) => { setLedger(l); setStock(st); }, () => setErr("Registro piastra non raggiungibile."));
  }, [sessionKey, service?.startMin]);

  const lines = Object.values(cart).filter((l) => l.qty > 0);
  const patties = cartPatties(lines);
  const total = cartTotal(lines);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  // Anteprima dal vivo: l'ordine al banco è sempre "primo disponibile"
  const preview = useMemo(
    () => (service && lines.length ? planFirst(ledger, patties, service) : null),
    [ledger, patties, service?.startMin, lines.length],
  );

  /* Chiave, etichetta e prezzo arrivano dagli helper condivisi in menu.ts:
     è ciò che tiene allineate cassa e sito cliente. */
  const addPanino = (cfg: PaninoConfig) => {
    const line = cartLineOf(cfg);
    setCart((c) => ({ ...c, [line.key]: { ...line, qty: (c[line.key]?.qty ?? 0) + 1 } }));
    setCfg(null);
  };
  const addSemplice = (it: MenuItem) =>
    setCart((c) => ({ ...c, [it.id]: { key: it.id, label: it.name, price: it.price ?? 0, patty: 0, qty: (c[it.id]?.qty ?? 0) + 1 } }));
  /* Lo special si batte come voce fissa (fuori menù): un tocco = un pezzo, fino
     ai pezzi rimasti della sessione. Il tetto vero resta nella transazione. */
  const addSpecial = (it: MenuItem) => {
    const left = specialLeft(it, stock, sessionKey);
    const line = specialCartLine(it);
    setCart((c) => { const cur = c[line.key]?.qty ?? 0; return cur >= left ? c : { ...c, [line.key]: { ...line, qty: cur + 1 } }; });
  };
  const bump = (key: string, d: number) =>
    setCart((c) => { const q = (c[key]?.qty ?? 0) + d; const n = { ...c }; if (q <= 0) delete n[key]; else n[key] = { ...n[key], qty: q }; return n; });
  const svuota = () => { setCart({}); setName(""); setErr(null); setCfg(null); };

  const incassa = async () => {
    if (!service || !session || !lines.length) return;
    setBusy(true); setErr(null);
    try {
      const res = await submitBooking({
        serviceKey: sessionKey, service, name: name.trim() || "Banco",
        items: cartItemStrings(lines), patties,
        mode: "first", pay: "loco", total, phone: "",
        channel: "banco", tender,
        specials: cartSpecials(lines),
      });
      if (res.ok) { setDone({ code: res.code, readyMin: res.readyMin, total }); setCart({}); setName(""); }
      else if (res.reason === "special")
        setErr(res.left ? `Special esaurito: ne restano ${res.left}.` : "Special esaurito.");
      else setErr("Piastra al completo per questo servizio: non è possibile accodare l'ordine.");
    } catch { setErr("Errore di connessione. Riprova."); }
    finally { setBusy(false); }
  };

  const gruppi = SECTIONS.map((s) => ({ ...s, items: menu.filter((m) => m.type === s.type && m.active) })).filter((g) => g.items.length);
  const drinks = useMemo(
    () => menu.filter((d) => d.type === "drink" && d.active)
              .sort((a, b) => menuDrinkSurcharge(a) - menuDrinkSurcharge(b) || a.order - b.order),
    [menu],
  );

  /* ---- schermata di conferma: quello che lo staff dice al cliente ---- */
  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: "40px auto 0", textAlign: "center" }}>
        <div style={{ width: 60, height: 60, borderRadius: "50%", background: C.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><Check size={30} /></div>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>Pronto per le</div>
        <div className="arch" style={{ fontWeight: 900, fontSize: 76, lineHeight: 1, color: C.blue, margin: "4px 0" }}>{fmt(done.readyMin)}</div>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, margin: "18px 0" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>Codice di ritiro</div>
          <div className="arch" style={{ fontWeight: 900, fontSize: 42, lineHeight: 1.1 }}>#{done.code}</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Incassato {euro(done.total)} · {tender}</div>
        </div>
        <div style={{ fontSize: 12, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 18 }}>
          <AlertTriangle size={14} /> Ricorda: lo scontrino va emesso dal registratore di cassa.
        </div>
        <button onClick={() => setDone(null)} style={{ ...btn("primary"), width: "100%" }}>Nuovo ordine</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <SessionPicker sessions={sessions} value={sessionKey} onChange={(k) => { setSessionKey(k); svuota(); }} />
        <div style={{ fontSize: 12, color: C.muted }}>Ordini presi al banco · entrano nella stessa piastra delle prenotazioni</div>
      </div>

      <div style={{ background: "#FFF8EC", border: `1px solid #F0D9AE`, color: "#8A5B12", borderRadius: 10, padding: "10px 13px", marginBottom: 16, fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.45 }}>
        <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span><b>Prototipo, non fiscale.</b> Questa cassa registra l'ordine e occupa la piastra, ma non emette il documento commerciale né trasmette i corrispettivi: lo scontrino resta a carico del registratore telematico del locale.</span>
      </div>

      <div className="cassa">
        {/* ---------------- inserimento rapido ---------------- */}
        <div>

          {gruppi.map((g) => (
            <div key={g.type} style={{ marginBottom: 18 }}>
              <div className="arch" style={{ fontWeight: 900, fontSize: 15, color: C.muted, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 }}>{g.label}</div>
              <div className="griglia">
                {g.items.map((it) => {
                  const panino = isPanino(it.type);
                  const special = !!it.special;
                  const griglia = panino && occupiesGriddle(it);
                  const left = special ? specialLeft(it, stock, sessionKey) : 0;
                  const soldOut = special && left <= 0;   // esaurito o non previsto in questa sessione
                  return (
                    <button key={it.id} disabled={soldOut}
                      onClick={() => (special ? addSpecial(it) : panino ? setCfg(it) : addSemplice(it))}
                      style={{ textAlign: "left", background: soldOut ? C.surface : C.bg, border: `1px solid ${special && !soldOut ? C.amber : C.line}`, borderRadius: 11, padding: "12px 13px", cursor: soldOut ? "default" : "pointer", opacity: soldOut ? 0.55 : 1, minHeight: 72, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25, display: "flex", alignItems: "center", gap: 5 }}>
                        {special && <span style={{ color: C.amber }}>★</span>}
                        {it.name}{it.veg && <Leaf size={12} color={C.veg} />}
                        {griglia && <Flame size={12} color={C.amber} />}
                      </span>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.blue }}>{special ? euro(it.solo ?? 0) : panino ? `da ${euro(it.solo ?? 0)}` : euro(it.price ?? 0)}</span>
                        {special && <span style={{ fontSize: 11, fontWeight: 700, color: soldOut ? C.muted : C.amber, textTransform: "uppercase", letterSpacing: 0.5 }}>{soldOut ? "esaurito" : `${left} rim.`}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
            <Flame size={12} color={C.amber} /> occupa la piastra · gli altri non hanno limite
          </div>
        </div>

        {/* ---------------- scontrino / carrello ---------------- */}
        <div className="scontrino">
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ background: C.surface, padding: "11px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}><ShoppingBag size={15} /> Ordine {count > 0 && `· ${count}`}</span>
              {count > 0 && <button onClick={svuota} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Svuota</button>}
            </div>

            {lines.length === 0 ? (
              <div style={{ padding: "34px 16px", textAlign: "center", color: C.muted, fontSize: 13 }}>Tocca i prodotti per aggiungerli.</div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {lines.map((l) => (
                  <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{l.label}</div>
                      <div style={{ fontSize: 11.5, color: C.muted }}>{euro(l.price)}{l.patty > 0 && ` · ${l.patty} patty`}</div>
                    </div>
                    <button onClick={() => bump(l.key, -1)} style={rndBtn} aria-label="Togli">{l.qty > 1 ? "−" : <Trash2 size={13} />}</button>
                    <span style={{ width: 16, textAlign: "center", fontWeight: 700, fontSize: 13.5 }}>{l.qty}</span>
                    <button onClick={() => bump(l.key, 1)} style={{ ...rndBtn, background: C.blue, borderColor: C.blue, color: "#fff" }} aria-label="Aggiungi">+</button>
                  </div>
                ))}
              </div>
            )}

            {/* anteprima dal vivo dell'orario: è ciò che lo staff dice al cliente */}
            <div style={{ padding: "12px 14px", background: preview?.ok ? "#F2F7F4" : C.surface, borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, fontWeight: 700 }}>Pronto per le</div>
              {lines.length === 0
                ? <div className="arch" style={{ fontWeight: 900, fontSize: 30, color: C.ghost }}>—:—</div>
                : preview?.ok
                  ? <div className="arch" style={{ fontWeight: 900, fontSize: 34, color: C.blue, lineHeight: 1.1 }}>{fmt(preview.readyMin)}</div>
                  : <div style={{ fontWeight: 700, fontSize: 13, color: C.redline, marginTop: 3 }}>Piastra al completo</div>}
              {patties > 0 && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{patties} patty sulla piastra</div>}
            </div>

            <div style={{ padding: "12px 14px" }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome cliente (facoltativo)" style={{ ...inp, marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
                {([["contanti", <Banknote size={14} key="b" />], ["carta", <CreditCard size={14} key="c" />]] as [Tender, JSX.Element][]).map(([t, ic]) => (
                  <button key={t} onClick={() => setTender(t)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", border: `1px solid ${tender === t ? C.blue : C.line}`, background: tender === t ? C.blue : C.bg, color: tender === t ? "#fff" : C.ink }}>
                    {ic} {t}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 11 }}>
                <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: C.muted, fontWeight: 700 }}>Totale</span>
                <span className="arch" style={{ fontWeight: 900, fontSize: 30, color: C.blue }}>{euro(total)}</span>
              </div>
              {err && <div style={{ color: C.redline, fontSize: 12.5, marginBottom: 9 }}>{err}</div>}
              <button onClick={incassa} disabled={!lines.length || busy || !preview?.ok}
                style={{ ...btn("primary"), width: "100%", padding: "14px", fontSize: 15, opacity: !lines.length || busy || !preview?.ok ? 0.45 : 1, cursor: !lines.length || busy || !preview?.ok ? "default" : "pointer" }}>
                {busy ? "Attendere…" : "Incassa e accoda"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {cfg && <PaninoPopup item={cfg} drinks={drinks} onAdd={addPanino} onClose={() => setCfg(null)} />}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Menù contestuale del panino (cassa). Si apre toccando il prodotto e chiude
   la scelta in un colpo solo: formato (= patty per hamburger), tipo, birra.
   Parte dai default (Singolo · Solo panino), quindi l'ordine più comune resta
   a due tocchi: prodotto -> Aggiungi.

   ⚠️ DA FARE (in attesa dell'elenco dal cliente): rimozione ingredienti
   ("senza cipolla", "senza pickles"…). Va aggiunta QUI e, in modo speculare,
   nel configuratore di Prenotazioni.tsx. Serve prima il dato sul menù: quali
   ingredienti sono removibili per ciascun panino (campo per voce, editabile
   dalla sezione Menu). Poi entra nell'ultimo segmento della chiave riga (già
   predisposto) e nell'etichetta. Non incide su patty né prezzo.
   ---------------------------------------------------------------------------- */
function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, letterSpacing: 1.3, textTransform: "uppercase", color: C.muted, fontWeight: 700, marginBottom: 7 }}>{children}</div>;
}
function PaninoPopup({ item, drinks, onAdd, onClose }: { item: MenuItem; drinks: MenuItem[]; onAdd: (c: PaninoConfig) => void; onClose: () => void }) {
  const [fmtId, setFmtId] = useState<FormatId>("singolo");
  const [type, setType] = useState<CartType>("panino");
  const [drinkId, setDrinkId] = useState<string>("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [swaps, setSwaps] = useState<string[]>([]);
  const ingredients = ingredientsOf(item);
  const drink = drinks.find((d) => d.id === drinkId)
             ?? drinks.find((d) => menuDrinkSurcharge(d) === 0)
             ?? drinks[0];
  const cfg: PaninoConfig = { item, format: fmtId, type, drink, removed, swaps };
  const toggleRm = (ing: string) => setRemoved((r) => r.includes(ing) ? r.filter((x) => x !== ing) : [...r, ing]);
  const toggleSwap = (id: string) => setSwaps((v) => v.includes(id) ? v.filter((x) => x !== id) : [...v, id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const price = cartPrice(cfg);
  const patty = griddlePatty(item, fmtId);
  const pick = (on: boolean): React.CSSProperties => ({
    flex: 1, padding: "13px 8px", borderRadius: 10, fontSize: 14.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? C.blue : C.line}`, background: on ? C.blue : C.bg, color: on ? "#fff" : C.ink,
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,20,45,.42)", zIndex: 40 }} />
      <div role="dialog" aria-modal="true" aria-label={item.name}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(430px, calc(100vw - 32px))", maxHeight: "88vh", overflowY: "auto", background: C.bg, borderRadius: 16, zIndex: 41, boxShadow: "0 24px 60px rgba(27,27,71,.3)" }}>
        <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div className="arch" style={{ fontWeight: 800, fontSize: 20, display: "flex", alignItems: "center", gap: 6 }}>
              {item.name}{item.veg && <Leaf size={14} color={C.veg} />}{occupiesGriddle(item) && <Flame size={14} color={C.amber} />}
            </div>
            {item.desc && <div style={{ fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>{item.desc}</div>}
          </div>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 30, height: 30, borderRadius: 8, background: C.surface, border: "none", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} color={C.muted} /></button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          {/* 1 · che prodotto è: patty e tipo, vicini */}
          <Lbl>Patty per hamburger</Lbl>
          <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
            {(Object.keys(FORMATS) as FormatId[]).map((f) => (
              <button key={f} onClick={() => setFmtId(f)} style={pick(fmtId === f)}>
                {FORMATS[f].label}
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>
                  {FORMATS[f].patty} patty{FORMATS[f].surcharge ? ` · +${FORMATS[f].surcharge}€` : ""}
                </div>
              </button>
            ))}
          </div>

          <Lbl>Tipo</Lbl>
          <div style={{ display: "flex", gap: 7 }}>
            <button onClick={() => setType("panino")} style={pick(type === "panino")}>Solo panino</button>
            <button onClick={() => setType("menu")} style={pick(type === "menu")}>
              Menu<div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>+ patatine + bibita</div>
            </button>
          </div>

          {/* 2 · composizione del panino */}
          {ingredients.length > 0 && (
            <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
              <Lbl>Ingredienti · togli quelli che non vuoi</Lbl>
              {ingredients.map((ing, i) => {
                const off = removed.includes(ing);
                return (
                  <div key={ing} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: i < ingredients.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <span style={{ fontSize: 13.5, color: off ? C.muted : C.ink, textDecoration: off ? "line-through" : "none" }}>{ing}</span>
                    <button onClick={() => toggleRm(ing)} role="switch" aria-checked={!off} aria-label={off ? `Rimetti ${ing}` : `Togli ${ing}`}
                      style={{ width: 46, height: 28, borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", padding: 0, background: off ? "#D8D8E4" : C.blue, transition: "background .15s" }}>
                      <span style={{ position: "absolute", top: 3, left: off ? 3 : 21, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {(item.swaps ?? []).length > 0 && (
            <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
              <Lbl>Sostituzioni</Lbl>
              {(item.swaps ?? []).map((sw, i, arr) => {
                const on = swaps.includes(sw.id);
                return (
                  <button key={sw.id} onClick={() => toggleSwap(sw.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", cursor: "pointer",
                             padding: "9px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none", textAlign: "left" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${on ? C.blue : C.muted}`, background: on ? C.blue : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={14} />}</span>
                    <span style={{ flex: 1, fontSize: 14, color: C.ink }}>{sw.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: sw.price ? C.blue : C.green }}>{sw.price ? `+${euro(sw.price)}` : "incluso"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 3 · accessorio del menu: la bibita, in fondo */}
          {type === "menu" && (
            <div style={{ marginTop: 14 }}>
              <Lbl>Bibita compresa</Lbl>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {drinks.map((d) => {
                  const sur = menuDrinkSurcharge(d);
                  const on = drink?.id === d.id;
                  return (
                    <button key={d.id} onClick={() => setDrinkId(d.id)}
                      style={{ cursor: "pointer", borderRadius: 9, padding: "9px 13px", fontSize: 13.5, fontWeight: 700,
                               background: on ? C.blue : C.bg, color: on ? "#fff" : C.ink,
                               border: `1px solid ${on ? C.blue : C.line}` }}>
                      {d.name}{sur > 0 && <span style={{ opacity: 0.8, fontWeight: 600 }}> +{euro(sur)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, padding: "13px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flexShrink: 0 }}>
            <div className="arch" style={{ fontWeight: 900, fontSize: 24, color: C.blue, lineHeight: 1 }}>{euro(price)}</div>
            {patty > 0 && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{patty} patty piastra</div>}
          </div>
          <button onClick={() => onAdd(cfg)} style={{ ...btn("primary"), flex: 1, padding: "14px", fontSize: 15 }}>Aggiungi</button>
        </div>
      </div>
    </>
  );
}
const rndBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: "50%", background: C.bg, border: `1px solid ${C.line}`, color: C.ink, cursor: "pointer", fontSize: 15, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

/* ---------------- selettore sessione (date-picker) ---------------- */
type DayGroup = { dayKey: string; dayLabel: string; dateLabel: string; services: UpcomingSession[] };
function SessionPicker({ sessions, value, onChange }: { sessions: UpcomingSession[]; value: string; onChange: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const days: DayGroup[] = [];
  sessions.forEach((s) => {
    const dk = s.serviceKey.slice(0, 10);
    let d = days.find((x) => x.dayKey === dk);
    if (!d) { d = { dayKey: dk, dayLabel: s.dayLabel, dateLabel: s.dateLabel, services: [] }; days.push(d); }
    d.services.push(s);
  });
  const cur = sessions.find((s) => s.serviceKey === value) ?? sessions[0];
  const curDayKey = cur ? cur.serviceKey.slice(0, 10) : "";
  const curDay = days.find((d) => d.dayKey === curDayKey);
  const label = cur ? `${cur.dayLabel} — ${cur.label}` : "Nessun servizio";

  const pickDay = (d: DayGroup) => {
    if (d.services.length === 1) { onChange(d.services[0].serviceKey); setOpen(false); }
    else { const keep = d.services.find((s) => s.label === cur?.label) ?? d.services[0]; onChange(keep.serviceKey); }
  };
  const pickSvc = (s: UpcomingSession) => { onChange(s.serviceKey); setOpen(false); };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${open ? C.blue : C.line}`, background: "#fff", borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontWeight: 700, fontSize: 14, color: C.ink }}>
        <Calendar size={16} /><span>{label}</span><ChevronDown size={15} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 25 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 14px 40px rgba(27,27,71,.18)", padding: 12, width: "min(340px,86vw)" }}>
            <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 600, marginBottom: 8 }}>Giorno</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(days.length, 7)},1fr)`, gap: 5, marginBottom: 12 }}>
              {[...days].sort((a, b) => a.dayKey.localeCompare(b.dayKey)).map((d) => {
                const on = d.dayKey === curDayKey; const tok = d.dateLabel.split(" ");
                return <button key={d.dayKey} onClick={() => pickDay(d)} style={{ textAlign: "center", borderRadius: 9, padding: "7px 2px", cursor: "pointer", border: `1px solid ${on ? C.blue : C.line}`, background: on ? C.blue : "#fff", color: on ? "#fff" : C.ink }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.75 }}>{d.dayLabel === "Oggi" ? "Oggi" : tok[0]}</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{tok[1] ?? ""}</div>
                </button>;
              })}
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 600, marginBottom: 8 }}>Servizio</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(curDay?.services ?? []).map((s) => {
                const on = s.serviceKey === value;
                return <button key={s.serviceKey} onClick={() => pickSvc(s)} style={{ flex: 1, border: `1px solid ${on ? C.blue : C.line}`, background: on ? C.blue : "#fff", color: on ? "#fff" : C.ink, borderRadius: 8, padding: "9px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <div>{s.label}</div><div style={{ fontSize: 10.5, opacity: 0.7, fontWeight: 400 }}>{fmt(s.startMin)}–{fmt(s.endMin)}</div>
                </button>;
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- ORDINI ---------------- */
function OrdiniSection() {
  const sessions = useMemo(() => upcomingSessions(), []);
  const active = useMemo(() => resolveService(), []);
  const [sessionKey, setSessionKey] = useState(active?.serviceKey ?? sessions[0]?.serviceKey ?? "");
  const session = sessions.find((s) => s.serviceKey === sessionKey) ?? sessions[0];
  const service: Service | null = session ? { startMin: session.startMin, endMin: session.endMin, label: session.label } : null;

  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<number[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"dafare" | "consegnato" | "tutti">("dafare");
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [pianoEspanso, setPianoEspanso] = useState(false);

  useEffect(() => {
    if (!sessionKey) return;
    setLoadErr(null);
    return subscribeOrders(sessionKey, (o) => { setOrders(o); setLoadErr(null); },
      () => setLoadErr("Impossibile caricare gli ordini. Controlla la connessione e riprova."));
  }, [sessionKey]);
  useEffect(() => { if (service && sessionKey) return subscribeLedger(sessionKey, totalWindows(service), setLedger); }, [sessionKey, service?.startMin]);
  useEffect(() => { const after = () => setPrintOrder(null); window.addEventListener("afterprint", after); return () => window.removeEventListener("afterprint", after); }, []);
  const [printing, setPrinting] = useState<string | null>(null); // orderId in corso
  const printingRef = useRef<string | null>(null); // lock sincrono anti-doppio-click
  const doPrint = async (o: Order) => {
    if (!o.id) return;
    // Lock sincrono: blocca immediatamente senza aspettare il re-render React
    if (printingRef.current) return;
    printingRef.current = o.id;
    setPrinting(o.id);
    try {
      const r = await fetch(`/api/comanda-txt?order_id=${encodeURIComponent(o.id)}`);
      if (!r.ok) { alert("Errore generazione comanda"); return; }
      const text = await r.text();

      if (bluetoothSupported()) {
        // Stampa diretta BLE (Chrome Android)
        await printESCPOS(text);
      } else {
        // Fallback: download manuale (Safari iOS, Firefox, ecc.)
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `comanda-${o.code ?? o.id.slice(0, 6)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      // L'utente ha annullato il dialog Bluetooth: non è un errore
      if (err instanceof DOMException && err.name === "NotFoundError") return;
      // Log su Firestore per troubleshooting remoto
      await logBLE("error", "Errore in doPrint (AdminCassa)", {
        detail: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      });
      // Timeout o connessione BLE persa: messaggio specifico
      const msg = err instanceof Error ? err.message : "Errore sconosciuto";
      alert(`Errore stampa: ${msg}\n\nRiprova — se il problema persiste, riavvia il Bluetooth.`);
    } finally {
      printingRef.current = null;
      setPrinting(null);
    }
  };
  const [clearing, setClearing] = useState(false);

  if (!service) return <div style={{ color: C.muted }}>Nessun servizio disponibile.</div>;
  const n = totalWindows(service);
  const fill = ledger.length ? ledger : new Array(n).fill(0);
  const lastUsed = fill.reduce((a, v, i) => (v > 0 ? i : a), -1);
  const shownBase = Math.min(n, Math.max(lastUsed + 2, 5));
  const shown = pianoEspanso ? n : shownBase;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = sessionKey.slice(0, 10) === dateKey(new Date());
  const curWi = isToday && nowMin >= service.startMin && nowMin < service.endMin ? Math.floor((nowMin - service.startMin) / 10) : -1;
  const totalPatty = orders.reduce((s, o) => s + o.patties, 0);
  const counts = orders.reduce<Record<string, number>>((m, o) => ((m[o.status] = (m[o.status] || 0) + 1), m), {});
  const visible = orders
    .filter((o) => filter === "tutti" || (filter === "dafare" ? (o.status === "nuovo" || o.status === "in_consegna") : o.status === filter))
    .sort((a, b) => a.readyMin - b.readyMin);

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <SessionPicker sessions={sessions} value={sessionKey} onChange={setSessionKey} />
        <div style={{ flex: 1 }} />
        <Stat n={orders.length} label="ordini" /><Stat n={totalPatty} label="patty" />
      </div>

      {loadErr && (
        <div style={{ background: "#FFF4F0", border: `1px solid #F3C9BC`, color: C.redline, borderRadius: 10, padding: "11px 14px", marginBottom: 16, fontSize: 13.5, fontWeight: 600 }}>
          ⚠️ {loadErr}
        </div>
      )}

      <div className="cols">
        <div className="piastra">
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span className="arch" style={{ fontWeight: 800, fontSize: 18 }}>Occupazione piastra</span>
              <span style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}><Flame size={13} color={C.redline} />{CAP}/10 min</span>
            </div>
            {Array.from({ length: shown }).map((_, wi) => {
              const used = fill[wi] || 0, wStart = windowStartMin(service, wi), here = orders.filter((c) => c.windowIndex === wi && c.patties > 0), isNow = wi === curWi, empty = used === 0;
              return (
                <div key={wi} style={{ padding: "9px 0", borderBottom: wi < shown - 1 ? `1px solid ${C.line}` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: isNow ? 700 : 500, color: isNow ? C.blue : C.ink, display: "flex", alignItems: "center", gap: 5 }}><Clock size={11} color={isNow ? C.blue : C.muted} />{fmt(wStart)}–{fmt(windowEndMin(service, wi))}{isNow && <span style={{ fontSize: 10, color: C.blue, marginLeft: 4 }}>ORA</span>}</span>
                    <span style={{ fontSize: 11.5, fontWeight: used ? 700 : 400, color: used === CAP ? C.redline : empty ? "#b9b9cc" : C.muted }}>{empty ? "libera" : `${used}/${CAP}${used === CAP ? " · piena" : ""}`}</span>
                  </div>
                  <div style={{ display: "flex", gap: 3, marginBottom: here.length ? 6 : 0 }}>{Array.from({ length: CAP }).map((_, s) => <div key={s} style={{ flex: 1, height: 9, borderRadius: 2, background: s < used ? C.blue : "#DEDEEC" }} />)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{here.map((c) => <span key={c.id} style={{ fontSize: 11, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 20, padding: "2px 9px" }}>{c.name} · {c.patties}p{c.mode === "at" ? " · scelto" : ""}</span>)}</div>
                </div>
              );
            })}
            {n > shownBase && (
              <button onClick={() => setPianoEspanso((v) => !v)}
                style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: C.blue, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "6px 0" }}>
                {pianoEspanso ? "Comprimi" : `Mostra tutte le ${n} fasce`}
              </button>
            )}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
            {(["dafare", "consegnato", "tutti"] as const).map((id) => {
              const c = id === "tutti" ? orders.length : id === "dafare" ? (counts["nuovo"] || 0) + (counts["in_consegna"] || 0) : counts[id] || 0;
              const label = id === "tutti" ? "Tutti" : id === "dafare" ? "Da fare" : "Consegnato";
              return <button key={id} onClick={() => setFilter(id)} style={chip(filter === id)}>{label} <span style={{ opacity: 0.7 }}>{c}</span></button>;
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.length === 0 && <div style={{ color: C.muted, fontSize: 14, padding: "18px 0", lineHeight: 1.5 }}>{orders.length === 0 ? "Nessun ordine per questo servizio." : filter === "dafare" ? "Tutto lavorato! Gli ordini consegnati sono nelle schede accanto." : "Nessun ordine in questa scheda."}</div>}
            {visible.map((o) => {
              const st = STATUS[o.status], dim = o.status === "consegnato";
              return (
                <div key={o.id} style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, opacity: dim ? 0.6 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", background: C.ink, borderRadius: 7, padding: "2px 8px" }}>#{o.code ?? "—"}</span><span style={{ fontWeight: 700, fontSize: 16 }}>{o.name}</span><Badge color={st.color}>{st.label}</Badge>
                        {o.channel === "banco" && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8A5B12", background: "#FFF3DF", border: `1px solid #F0D9AE`, borderRadius: 20, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}><Store size={10} /> Banco</span>}
                        <PagamentoBadge pay={o.pay} tender={o.tender} small />
                      </div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>{session.label} · {o.mode === "at" ? "orario scelto" : "primo disponibile"}{o.phone ? <> · <a href={`tel:${o.phone}`} style={{ color: C.blue, textDecoration: "none", fontWeight: 600 }}>{o.phone}</a></> : ""}</div>
                      <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{o.items.map((i, k) => <div key={k}>{i}</div>)}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{o.patties} patty · <span style={{ color: C.blue, fontWeight: 700 }}>{euro(o.total ?? 0)}</span></div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted }}>Pronto</div>
                      <div className="arch" style={{ fontWeight: 800, fontSize: 26, color: C.blue, lineHeight: 1 }}>{fmt(o.readyMin)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={() => doPrint(o)} disabled={printing === o.id} style={{ ...btn("soft"), display: "flex", alignItems: "center", gap: 6, opacity: printing === o.id ? 0.6 : 1 }}><Printer size={15} /> {printing === o.id ? "Generando…" : "Stampa comanda"}</button>
                    {st.next && <button onClick={() => setStatus(o.id, st.next!)} style={{ ...btn("primary"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>{o.status === "in_consegna" ? <Check size={15} /> : <ChevronRight size={15} />} {st.action}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="comanda-print">
        {printOrder && (
          <div style={{ fontFamily: "'Courier New', Courier, monospace", color: "#000", width: "76mm", padding: "2mm 3mm", fontSize: "9pt", lineHeight: 1.4 }}>
            {/* Logo + Intestazione */}
            <div style={{ textAlign: "center", marginBottom: "1mm" }}>
              <img
                src="/cheebo-logo.png"
                alt="Cheebo"
                style={{ width: "18mm", height: "18mm", objectFit: "contain", display: "block", margin: "0 auto 2mm" }}
              />
              <div style={{ fontSize: "8pt", letterSpacing: 1 }}>COMANDA CUCINA</div>
            </div>
            <Dash />
            {/* Codice ritiro — elemento dominante */}
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: "42pt", lineHeight: 1, margin: "2mm 0 1mm" }}>
              #{printOrder.code ?? "—"}
            </div>
            {/* Orario — secondo per importanza */}
            <div style={{ textAlign: "center", fontSize: "7pt", letterSpacing: 1, marginBottom: "0.5mm" }}>PRONTO ALLE</div>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: "22pt", lineHeight: 1, marginBottom: "2mm" }}>
              {fmt(printOrder.readyMin)}
            </div>
            <Dash />
            {/* Cliente */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1mm" }}>
              <span style={{ fontSize: "8pt" }}>Cliente</span>
              <strong style={{ fontSize: "10pt" }}>{printOrder.name.toUpperCase()}</strong>
            </div>
            {printOrder.phone && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1mm" }}>
                <span style={{ fontSize: "8pt" }}>Tel</span>
                <strong style={{ fontSize: "9pt" }}>{printOrder.phone}</strong>
              </div>
            )}
            <Dash />
            {/* Voci ordine */}
            {printOrder.items.map((item, k) => {
              const isExtra = item.startsWith("  ") || item.startsWith("+");
              return (
                <div key={k} style={{
                  fontWeight: isExtra ? 400 : 700,
                  fontSize: isExtra ? "8pt" : "10pt",
                  marginBottom: isExtra ? "0.5mm" : "2mm",
                  paddingLeft: isExtra ? "3mm" : 0,
                  color: isExtra ? "#333" : "#000",
                }}>
                  {item.trim()}
                </div>
              );
            })}
            <Dash />
            {/* Totale e pagamento */}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "10pt", marginBottom: "1mm" }}>
              <span>TOTALE</span><span>{euro(printOrder.total ?? 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "8pt" }}>
              <span>Pagamento</span>
              <strong>{printOrder.pay === "online" ? "✓ PAGATO" : "IN LOCO"}</strong>
            </div>
            <Dash />
            {/* Footer */}
            <div style={{ textAlign: "center", fontSize: "7pt", color: "#555" }}>Bite the East Side · La Rustica</div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- INCASSI ---------------- */
function IncassiSection() {
  const oggi = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(oggi);
  const [to, setTo]     = useState(oggi);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Carica gli ordini ogni volta che cambia il range
  useEffect(() => {
    if (from > to) { setLoadErr("La data iniziale è successiva a quella finale."); return; }
    setLoading(true); setLoadErr(null);
    fetchOrdersRange(from, to)
      .then(setOrders)
      .catch(() => setLoadErr("Errore nel caricamento degli ordini."))
      .finally(() => setLoading(false));
  }, [from, to]);

  const rows = [...orders].sort((a, b) => a.serviceKey.localeCompare(b.serviceKey) || a.readyMin - b.readyMin);
  const tot    = orders.reduce((s, o) => s + (o.total ?? 0), 0);
  const online = orders.filter((o) => o.pay === "online").reduce((s, o) => s + (o.total ?? 0), 0);
  const cassa  = tot - online;

  const dateInp: React.CSSProperties = { ...inp, padding: "9px 11px", fontSize: 13.5 };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      {/* Selettore range date — controlla sia la lista che l'export */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Dal</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={dateInp} />
        <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Al</span>
        <input type="date" value={to}   onChange={(e) => setTo(e.target.value)}   style={dateInp} />
        {from === oggi && to === oggi && <span style={{ fontSize: 12, color: C.muted }}>Oggi</span>}
        {(from !== oggi || to !== oggi) && (
          <button onClick={() => { setFrom(oggi); setTo(oggi); }}
            style={{ fontSize: 12, color: C.blue, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Torna a oggi
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
        <Money label="Incasso totale"     value={tot}    big />
        <Money label="Pagato online"      value={online} color={C.green} />
        <Money label="Incassato in cassa" value={cassa}  color={C.blue} />
      </div>

      {loading && <div style={{ color: C.muted, fontSize: 14, padding: "18px 0" }}>Caricamento…</div>}
      {loadErr && <div style={{ color: C.redline, fontSize: 13, marginBottom: 12 }}>{loadErr}</div>}

      {!loading && !loadErr && rows.length === 0 && (
        <div style={{ color: C.muted, fontSize: 14, padding: "18px 0" }}>Nessun incasso nel periodo selezionato.</div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", padding: "10px 14px", background: C.surface, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 700 }}>
            <span style={{ flex: 1 }}>Cliente</span>
            <span style={{ width: 130, textAlign: "center" }}>Servizio</span>
            <span style={{ width: 70,  textAlign: "center" }}>Pronto</span>
            <span style={{ width: 182, textAlign: "center" }}>Pagamento</span>
            <span style={{ width: 90,  textAlign: "right"  }}>Importo</span>
          </div>
          {rows.map((o, i) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, fontSize: 14 }}>
              <span style={{ flex: 1, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ color: C.muted, fontWeight: 700 }}>#{o.code ?? "—"}</span> {o.name}
              </span>
              <span style={{ width: 130, textAlign: "center", color: C.muted, fontSize: 12 }}>
                {o.serviceKey.slice(0, 10)} {o.serviceKey.split("-").slice(3).join("-")}
              </span>
              <span style={{ width: 70, textAlign: "center", color: C.muted }}>{fmt(o.readyMin)}</span>
              <span style={{ width: 182, textAlign: "center" }}>
                <PagamentoBadge pay={o.pay} tender={o.tender} />
              </span>
              <span style={{ width: 90, textAlign: "right", fontWeight: 700, color: C.blue }}>{euro(o.total ?? 0)}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderTop: `2px solid ${C.line}`, background: C.surface }}>
            <span style={{ flex: 1, fontWeight: 700 }}>Totale · {rows.length} {rows.length === 1 ? "ordine" : "ordini"}</span>
            <span style={{ width: 90, textAlign: "right", fontWeight: 800, color: C.blue }} className="arch">{euro(tot)}</span>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        "Online" = pagato dal cliente sul sito. "Cassa" = incassato al banco, con contanti o carta. La colonna a destra è l'importo di ciascun ordine.
      </div>

      <ExportPanel from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
    </div>
  );
}

/* ============================================================================
   Export del riepilogo gestionale.
   ⚠️ Non è una chiusura fiscale: serve a riconciliare gli incassi (contanti /
   carta / online) con la chiusura giornaliera del registratore telematico.
   ========================================================================== */
/* ============================================================================
   STATISTICHE
   ========================================================================== */
/* ============================================================================
   STATISTICHE — Analytics dashboard
   ========================================================================== */

/* ---------- helpers UI ---------- */

function delta(cur: number, prev: number | undefined): string | null {
  if (prev === undefined || prev === 0) return null;
  const pct = ((cur - prev) / prev) * 100;
  return (pct >= 0 ? "↑ " : "↓ ") + Math.abs(pct).toFixed(1) + "%";
}

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: string | null }) {
  const up = trend?.startsWith("↑");
  const down = trend?.startsWith("↓");
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 4 }}>{value}</div>
      {trend && <div style={{ fontSize: 12, fontWeight: 700, color: up ? C.green : down ? "#ef4444" : C.muted }}>{trend}</div>}
      {sub && !trend && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ value, max, color = C.blue }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ flex: 1, height: 7, background: C.line, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

function RankedList({ title, items, color }: { title: string; items: { name: string; qty: number; pct: number }[]; color?: string }) {
  const max = items[0]?.qty ?? 1;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{title}</div>
      {items.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nessun dato</div>}
      {items.map((item, i) => (
        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: C.muted, width: 14, textAlign: "right" }}>{i + 1}</span>
          <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
          <MiniBar value={item.qty} max={max} color={color} />
          <span style={{ fontSize: 12, color: C.muted, width: 28, textAlign: "right" }}>{item.qty}</span>
        </div>
      ))}
    </div>
  );
}

function StatisticheSection() {
  const oggi = localISODate(new Date());
  const [preset, setPreset] = useState<"oggi" | "7g" | "30g" | "90g" | "custom">("30g");
  const [customFrom, setCustomFrom] = useState(addDays(oggi, -29));
  const [customTo,   setCustomTo]   = useState(oggi);

  const { from, to } = useMemo(() => {
    if (preset === "oggi")   return { from: oggi, to: oggi };
    if (preset === "7g")     return { from: addDays(oggi, -6), to: oggi };
    if (preset === "30g")    return { from: addDays(oggi, -29), to: oggi };
    if (preset === "90g")    return { from: addDays(oggi, -89), to: oggi };
    return { from: customFrom, to: customTo };
  }, [preset, oggi, customFrom, customTo]);

  const prev = useMemo(() => prevPeriod(from, to), [from, to]);

  const [orders,     setOrders]     = useState<Order[]>([]);
  const [prevOrders, setPrevOrders] = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [err,        setErr]        = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    Promise.all([
      fetchOrdersRange(from, to),
      fetchOrdersRange(prev.from, prev.to),
    ]).then(([cur, p]) => { setOrders(cur); setPrevOrders(p); })
      .catch(() => setErr("Errore nel caricamento."))
      .finally(() => setLoading(false));
  }, [from, to, prev.from, prev.to]);

  const stats: Analytics = useMemo(
    () => computeAnalytics(orders, prevOrders, from, to),
    [orders, prevOrders, from, to],
  );

  const dateInp: React.CSSProperties = { ...inp, padding: "8px 10px", fontSize: 13 };
  const maxFat    = Math.max(...stats.trend.map(d => d.fat), 1);
  const maxSlot   = Math.max(...stats.slotRitiro.map(s => s.count), 1);
  const [addOnTab, setAddOnTab] = useState<"extra" | "salse" | "bibite">("extra");
  const [tooltip, setTooltip] = useState<{ day: typeof stats.trend[0]; x: number; y: number } | null>(null);
  const [dowTip,  setDowTip]  = useState<typeof stats.byDow[0] | null>(null);

  const PRESETS: { id: typeof preset; label: string }[] = [
    { id: "oggi", label: "Oggi" },
    { id: "7g",   label: "7 giorni" },
    { id: "30g",  label: "30 giorni" },
    { id: "90g",  label: "90 giorni" },
    { id: "custom", label: "Personalizzato" },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>

      {/* ── Filtro ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPreset(p.id)}
            style={{ padding: "7px 13px", borderRadius: 8, border: `1px solid ${preset === p.id ? C.blue : C.line}`,
                     background: preset === p.id ? C.blue : "#fff", color: preset === p.id ? "#fff" : C.ink,
                     fontWeight: preset === p.id ? 700 : 400, fontSize: 13, cursor: "pointer" }}>
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} style={dateInp} />
            <span style={{ fontSize: 12, color: C.muted }}>→</span>
            <input type="date" value={customTo} min={customFrom} onChange={e => setCustomTo(e.target.value)} style={dateInp} />
          </>
        )}
        {loading && <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>Caricamento…</span>}
        {err && <span style={{ fontSize: 12, color: "#ef4444" }}>{err}</span>}
      </div>

      {!loading && orders.length === 0 && !err && (
        <div style={{ color: C.muted, fontSize: 14, padding: "24px 0" }}>Nessun ordine nel periodo selezionato.</div>
      )}

      {!loading && orders.length > 0 && (<>

        {/* ── KPI ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
          <KpiCard label="Ordini"       value={String(stats.ordini)}      trend={delta(stats.ordini, stats.prevOrdini)} />
          <KpiCard label="Incasso"    value={euro(stats.fatturato)}     trend={delta(stats.fatturato, stats.prevFatturato)} />
          <KpiCard label="Ordine medio" value={euro(stats.scontrinoMedio)} trend={delta(stats.scontrinoMedio, stats.prevScontrinoMedio)} />
          <KpiCard label="Con menù"     value={`${Math.round(stats.quotaMenu * 100)}%`} trend={stats.prevQuotaMenu !== undefined ? delta(stats.quotaMenu, stats.prevQuotaMenu) : null} />
        </div>

        {/* ── Trend ── */}
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 16, position: "relative" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Andamento incassi</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100, position: "relative" }}>
            {stats.trend.map(d => {
              const h = maxFat > 0 ? Math.round((d.fat / maxFat) * 100) : 0;
              return (
                <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", cursor: "pointer" }}
                  onMouseEnter={e => setTooltip({ day: d, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}>
                  <div style={{ width: "100%", minWidth: 3, height: `${h}%`, minHeight: d.fat > 0 ? 3 : 0,
                    background: d.fat > 0 ? C.blue : C.line, borderRadius: "3px 3px 0 0",
                    opacity: tooltip?.day.date === d.date ? 0.7 : 1 }} />
                </div>
              );
            })}
          </div>
          {/* Etichette date: solo primo e ultimo */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 11, color: C.muted }}>{stats.trend[0]?.label}</span>
            <span style={{ fontSize: 11, color: C.muted }}>{stats.trend[stats.trend.length - 1]?.label}</span>
          </div>
          {/* Tooltip */}
          {tooltip && (
            <div style={{ position: "fixed", top: tooltip.y - 110, left: tooltip.x - 80, zIndex: 999,
              background: "#1e1e2e", color: "#fff", borderRadius: 10, padding: "10px 14px",
              fontSize: 12.5, lineHeight: 1.7, pointerEvents: "none", boxShadow: "0 4px 20px rgba(0,0,0,.3)" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{tooltip.day.label}</div>
              <div>Incasso <strong>{euro(tooltip.day.fat)}</strong></div>
              <div>Ordini <strong>{tooltip.day.ord}</strong></div>
              {tooltip.day.ord > 0 && <div>Ordine medio <strong>{euro(tooltip.day.avg)}</strong></div>}
            </div>
          )}
        </div>

        {/* ── Panini + Orari ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <RankedList title="🍔 Panini più venduti" items={stats.topPanini} color={C.blue} />

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>⏰ Orario di ritiro</div>
            {stats.oraPunta && (
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                🔥 Ora di punta: <strong>{stats.oraPunta}</strong>
                {stats.fasciaPunta && <> · Fascia intensa: <strong>{stats.fasciaPunta}</strong></>}
              </div>
            )}
            <div style={{ maxHeight: 170, overflowY: "auto" }}>
              {stats.slotRitiro.map(s => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: C.muted, width: 36 }}>{s.label}</span>
                  <MiniBar value={s.count} max={maxSlot} color="#f59e0b" />
                  <span style={{ fontSize: 12, fontWeight: 700, width: 22, textAlign: "right" }}>{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Extra / Salse / Bibite (box unico tabbato) + Giorno settimana ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {(() => {
            type AddOnTab = "extra" | "salse" | "bibite";
            const tabItems: Record<AddOnTab, { name: string; qty: number; pct: number }[]> = {
              extra:  stats.topExtras,
              salse:  stats.topSalse,
              bibite: stats.topBibite,
            };
            const tabColor: Record<AddOnTab, string> = {
              extra: "#10b981", salse: "#8b5cf6", bibite: "#0ea5e9",
            };
            const tabs: { id: AddOnTab; label: string }[] = [
              { id: "extra",  label: "Extra" },
              { id: "salse",  label: "Salse" },
              { id: "bibite", label: "Bibite" },
            ];
            return (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {tabs.map(t => (
                    <button key={t.id} onClick={() => setAddOnTab(t.id)}
                      style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${addOnTab === t.id ? tabColor[t.id] : C.line}`,
                               background: addOnTab === t.id ? tabColor[t.id] : "#fff",
                               color: addOnTab === t.id ? "#fff" : C.ink,
                               fontWeight: addOnTab === t.id ? 700 : 400, fontSize: 12.5, cursor: "pointer" }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {tabItems[addOnTab].length === 0
                  ? <div style={{ color: C.muted, fontSize: 13 }}>Nessun dato nel periodo.</div>
                  : tabItems[addOnTab].map((item, i) => {
                      const max = tabItems[addOnTab][0]?.qty ?? 1;
                      return (
                        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 11, color: C.muted, width: 14, textAlign: "right" }}>{i + 1}</span>
                          <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
                          <MiniBar value={item.qty} max={max} color={tabColor[addOnTab]} />
                          <span style={{ fontSize: 12, color: C.muted, width: 28, textAlign: "right" }}>{item.qty}</span>
                        </div>
                      );
                    })
                }
              </div>
            );
          })()}

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>📅 Per giorno della settimana</div>
            {stats.byDow.some(d => d.prevFat !== undefined) && (
              <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 11 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.blue, display: "inline-block" }} />Periodo</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.line, display: "inline-block" }} />Precedente</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
              {stats.byDow.map(d => {
                const maxAll = Math.max(...stats.byDow.map(x => Math.max(x.fat, x.prevFat ?? 0)), 1);
                const h     = Math.round((d.fat / maxAll) * 100);
                const hPrev = d.prevFat !== undefined ? Math.round((d.prevFat / maxAll) * 100) : null;
                const diff  = d.prevFat !== undefined && d.prevFat > 0
                  ? ((d.fat - d.prevFat) / d.prevFat * 100)
                  : null;
                return (
                  <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}
                    onMouseEnter={() => setDowTip(d)} onMouseLeave={() => setDowTip(null)}>
                    {/* Delta % */}
                    <div style={{ fontSize: 9, fontWeight: 700, color: diff === null ? "transparent" : diff >= 0 ? C.green : "#ef4444", marginBottom: 1 }}>
                      {diff !== null ? (diff >= 0 ? "+" : "") + diff.toFixed(0) + "%" : "·"}
                    </div>
                    {/* Barre affiancate */}
                    <div style={{ width: "100%", display: "flex", gap: 1, alignItems: "flex-end", height: 70 }}>
                      <div style={{ flex: 1, height: `${h}%`, minHeight: d.fat > 0 ? 3 : 0,
                        background: d.fat > 0 ? C.blue : C.line, borderRadius: "3px 3px 0 0",
                        opacity: dowTip?.label === d.label ? 0.75 : 1 }} />
                      {hPrev !== null && (
                        <div style={{ flex: 1, height: `${hPrev}%`, minHeight: (d.prevFat ?? 0) > 0 ? 3 : 0,
                          background: C.line, borderRadius: "3px 3px 0 0", opacity: 0.6 }} />
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>{d.label}</div>
                  </div>
                );
              })}
            </div>
            {dowTip && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: C.surface, borderRadius: 8, fontSize: 12.5, lineHeight: 1.7 }}>
                <strong>{dowTip.label}</strong>
                {" · "}Incasso: {euro(dowTip.fat)}
                {dowTip.prevFat !== undefined && <span style={{ color: C.muted }}> (prec. {euro(dowTip.prevFat)})</span>}
                {" · "}Ordini: {dowTip.ord}
                {dowTip.avg > 0 && ` · Media: ${euro(dowTip.avg)}`}
              </div>
            )}
          </div>
        </div>

        {/* ── Preferenze menù ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, gridColumn: "2" }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>🍟 Preferenze menù</div>
            {stats.menuTot === 0
              ? <div style={{ color: C.muted, fontSize: 13 }}>Nessun ordine con menù nel periodo.</div>
              : (<>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: C.muted }}>Patatine fritte</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>
                      {Math.round((1 - stats.pateDolciCount / stats.menuTot) * 100)}%
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: C.muted }}>Patate dolci (+1€)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>
                      {Math.round(stats.pateDolciCount / stats.menuTot * 100)}%
                    </div>
                  </div>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: C.line, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${(1 - stats.pateDolciCount / stats.menuTot) * 100}%`, background: C.blue }} />
                  <div style={{ flex: 1, background: "#f59e0b" }} />
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Su {stats.menuTot} menù ordinati</div>
              </>)
            }
          </div>
        </div>

      </>)}
    </div>
  );
}

function ExportPanel({ from, to, onFromChange, onToChange }: { from: string; to: string; onFromChange: (v: string) => void; onToChange: (v: string) => void }) {
  const [formato, setFormato] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const esporta = async () => {
    if (from > to) { setErr("La data iniziale è successiva a quella finale."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const orders = await fetchOrdersRange(from, to);
      if (!orders.length) { setErr("Nessun ordine nel periodo selezionato."); return; }
      const rows = buildRows(orders);
      const nome = `riepilogo-gestionale_${from}_${to}`;
      if (formato === "csv") downloadCSV(rows, nome);
      else await downloadXLSX(rows, summarize(orders), nome);
      setMsg(`Esportati ${orders.length} ordini.`);
    } catch (e) {
      console.error("[Cheebo] export", e);
      setErr("Export non riuscito. Controlla la connessione e riprova.");
    } finally { setBusy(false); }
  };

  const opt = (on: boolean): React.CSSProperties => ({
    flex: 1, padding: "10px 12px", borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${on ? C.blue : C.line}`, background: on ? C.blue : C.bg, color: on ? "#fff" : C.ink,
  });
  const dateInp: React.CSSProperties = { ...inp, padding: "9px 11px", fontSize: 13.5 };

  return (
    <div style={{ marginTop: 26, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3, display: "flex", alignItems: "center", gap: 7 }}>
        <Download size={16} /> Esporta riepilogo
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginBottom: 14 }}>
        Documento gestionale, <b>privo di valore fiscale</b>: la chiusura fiscale resta a carico del registratore telematico.
        Serve a confrontare gli incassi per metodo di pagamento con la chiusura dell'RT. Non contiene dati dei clienti.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 13 }}>
        <label style={{ flex: "1 1 150px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, fontWeight: 700, marginBottom: 5 }}>Dal</div>
          <input type="date" value={from} max={to} onChange={(e) => onFromChange(e.target.value)} style={dateInp} />
        </label>
        <label style={{ flex: "1 1 150px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, fontWeight: 700, marginBottom: 5 }}>Al</div>
          <input type="date" value={to} min={from} onChange={(e) => onToChange(e.target.value)} style={dateInp} />
        </label>
      </div>

      <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, fontWeight: 700, marginBottom: 6 }}>Formato</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 7 }}>
        <button onClick={() => setFormato("xlsx")} style={opt(formato === "xlsx")}>
          Excel (.xlsx)
          <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>Due fogli, importi sommabili</div>
        </button>
        <button onClick={() => setFormato("csv")} style={opt(formato === "csv")}>
          CSV
          <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.75, marginTop: 2 }}>Solo dettaglio, universale</div>
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 13, lineHeight: 1.45 }}>
        {formato === "xlsx"
          ? "Consigliato per il commercialista: foglio Dettaglio + foglio Riepilogo per servizio, con i totali già pronti."
          : "Da usare se il file va importato in un altro gestionale. Si apre in Excel italiano senza ritocchi."}
      </div>

      {err && <div style={{ color: C.redline, fontSize: 12.5, marginBottom: 9, fontWeight: 600 }}>{err}</div>}
      {msg && <div style={{ color: C.green, fontSize: 12.5, marginBottom: 9, fontWeight: 600 }}>{msg}</div>}

      <button onClick={esporta} disabled={busy} style={{ ...btn("primary"), width: "100%", padding: "13px", opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Preparazione…" : `Scarica ${formato === "xlsx" ? "Excel" : "CSV"}`}
      </button>
    </div>
  );
}
function Money({ label, value, color, big }: { label: string; value: number; color?: string; big?: boolean }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="arch" style={{ fontWeight: 800, fontSize: big ? 28 : 22, color: color ?? C.blue, lineHeight: 1 }}>{euro(value)}</div>
    </div>
  );
}

/* ---------------- MENU ---------------- */
type EditItem = MenuItem & { allergStr?: string; _new?: boolean };
type SpecialDraft = { serviceKeys: string[]; stock: number };
function MenuSection() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<EditItem | null>(null);
  const sessioni = useMemo(() => upcomingSessions(), []);
  useEffect(() => subscribeMenu(setItems, false), []);
  const activeCount = items.filter((i) => i.active).length;
  const blank = (type: MenuType): EditItem => isPanino(type)
    ? { id: "new_" + Date.now(), type, name: "", desc: "", solo: 0, menu: 0, veg: false, griddle: type === "smash", allergens: [], active: true, order: items.length, _new: true, allergStr: "" }
    : { id: "new_" + Date.now(), type, name: "", price: 0, active: true, order: items.length, _new: true };

  const save = async (e: EditItem) => {
    const { _new, allergStr, ...rest } = e;
    const base = { ...rest } as MenuItem;
    if (isPanino(e.type)) base.allergens = (allergStr ?? "").split(",").map((s) => Number(s.trim())).filter((x) => !Number.isNaN(x));
    else delete base.griddle; // il flag piastra non ha senso su sides/dolci/drink
    await saveItem(base);
    setEditing(null);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: C.muted }}>Le modifiche compaiono sul sito cliente in tempo reale</div>
        <div><span className="arch" style={{ fontWeight: 800, fontSize: 22, color: C.blue }}>{activeCount}</span> <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase" }}>attivi</span></div>
      </div>
      {SECTIONS.map((sec) => (
        <div key={sec.type}>
          <div className="arch" style={{ fontWeight: 900, fontSize: "clamp(26px,7vw,38px)", color: C.ghost, letterSpacing: -1, marginTop: 24, marginBottom: 6 }}>{sec.label}</div>
          {items.filter((i) => i.type === sec.type).map((it) =>
            editing?.id === it.id
              ? <EditForm key={it.id} item={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} sessioni={sessioni} onDelete={async () => { await removeItem(it.id); setEditing(null); }} />
              : <MenuRow key={it.id} item={it} onToggle={() => setActive(it.id, !it.active)} onEdit={() => setEditing({ ...it, griddle: occupiesGriddle(it), allergStr: (it.allergens ?? []).join(",") })} />
          )}
          {editing?._new && editing.type === sec.type && <EditForm item={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} sessioni={sessioni} />}
          {!(editing?._new && editing.type === sec.type) && <button onClick={() => setEditing(blank(sec.type))} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, color: C.blue, border: `1px dashed ${C.blue}`, borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%", marginTop: 10 }}>+ Aggiungi in {sec.label}</button>}
        </div>
      ))}
      <div style={{ marginTop: 26, padding: "13px 15px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        <b style={{ color: C.ink }}>Struttura standard automatica:</b> ogni panino è in formati Singolo · Doppio (+2€) · Triplo (+4€), con Solo panino / Menu e gli Extra.
      </div>
    </div>
  );
}
function MenuRow({ item, onToggle, onEdit }: { item: MenuItem; onToggle: () => void; onEdit: () => void }) {
  const off = !item.active;
  const panino = isPanino(item.type);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: `1px solid ${C.line}`, opacity: off ? 0.55 : 1 }}>
      <GripVertical size={16} color="#C7C7DA" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{item.name || "—"}</span>{item.veg && <Leaf size={13} color={C.veg} />}
          {off && <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: "1px 8px" }}>NON IN VENDITA</span>}
        </div>
        {panino && <div style={{ fontSize: 12, color: C.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.desc}</div>}
        <div style={{ fontSize: 12.5, color: item.special ? C.amber : C.blue, fontWeight: 600, marginTop: 3 }}>{item.special ? `★ special · ${euro(item.solo ?? 0)}` : panino ? `solo ${euro(item.solo ?? 0)} · menu ${euro(item.menu ?? 0)}` : euro(item.price ?? 0)}</div>
      </div>
      <Switch on={item.active} onClick={onToggle} />
      <button onClick={onEdit} style={{ width: 34, height: 34, borderRadius: 9, background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={15} color={C.ink} /></button>
    </div>
  );
}
/* Cosa manca perché la voce sia salvabile: lista vuota = si può salvare.
   Serve a SPIEGARE il blocco invece di limitarsi a disattivare il tasto, per
   qualsiasi tipo di voce. Lo special vive fuori menù, quindi il prezzo menu
   non è richiesto; conta solo il prezzo (`solo`) e almeno una sessione. */
function mancanzeVoce(item: EditItem): string[] {
  const m: string[] = [];
  if (!item.name.trim()) m.push("il nome");
  if (isPanino(item.type)) {
    if (!(Number(item.solo) > 0)) m.push(item.special ? "il prezzo dello special" : "il prezzo «solo»");
    if (!item.special && !(Number(item.menu) > 0)) m.push("il prezzo «menu»");
    if (item.special && item.special.serviceKeys.length === 0) m.push("almeno una sessione per lo special");
  } else if (!(Number(item.price) > 0)) {
    m.push("il prezzo");
  }
  return m;
}

function EditForm({ item, onChange, onSave, onCancel, onDelete, sessioni }: {
  item: EditItem; onChange: (e: EditItem) => void; onSave: (e: EditItem) => void;
  onCancel: () => void; onDelete?: () => void;
  /** sessioni proponibili per gli special */
  sessioni: UpcomingSession[];
}) {
  const set = (k: keyof EditItem, v: unknown) => onChange({ ...item, [k]: v } as EditItem);
  const panino = isPanino(item.type);
  const mancano = mancanzeVoce(item);
  const [provato, setProvato] = useState(false);
  // Non si blocca il tasto: al clic, se manca qualcosa lo si dice; altrimenti salva.
  const salva = () => { if (mancano.length) { setProvato(true); return; } onSave(item); };
  return (
    <div style={{ border: `1px solid ${C.blue}`, borderRadius: 12, padding: 16, marginTop: 12 }}>
      <Field label="Nome"><input value={item.name} onChange={(e) => set("name", e.target.value)} style={inp} /></Field>
      {panino ? (
        <>
          <Field label="Descrizione"><textarea value={item.desc ?? ""} onChange={(e) => set("desc", e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} /></Field>
          <div style={{ display: "flex", gap: 12 }}>
            <Field label="Prezzo solo (€)" flex><input value={String(item.solo ?? 0)} onChange={(e) => set("solo", Number(e.target.value.replace(",", ".")) || 0)} inputMode="decimal" style={inp} /></Field>
            <Field label="Prezzo menu (€)" flex><input value={String(item.menu ?? 0)} onChange={(e) => set("menu", Number(e.target.value.replace(",", ".")) || 0)} inputMode="decimal" style={inp} /></Field>
          </div>
          {item.special && <div style={{ fontSize: 11.5, color: "#8A5B12", marginTop: 4 }}>Lo special è <b>fuori menù</b>: conta il prezzo «solo». Il prezzo menu è facoltativo e, se lasciato a 0, viene ignorato.</div>}
          <Field label="Allergeni (es. 1,3,7)"><input value={item.allergStr ?? ""} onChange={(e) => set("allergStr", e.target.value)} style={inp} /></Field>
        </>
      ) : (
        <Field label="Prezzo (€)"><input value={String(item.price ?? 0)} onChange={(e) => set("price", Number(e.target.value.replace(",", ".")) || 0)} inputMode="decimal" style={inp} /></Field>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6, flexWrap: "wrap", rowGap: 10 }}>
        {panino && <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={!!item.veg} onClick={() => set("veg", !item.veg)} /> Vegetariano</label>}
        {panino && <label title="Se attivo, rientra nel limite della piastra (13 hamburger / 10 min). Se spento, ordinabile senza limiti." style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={!!item.griddle} onClick={() => set("griddle", !item.griddle)} /> Da piastra (smash)</label>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={item.active} onClick={() => set("active", !item.active)} /> Attivo sul sito</label>
        {panino && (
          <label title="Proposta a disponibilità limitata: attiva solo nelle sessioni scelte, con un numero di pezzi per sessione."
                 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}>
            <Switch on={!!item.special} onClick={() => set("special", item.special ? undefined : { serviceKeys: [], stock: 20 } as SpecialDraft)} /> Special (pezzi limitati)
          </label>
        )}
      </div>

      {item.special && (
        <div style={{ marginTop: 14, background: "#FFF6E9", border: "1px solid #F2D9AE", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: "#8A5B12", marginBottom: 9 }}>★ Configurazione special</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ flex: "0 0 120px" }}>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>Pezzi per sessione</div>
              <input type="number" min={1} max={200} value={item.special.stock}
                onChange={(e) => set("special", { ...item.special!, stock: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
                style={inp} />
            </label>
            <div style={{ flex: "1 1 300px" }}>
              <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>Attivo in queste sessioni</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto" }}>
                {Object.entries(sessioni.reduce((acc, sess) => {
                  (acc[sess.dayLabel] ??= []).push(sess);
                  return acc;
                }, {} as Record<string, UpcomingSession[]>)).map(([giorno, delGiorno]) => (
                  <div key={giorno} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 74, flexShrink: 0, fontSize: 12, fontWeight: 700, color: C.ink }}>{giorno}</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {delGiorno.map((sess) => {
                        const on = item.special!.serviceKeys.includes(sess.serviceKey);
                        return (
                          <button key={sess.serviceKey} title={sess.serviceKey} onClick={() => set("special", {
                              ...item.special!,
                              serviceKeys: on ? item.special!.serviceKeys.filter((k) => k !== sess.serviceKey)
                                              : [...item.special!.serviceKeys, sess.serviceKey],
                            })}
                            style={{ cursor: "pointer", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
                                     background: on ? C.blue : C.bg, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}` }}>
                            {sess.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "#8A5B12", marginTop: 10, lineHeight: 1.45 }}>
            I pezzi valgono <b>per singola sessione</b>: ogni servizio riparte dal numero indicato.
            Finito lo stock, lo special appare "esaurito" e non è più ordinabile.
            {item.special.serviceKeys.length === 0
              ? <><br /><b>Nessuna sessione selezionata: lo special non comparirà.</b></>
              : <><br />Selezionate: <b>{item.special.serviceKeys.map((k) => {
                    const sx = sessioni.find((x) => x.serviceKey === k);
                    return sx ? `${sx.dayLabel} · ${sx.label.toLowerCase()}` : k;
                  }).join(" — ")}</b></>}
          </div>
        </div>
      )}
      {provato && mancano.length > 0 && (
        <div style={{ marginTop: 14, background: "#FFF4F0", border: `1px solid #F3C9BC`, color: C.redline, borderRadius: 10, padding: "10px 13px", fontSize: 12.5, lineHeight: 1.45 }}>
          Per salvare manca ancora: <b>{mancano.join(", ")}</b>.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={salva} style={{ ...btn("primary"), display: "flex", alignItems: "center", gap: 6 }}><Check size={15} /> Salva</button>
        <button onClick={onCancel} style={{ ...btn("soft"), display: "flex", alignItems: "center", gap: 6 }}><X size={15} /> Annulla</button>
        {onDelete && <button onClick={onDelete} style={{ marginLeft: "auto", background: "none", color: C.danger, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Trash2 size={15} /> Elimina</button>}
      </div>
    </div>
  );
}

/* ---------------- login ---------------- */
function Login() {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null);
  const go = async () => { setErr(null); try { await signInWithEmailAndPassword(auth, email, pw); } catch { setErr("Credenziali non valide."); } };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=Inter:wght@400;600;700&display=swap');.arch{font-family:'Archivo',sans-serif}`}</style>
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, width: 320 }}>
        <div className="arch" style={{ fontWeight: 900, fontSize: 26, color: C.blue, marginBottom: 4 }}>CHEEBO</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Accesso gestionale</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ ...inp, marginBottom: 10 }} />
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="Password" onKeyDown={(e) => e.key === "Enter" && go()} style={{ ...inp, marginBottom: 14 }} />
        {err && <div style={{ color: C.danger, fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
        <button onClick={go} style={{ ...btn("primary"), width: "100%" }}>Entra</button>
      </div>
    </div>
  );
}

/* ---------------- shared ---------------- */
function Center({ children }: { children: React.ReactNode }) { return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontFamily: "Inter, sans-serif" }}>{children}</div>; }
function NavTab({ label, icon, on, onClick }: { label: string; icon: React.ReactNode; on: boolean; onClick: () => void }) { return <button onClick={onClick} style={{ background: "none", border: "none", borderBottom: `3px solid ${on ? C.blue : "transparent"}`, color: on ? C.blue : C.muted, padding: "9px 14px", fontSize: 14.5, fontWeight: 700, cursor: "pointer", marginBottom: -1, display: "flex", alignItems: "center", gap: 7 }}>{icon}{label}</button>; }
function Stat({ n, label }: { n: React.ReactNode; label: string }) { return <div style={{ textAlign: "right" }}><div className="arch" style={{ fontWeight: 800, fontSize: 24, color: C.blue, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>{label}</div></div>; }
/* Badge del pagamento, condiviso da Ordini e Incassi così le due schede non
   divergono. L'icona segue il metodo: banconota = contanti, carta = carta,
   scontrino = cassa senza dettaglio. */
function PagamentoBadge({ pay, tender, small }: { pay: PayMethod; tender?: Tender; small?: boolean }) {
  const s = small
    ? { font: 10.5, ic: 12, pad: "4px 10px", gap: 6 }
    : { font: 12, ic: 13, pad: "5px 12px", gap: 7 };
  if (pay === "online")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: s.gap, fontSize: s.font, fontWeight: 700, color: "#fff", background: C.green, borderRadius: 20, padding: s.pad, whiteSpace: "nowrap", letterSpacing: 0.4 }}>
        <Check size={s.ic} /> Online
      </span>
    );
  const Ic = tender === "carta" ? CreditCard : tender === "contanti" ? Banknote : Receipt;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: s.gap, fontSize: s.font, fontWeight: 600, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: s.pad, whiteSpace: "nowrap", letterSpacing: 0.4 }}>
      <Ic size={s.ic} /> Cassa
      {tender && <><span style={{ opacity: 0.4 }}>·</span><span style={{ textTransform: "capitalize" }}>{tender}</span></>}
    </span>
  );
}
function Badge({ children, color }: { children: React.ReactNode; color: string }) { return <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: color, borderRadius: 20, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</span>; }
function Dash() { return <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />; }
function Switch({ on, onClick }: { on: boolean; onClick: () => void }) { return <button onClick={onClick} role="switch" aria-checked={on} style={{ width: 42, height: 24, borderRadius: 20, border: "none", background: on ? C.blue : "#CFCFE0", position: "relative", cursor: "pointer", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff" }} /></button>; }
function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) { return <div style={{ marginBottom: 12, flex: flex ? 1 : undefined, minWidth: 0 }}><div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 600, marginBottom: 5 }}>{label}</div>{children}</div>; }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 20, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const btn = (kind: "primary" | "soft"): React.CSSProperties => kind === "primary" ? { background: C.blue, color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" } : { background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.ink, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" };
