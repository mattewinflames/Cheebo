import { useState, useEffect, useMemo } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { upcomingSessions, resolveService, type UpcomingSession } from "../lib/schedule";
import { CAP, totalWindows, windowStartMin, windowEndMin, fmt, type Service } from "../lib/dispatch";
import { subscribeOrders, subscribeLedger, setStatus, clearSession, type Order, type OrderStatus } from "../lib/orders";
import { subscribeMenu, saveItem, setActive, removeItem } from "../lib/menuStore";
import { euro, isPanino, occupiesGriddle, type MenuItem, type MenuType } from "../lib/menu";
import { ClipboardList, UtensilsCrossed, LogOut, Flame, Clock, Printer, Check, ChevronRight, Store, Pencil, Trash2, X, GripVertical, Leaf, RotateCcw, Wallet, Calendar, ChevronDown } from "lucide-react";

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
const SECTIONS: { type: MenuType; label: string }[] = [{ type: "smash", label: "Smashburgers" }, { type: "burger", label: "Burgers" }, { type: "side", label: "Sides" }, { type: "dolce", label: "Dolci" }, { type: "drink", label: "Drinks" }];

export default function Admin() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);
  useEffect(() => { document.title = "Cheebo Admin"; }, []);
  if (user === undefined) return <Center>Caricamento…</Center>;
  if (!user) return <Login />;
  return <AdminShell onLogout={() => signOut(auth)} />;
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"ordini" | "incassi" | "menu">("ordini");
  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');
        .arch{font-family:'Archivo',system-ui,sans-serif}::placeholder{color:#a8a8be}*:focus-visible{outline:2px solid ${C.blue};outline-offset:2px}
        .cols{display:grid;grid-template-columns:380px 1fr;gap:20px;align-items:start}.piastra{position:sticky;top:20px}
        @media(max-width:860px){.cols{grid-template-columns:1fr}.piastra{position:static}}
        .comanda-print{display:none}@media print{body *{visibility:hidden!important}.comanda-print{display:block!important;visibility:visible!important;position:absolute;left:0;top:0;width:100%}.comanda-print *{visibility:visible!important}}`}</style>
      <div className="screen">
        <div style={{ position: "sticky", top: 0, background: C.bg, zIndex: 6, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ maxWidth: 1140, margin: "0 auto", padding: "16px 20px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}><img src="/cheebo-logo.png" alt="Cheebo" width={38} height={38} /><div className="arch" style={{ fontWeight: 900, fontSize: 26, color: C.blue }}>CHEEBO <span style={{ color: C.muted, fontWeight: 700 }}>Admin</span></div></div>
              <button onClick={onLogout} style={{ ...btn("soft"), display: "flex", alignItems: "center", gap: 6 }}><LogOut size={14} /> Esci</button>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
              <NavTab icon={<ClipboardList size={16} />} label="Ordini" on={tab === "ordini"} onClick={() => setTab("ordini")} />
              <NavTab icon={<Wallet size={16} />} label="Incassi" on={tab === "incassi"} onClick={() => setTab("incassi")} />
              <NavTab icon={<UtensilsCrossed size={16} />} label="Menu" on={tab === "menu"} onClick={() => setTab("menu")} />
            </div>
          </div>
        </div>
        <div style={{ maxWidth: 1140, margin: "0 auto", padding: "20px 20px 60px", position: "relative" }}>
          <img src="/cheebo-logo.png" alt="" aria-hidden="true" style={{ position: "fixed", left: "50%", top: "55%", transform: "translate(-50%,-50%)", width: "min(70vw,560px)", opacity: 0.04, pointerEvents: "none", zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1 }}>
          {tab === "ordini" ? <OrdiniSection /> : tab === "incassi" ? <IncassiSection /> : <MenuSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

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
              {days.map((d) => {
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

  useEffect(() => {
    if (!sessionKey) return;
    setLoadErr(null);
    return subscribeOrders(sessionKey, (o) => { setOrders(o); setLoadErr(null); },
      () => setLoadErr("Impossibile caricare gli ordini. Controlla la connessione e riprova."));
  }, [sessionKey]);
  useEffect(() => { if (service && sessionKey) return subscribeLedger(sessionKey, totalWindows(service), setLedger); }, [sessionKey, service?.startMin]);
  useEffect(() => { const after = () => setPrintOrder(null); window.addEventListener("afterprint", after); return () => window.removeEventListener("afterprint", after); }, []);
  const doPrint = (o: Order) => { setPrintOrder(o); requestAnimationFrame(() => requestAnimationFrame(() => window.print())); };
  const [clearing, setClearing] = useState(false);
  const doClear = async () => {
    if (!window.confirm(`Cancellare TUTTI gli ordini di "${session?.dayLabel} ${session?.label}" e azzerare la piastra?\n\nOperazione di test, non reversibile.`)) return;
    setClearing(true);
    try { const k = sessionKey; await clearSession(k); } finally { setClearing(false); }
  };

  if (!service) return <div style={{ color: C.muted }}>Nessun servizio disponibile.</div>;
  const n = totalWindows(service);
  const fill = ledger.length ? ledger : new Array(n).fill(0);
  const lastUsed = fill.reduce((a, v, i) => (v > 0 ? i : a), -1);
  const shown = Math.min(n, Math.max(lastUsed + 2, 5));
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const curWi = nowMin >= service.startMin && nowMin < service.endMin ? Math.floor((nowMin - service.startMin) / 10) : -1;
  const totalPatty = orders.reduce((s, o) => s + o.patties, 0);
  const counts = orders.reduce<Record<string, number>>((m, o) => ((m[o.status] = (m[o.status] || 0) + 1), m), {});
  const visible = orders.filter((o) => filter === "tutti" || (filter === "dafare" ? (o.status === "nuovo" || o.status === "in_consegna") : o.status === filter));

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <SessionPicker sessions={sessions} value={sessionKey} onChange={setSessionKey} />
        <div style={{ flex: 1 }} />
        <button onClick={doClear} disabled={clearing || orders.length === 0} title="Solo per i test — cancella gli ordini della sessione" style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFF4F0", color: C.redline, border: `1px solid #F3C9BC`, borderRadius: 9, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: clearing || orders.length === 0 ? "default" : "pointer", opacity: clearing || orders.length === 0 ? 0.5 : 1 }}><RotateCcw size={14} /> {clearing ? "Pulizia…" : "Pulisci (test)"}</button>
        <Stat n={orders.length} label="ordini" /><Stat n={totalPatty} label="patty" />
        {curWi >= 0 && <Stat n={`${fill[curWi] ?? 0}/${CAP}`} label={`finestra ${fmt(windowStartMin(service, curWi))}`} />}
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
                        {o.pay === "online" ? <Badge color={C.green}><Check size={10} style={{ marginRight: 2, verticalAlign: "-1px" }} />Pagato</Badge> : <span style={{ fontSize: 10.5, fontWeight: 600, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}><Store size={10} /> In loco</span>}
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
                    <button onClick={() => doPrint(o)} style={{ ...btn("soft"), display: "flex", alignItems: "center", gap: 6 }}><Printer size={15} /> Stampa comanda</button>
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#000", maxWidth: 300, padding: 14, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>CHEEBO</div>
            <div style={{ textAlign: "center", fontSize: 11 }}>COMANDA CUCINA</div>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: 26, margin: "4px 0" }}>RITIRO #{printOrder.code ?? "—"}</div><Dash />
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Cliente:</span><strong>{printOrder.name.toUpperCase()}</strong></div>
            {printOrder.phone && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Tel:</span><strong>{printOrder.phone}</strong></div>}
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Pronto:</span><strong style={{ fontSize: 18 }}>{fmt(printOrder.readyMin)}</strong></div><Dash />
            {printOrder.items.map((i, k) => <div key={k} style={{ fontWeight: 700, marginBottom: 4 }}>{i}</div>)}<Dash />
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>PATTY TOTALI</span><span>{printOrder.patties}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, marginTop: 4 }}><span>TOTALE</span><span>{euro(printOrder.total ?? 0)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}><span>Pagamento:</span><strong>{printOrder.pay === "online" ? "PAGATO" : "IN LOCO"}</strong></div><Dash />
            <div style={{ textAlign: "center", fontSize: 10 }}>Bite the East Side · La Rustica</div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- INCASSI ---------------- */
function IncassiSection() {
  const sessions = useMemo(() => upcomingSessions(), []);
  const active = useMemo(() => resolveService(), []);
  const [sessionKey, setSessionKey] = useState(active?.serviceKey ?? sessions[0]?.serviceKey ?? "");
  const session = sessions.find((s) => s.serviceKey === sessionKey) ?? sessions[0];
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => { if (sessionKey) return subscribeOrders(sessionKey, setOrders); }, [sessionKey]);

  const rows = [...orders].sort((a, b) => a.readyMin - b.readyMin);
  const tot = orders.reduce((s, o) => s + (o.total ?? 0), 0);
  const online = orders.filter((o) => o.pay === "online").reduce((s, o) => s + (o.total ?? 0), 0);
  const loco = tot - online;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <SessionPicker sessions={sessions} value={sessionKey} onChange={setSessionKey} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
        <Money label="Incasso totale" value={tot} big />
        <Money label="Pagato online" value={online} color={C.green} />
        <Money label="Da incassare in loco" value={loco} color={C.amber} />
      </div>

      {rows.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 14, padding: "18px 0" }}>Nessun incasso per questo servizio.</div>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", padding: "10px 14px", background: C.surface, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 700 }}>
            <span style={{ flex: 1 }}>Cliente</span><span style={{ width: 70, textAlign: "center" }}>Pronto</span><span style={{ width: 120, textAlign: "center" }}>Pagamento</span><span style={{ width: 90, textAlign: "right" }}>Importo</span>
          </div>
          {rows.map((o, i) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, fontSize: 14 }}>
              <span style={{ flex: 1, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><span style={{ color: C.muted, fontWeight: 700 }}>#{o.code ?? "—"}</span> {o.name}</span>
              <span style={{ width: 70, textAlign: "center", color: C.muted }}>{fmt(o.readyMin)}</span>
              <span style={{ width: 120, textAlign: "center" }}>
                {o.pay === "online"
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#fff", background: C.green, borderRadius: 20, padding: "2px 9px" }}><Check size={11} /> Online</span>
                  : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: "2px 9px" }}><Store size={11} /> In loco</span>}
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
        "Online" = già pagato (Nexi). "In loco" = da saldare al banco. La colonna a destra è quanto ha pagato (o pagherà) ciascun cliente.
      </div>
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
function MenuSection() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<EditItem | null>(null);
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
              ? <EditForm key={it.id} item={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} onDelete={async () => { await removeItem(it.id); setEditing(null); }} />
              : <MenuRow key={it.id} item={it} onToggle={() => setActive(it.id, !it.active)} onEdit={() => setEditing({ ...it, griddle: occupiesGriddle(it), allergStr: (it.allergens ?? []).join(",") })} />
          )}
          {editing?._new && editing.type === sec.type && <EditForm item={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />}
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
        <div style={{ fontSize: 12.5, color: C.blue, fontWeight: 600, marginTop: 3 }}>{panino ? `solo ${euro(item.solo ?? 0)} · menu ${euro(item.menu ?? 0)}` : euro(item.price ?? 0)}</div>
      </div>
      <Switch on={item.active} onClick={onToggle} />
      <button onClick={onEdit} style={{ width: 34, height: 34, borderRadius: 9, background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={15} color={C.ink} /></button>
    </div>
  );
}
function EditForm({ item, onChange, onSave, onCancel, onDelete }: { item: EditItem; onChange: (e: EditItem) => void; onSave: (e: EditItem) => void; onCancel: () => void; onDelete?: () => void }) {
  const set = (k: keyof EditItem, v: unknown) => onChange({ ...item, [k]: v } as EditItem);
  const panino = isPanino(item.type);
  const valid = !!item.name.trim() && (panino ? Number(item.solo) > 0 && Number(item.menu) > 0 : Number(item.price) > 0);
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
          <Field label="Allergeni (es. 1,3,7)"><input value={item.allergStr ?? ""} onChange={(e) => set("allergStr", e.target.value)} style={inp} /></Field>
        </>
      ) : (
        <Field label="Prezzo (€)"><input value={String(item.price ?? 0)} onChange={(e) => set("price", Number(e.target.value.replace(",", ".")) || 0)} inputMode="decimal" style={inp} /></Field>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6, flexWrap: "wrap", rowGap: 10 }}>
        {panino && <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={!!item.veg} onClick={() => set("veg", !item.veg)} /> Vegetariano</label>}
        {panino && <label title="Se attivo, rientra nel limite della piastra (13 hamburger / 10 min). Se spento, ordinabile senza limiti." style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={!!item.griddle} onClick={() => set("griddle", !item.griddle)} /> Da piastra (smash)</label>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}><Switch on={item.active} onClick={() => set("active", !item.active)} /> Attivo sul sito</label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => onSave(item)} disabled={!valid} style={{ ...btn("primary"), opacity: valid ? 1 : 0.5, display: "flex", alignItems: "center", gap: 6 }}><Check size={15} /> Salva</button>
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
function Badge({ children, color }: { children: React.ReactNode; color: string }) { return <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: color, borderRadius: 20, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</span>; }
function Dash() { return <div style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />; }
function Switch({ on, onClick }: { on: boolean; onClick: () => void }) { return <button onClick={onClick} role="switch" aria-checked={on} style={{ width: 42, height: 24, borderRadius: 20, border: "none", background: on ? C.blue : "#CFCFE0", position: "relative", cursor: "pointer", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff" }} /></button>; }
function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) { return <div style={{ marginBottom: 12, flex: flex ? 1 : undefined, minWidth: 0 }}><div style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.muted, fontWeight: 600, marginBottom: 5 }}>{label}</div>{children}</div>; }
const chip = (on: boolean): React.CSSProperties => ({ background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 20, padding: "6px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const btn = (kind: "primary" | "soft"): React.CSSProperties => kind === "primary" ? { background: C.blue, color: "#fff", border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" } : { background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, color: C.ink, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" };
