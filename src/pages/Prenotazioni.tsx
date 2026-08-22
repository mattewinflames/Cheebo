import { useState, useEffect, useMemo } from "react";
import { upcomingSessions, minWindowNow } from "../lib/schedule";
import {
  FORMATS, EXTRA, euro, ingredientsOf, menuDrinkSurcharge,
  cartKey, cartPrice, cartLineOf,
  cartItemStrings, cartPatties, cartTotal, cartSpecials, specialCartLine, isSpecialActive, specialLeft, SPECIAL_LOW,
  type FormatId, type CartType, type CartLine, type MenuItem, type PaninoConfig, type CartReq,
} from "../lib/menu";
import { totalWindows, planFirst, planAt, firstFeasibleWindow, windowEndMin, fmt, type Service } from "../lib/dispatch";
import { subscribeMenu } from "../lib/menuStore";
import { subscribeSettings, DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { submitBooking, startCheckout, subscribeLedger, PAY_ENABLED, PAY_DEFAULT, type BookingMode, type PayMethod } from "../lib/orders";
import { buildConfirmMessage, waLink } from "../lib/whatsapp";
import { createPortal } from "react-dom";
import { Leaf, ShoppingBag, Trash2 } from "lucide-react";

const C = {
  bg: "#FFFFFF", surface: "#F5F5FB", line: "#E8E8F2",
  blue: "#2E2C8B", ghost: "#E3E2F4", ink: "#1B1B47", muted: "#8786A4", veg: "#1E9E57", wa: "#25D366",
  amber: "#E1902F", amberbg: "#FFF6E9", amberline: "#F2D9AE", red: "#C8321B",
};
type Choice = "first" | { window: number; readyMin: number } | null;

export default function Prenotazioni() {
  const [step, setStep] = useState<"menu" | "quando" | "conferma" | "pagamento" | "done">("menu");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const sessions = useMemo(
    () => upcomingSessions(new Date(), undefined, { blocked: settings.bookingBlocked, closedDays: settings.closedDays }),
    [settings.bookingBlocked, settings.closedDays],
  );
  const [sessionKey, setSessionKey] = useState(sessions[0]?.serviceKey ?? "");
  const [ledger, setLedger] = useState<number[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [choice, setChoice] = useState<Choice>(null);
  const [result, setResult] = useState<{ readyMin: number; tranches: number; proposedDifferent: boolean; code: number } | null>(null);
  const [pay, setPay] = useState<PayMethod | null>(PAY_DEFAULT);

  const session = sessions.find((s) => s.serviceKey === sessionKey);
  const service: Service | null = session ? { startMin: session.startMin, endMin: session.endMin, label: session.label } : null;

  useEffect(() => subscribeMenu(setMenu, true), []);
  useEffect(() => subscribeSettings(setSettings), []);
  // se la sessione scelta sparisce (giorno chiuso / blocco attivato), riallinea
  useEffect(() => {
    if (sessions.length && !sessions.some((s) => s.serviceKey === sessionKey)) {
      setSessionKey(sessions[0].serviceKey);
    }
  }, [sessions, sessionKey]);
  useEffect(() => {
    if (!service || !sessionKey) return;
    return subscribeLedger(sessionKey, totalWindows(service), (l, st) => { setLedger(l); setStock(st); });
  }, [sessionKey, service?.startMin, service?.endMin]);

  const lines = Object.values(cart).filter((v) => v.qty > 0);
  const count = lines.reduce((s, v) => s + v.qty, 0);
  const total = cartTotal(lines);
  const serviceCharge = (settings.costoServizioAttivo && settings.costoServizio > 0) ? settings.costoServizio : 0;
  const totalConServizio = Math.round((total + serviceCharge) * 100) / 100;
  // special proposti in questa sessione (escono dalle sezioni normali)
  const specials = useMemo(
    () => menu.filter((m) => m.active && isSpecialActive(m, sessionKey)),
    [menu, sessionKey],
  );

  // bibite selezionabili dentro un menu, ordinate per sovrapprezzo crescente
  const drinks = useMemo(
    () => menu.filter((d) => d.type === "drink" && d.active)
              .sort((a, b) => menuDrinkSurcharge(a) - menuDrinkSurcharge(b) || a.order - b.order),
    [menu],
  );
  const patties = cartPatties(lines);

  const setQty = (key: string, data: Omit<CartLine, "qty">, qty: number) =>
    setCart((c) => { const n = { ...c }; if (qty <= 0) delete n[key]; else n[key] = { ...data, qty }; return n; });
  const bump = (key: string, data: Omit<CartLine, "qty">, d: number) => setQty(key, data, (cart[key]?.qty || 0) + d);
  const setLineQty = (line: CartLine, qty: number) => { const { qty: _q, ...rest } = line; setQty(line.key, rest, qty); };

  // Chiude il riepilogo se il carrello si svuota e blocca lo scroll di sfondo mentre è aperto
  useEffect(() => { if (cartOpen && lines.length === 0) setCartOpen(false); }, [cartOpen, lines.length]);
  useEffect(() => {
    if (!cartOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [cartOpen]);

  const slots = useMemo(() => {
    if (!service) return [] as { window: number; readyMin: number; full: boolean }[];
    const n = totalWindows(service);
    const minW = minWindowNow(sessionKey, service); // scarta le finestre già passate se è oggi
    const firstOk = firstFeasibleWindow(ledger, patties, minW); // patties=0 -> minW (nessun limite di piastra)
    const out: { window: number; readyMin: number; full: boolean }[] = [];
    for (let w = minW; w < n; w++) {
      out.push({ window: w, readyMin: windowEndMin(service, w), full: firstOk < 0 || w < firstOk });
    }
    return out;
  }, [ledger, patties, service?.startMin, sessionKey]);
  const firstSlot = slots.find((s) => !s.full);

  const preview = useMemo(() => {
    if (!service) return null;
    const minW = minWindowNow(sessionKey, service);
    if (choice === "first" || choice === null) return planFirst(ledger, patties, service, minW);
    const p = planAt(ledger, patties, choice.window, service, minW);
    return p.ok ? p : planFirst(ledger, patties, service, minW);
  }, [choice, ledger, patties, service?.startMin, sessionKey]);

  const commit = async () => {
    if (!service || !session) return;
    setBusy(true); setErr(null);
    try {
      const method = pay ?? PAY_ENABLED[0];

      if (method === "online") {
        // La prenotazione passa dal server (#41): manda solo la CONFIGURAZIONE,
        // mai i prezzi. Il server ricalcola, occupa lo slot con un hold e apre
        // Stripe; noi reindirizziamo. La conferma arriva poi dal webhook.
        const active = lines.filter((l) => l.qty > 0);
        const reqCart = active.filter((l) => l.req).map((l) => ({ ...(l.req as CartReq), qty: l.qty }));
        if (reqCart.length !== active.length) { setErr("Qualcosa nel carrello non è valido. Ricarica la pagina e riprova."); return; }

        const res = await startCheckout({
          serviceKey: sessionKey,
          name: name.trim() || "Cliente",
          mode: (choice === "first" || choice === null ? "first" : "at"),
          targetWindow: choice && choice !== "first" ? choice.window : undefined,
          cart: reqCart,
        });

        if (res.ok) { window.location.href = res.url; return; } // via verso Stripe
        if (res.itemId) setErr(res.left ? `Ne restano solo ${res.left}: riduci la quantità e riprova.` : "Lo special è appena andato esaurito.");
        else if (res.error === "piastra al completo") setErr("Per questo servizio la piastra è al completo. Prova un altro giorno.");
        else setErr(res.error || "Non è stato possibile avviare il pagamento. Riprova.");
        return;
      }

      // Fallback pagamento in loco (oggi disattivato lato cliente): percorso
      // diretto storico. Con le regole chiuse (#41) funziona solo sotto admin.
      const res = await submitBooking({
        serviceKey: sessionKey, service, name: name.trim() || "Cliente",
        items: cartItemStrings(lines), patties,
        mode: (choice === "first" ? "first" : "at") as BookingMode,
        targetWindow: choice && choice !== "first" ? choice.window : undefined,
        pay: method,
        total: totalConServizio,
        phone: "",
        specials: cartSpecials(lines),
      });
      if (res.ok) { setResult({ readyMin: res.readyMin, tranches: res.tranches, proposedDifferent: res.proposedDifferent, code: res.code }); setStep("done"); }
      else if (res.reason === "special")
        setErr(res.left ? `Ne restano solo ${res.left}: riduci la quantità e riprova.` : "Lo special è appena andato esaurito.");
      else setErr("Per questo servizio la piastra è al completo. Prova un altro giorno.");
    } catch (e) {
      setErr("Errore di connessione. Riprova.");
    } finally { setBusy(false); }
  };

  const waHref = result && session
    ? waLink(buildConfirmMessage(name || "Cliente", `${session.dayLabel} ${session.dateLabel}`, fmt(result.readyMin), cartItemStrings(lines), pay === "online", result.code))
    : "#";

  const reset = () => { setCart({}); setName(""); setChoice(null); setResult(null); setPay(PAY_DEFAULT); setStep("menu"); };

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Inter:wght@400;500;600;700&display=swap');
        body{font-family:'Inter',system-ui,sans-serif}
        .arch{font-family:'Archivo',system-ui,sans-serif}::placeholder{color:#a8a8be}*:focus-visible{outline:2px solid ${C.blue};outline-offset:2px}
        .wm{position:fixed;left:50%;top:55%;transform:translate(-50%,-50%);width:min(82vw,460px);opacity:.05;pointer-events:none;z-index:0}
        @media(max-width:640px){.wm{position:absolute;top:40%}}
        .cb-scrim{position:fixed;inset:0;background:rgba(20,20,45,.42);z-index:50;animation:cbfade .18s ease}
        @keyframes cbfade{from{opacity:0}to{opacity:1}}
        .cb-panel{position:fixed;z-index:51;background:#fff;display:flex;flex-direction:column;left:0;right:0;bottom:0;border-radius:20px 20px 0 0;max-height:88vh;box-shadow:0 -8px 40px rgba(27,27,71,.2);animation:cbup .28s cubic-bezier(.2,.8,.2,1)}
        @keyframes cbup{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .cb-grab{width:42px;height:5px;border-radius:3px;background:#d7d7e3;margin:10px auto 2px}
        .cb-close{position:absolute;top:12px;right:14px;width:32px;height:32px;border:none;background:var(--sf,#F5F5FB);border-radius:8px;cursor:pointer;font-size:15px;color:#8786A4;z-index:2}
        @media(min-width:640px){
          .cb-panel{left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);width:min(460px,92vw);border-radius:18px;box-shadow:0 30px 70px rgba(27,27,71,.35);animation:cbpop .2s ease}
          @keyframes cbpop{from{opacity:0;transform:translate(-50%,-50%) scale(.94)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
          .cb-grab{display:none}
        }`}</style>

      {step === "menu" && (
        <div style={{ maxWidth: 580, margin: "0 auto", paddingBottom: count ? 92 : 24 }}>
          <header style={{ position: "sticky", top: 0, background: C.bg, zIndex: 5, padding: "20px 18px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14 }}>
            <img src="/cheebo-logo.png" alt="Cheebo" width={56} height={56} style={{ flexShrink: 0 }} />
            <div>
              <div className="arch" style={{ fontWeight: 900, fontSize: 34, color: C.blue, lineHeight: 1 }}>CHEEBO</div>
              <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: C.muted, marginTop: 4 }}>Bite the East Side · Proudly made in La Rustica</div>
            </div>
          </header>
          <div style={{ padding: "0 18px", position: "relative" }}>
            <img src="/cheebo-logo.png" alt="" aria-hidden="true" className="wm" />
            <div style={{ position: "relative", zIndex: 1 }}>
            {specials.length === 1 && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "20px 0 9px" }}>
                  <span className="arch" style={{ fontWeight: 900, fontSize: 16, color: C.amber, letterSpacing: 0.4, textTransform: "uppercase" }}>★ Special di oggi</span>
                  <span style={{ flex: 1, height: 1, background: C.amberline }} />
                </div>
                <SpecialCard item={specials[0]} left={specialLeft(specials[0], stock, sessionKey)} cart={cart} onAdd={setQty} sessionLabel={session?.label ?? ""} />
              </>
            )}
            {specials.length > 1 && (
              <div style={{ marginTop: 20 }}>
                <SpecialsGroup
                  items={specials.map((sp) => ({ item: sp, left: specialLeft(sp, stock, sessionKey) }))}
                  cart={cart} onAdd={setQty} sessionLabel={session?.label ?? ""}
                />
              </div>
            )}
            <Ghost t="Smashburgers" />
            {menu.filter((m) => m.type === "smash" && !m.special).map((b) => <BurgerCard key={b.id} item={b} drinks={drinks} cart={cart} onAdd={setQty} />)}
            <Ghost t="Burgers" />
            {menu.filter((m) => m.type === "burger" && !m.special).map((b) => <BurgerCard key={b.id} item={b} drinks={drinks} cart={cart} onAdd={setQty} />)}
            {menu.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "16px 0" }}>Caricamento menu…</div>}
            {(["side", "dolce", "drink"] as const).map((t) => {
              const items = menu.filter((m) => m.type === t);
              if (items.length === 0) return null;
              const title = t === "side" ? "Sides" : t === "dolce" ? "Dolci" : "Drinks";
              return (
                <div key={t}>
                  <Ghost t={title} />
                  {items.map((b) => <SimpleRow key={b.id} item={{ name: b.name, price: b.price ?? 0 }} qty={cart[b.id]?.qty || 0} onAdd={() => bump(b.id, { key: b.id, label: b.name, price: b.price ?? 0, patty: 0, req: { kind: "simple", itemId: b.id } }, 1)} onSub={() => bump(b.id, { key: b.id, label: b.name, price: b.price ?? 0, patty: 0, req: { kind: "simple", itemId: b.id } }, -1)} />)}
                </div>
              );
            })}
          </div>
          </div>
          {count > 0 && (
            <Bar>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setCartOpen(true)} aria-label="Rivedi il tuo ordine" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 7, padding: "0 15px", borderRadius: 12, background: C.surface, border: `1px solid ${C.line}`, color: C.blue, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                  <ShoppingBag size={19} />{count}
                </button>
                <button onClick={() => { setChoice(null); setStep("quando"); }} style={barBtn}>
                  <span>Scegli quando</span><span>{euro(totalConServizio)} →</span>
                </button>
              </div>
            </Bar>
          )}
          {cartOpen && createPortal(
            <>
              <div className="cb-scrim" onClick={() => setCartOpen(false)} />
              <div className="cb-panel" role="dialog" aria-modal="true" aria-label="Il tuo ordine">
                <button className="cb-close" onClick={() => setCartOpen(false)} aria-label="Chiudi">✕</button>
                <div className="cb-grab" />
                <div style={{ padding: "8px 20px 0" }}>
                  <div className="arch" style={{ fontWeight: 800, fontSize: 20 }}>Il tuo ordine</div>
                  <div style={{ fontSize: 12.5, color: C.muted, margin: "3px 0 4px", lineHeight: 1.4 }}>Modifica le quantità o togli un articolo.</div>
                </div>
                <div style={{ overflowY: "auto", padding: "8px 20px 14px", flex: 1 }}>
                  {lines.map((v) => (
                    <div key={v.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{v.label}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{euro(v.price)} · tot {euro(v.price * v.qty)}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <button onClick={() => setLineQty(v, v.qty - 1)} style={{ ...rnd, width: 36, height: 36 }} aria-label={v.qty > 1 ? "Riduci" : "Rimuovi"}>{v.qty > 1 ? "−" : <Trash2 size={16} color={C.blue} />}</button>
                        <span style={{ width: 16, textAlign: "center", fontWeight: 700, fontSize: 14 }}>{v.qty}</span>
                        <button onClick={() => setLineQty(v, v.qty + 1)} style={{ ...rnd, width: 36, height: 36, background: C.blue, borderColor: C.blue, color: "#fff" }} aria-label="Aumenta">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${C.line}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600 }}>Totale</div>
                    <span className="arch" style={{ fontWeight: 800, fontSize: 24, color: C.blue }}>{euro(totalConServizio)}</span>
                  </div>
                  <button onClick={() => { setCartOpen(false); setChoice(null); setStep("quando"); }} style={{ flex: 1, background: C.blue, color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Scegli quando →</button>
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      )}

      {step === "quando" && (
        <div style={{ maxWidth: 580, margin: "0 auto", paddingBottom: choice ? 92 : 24 }}>
          <Top onBack={() => setStep("menu")} title="Quando lo ritiri?" />
          <div style={{ padding: "14px 18px 24px" }}>
            {sessions.length === 0 && (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Prenotazioni non disponibili</div>
                <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
                  {settings.bookingBlocked
                    ? "Al momento non accettiamo prenotazioni online. Riprova più tardi."
                    : "Non ci sono servizi prenotabili al momento. Riprova più avanti."}
                </div>
              </div>
            )}
            {sessions.length > 0 && (<>
            <Label>Giorno e servizio</Label>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 18 }}>
              {sessions.map((s) => (
                <button key={s.serviceKey} onClick={() => { setSessionKey(s.serviceKey); setChoice(null); }} style={{ ...dayCard, ...(s.serviceKey === sessionKey ? dayCardOn : {}) }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{s.dayLabel}</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>{s.dateLabel}</div>
                  <div style={{ fontSize: 11, marginTop: 3, opacity: 0.8 }}>{s.label}</div>
                </button>
              ))}
            </div>
            {!firstSlot ? (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, fontSize: 13.5, color: C.muted }}>Per questo servizio la piastra è al completo. Prova un altro giorno.</div>
            ) : (
              <>
                <button onClick={() => setChoice("first")} style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", background: choice === "first" ? C.blue : C.surface, color: choice === "first" ? "#fff" : C.ink, border: `1px solid ${choice === "first" ? C.blue : C.line}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", marginBottom: 16 }}>
                  <span><div style={{ fontWeight: 700, fontSize: 14 }}>Primo disponibile</div><div style={{ fontSize: 12, opacity: 0.8 }}>Il prima possibile per il tuo ordine</div></span>
                  <span className="arch" style={{ fontWeight: 800, fontSize: 22 }}>{fmt(firstSlot.readyMin)}</span>
                </button>
                <Label>Oppure scegli un orario</Label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(74px,1fr))", gap: 8 }}>
                  {slots.map((sl) => {
                    if (sl.full) return <div key={sl.window} title="Orario al completo" style={{ background: "#F0F0F5", color: "#BDBDD0", border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 14, textAlign: "center", textDecoration: "line-through", cursor: "not-allowed", userSelect: "none" }}>{fmt(sl.readyMin)}</div>;
                    const on = choice !== "first" && choice?.window === sl.window;
                    return <button key={sl.window} onClick={() => setChoice(sl)} style={{ background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{fmt(sl.readyMin)}</button>;
                  })}
                </div>
              </>
            )}
            </>)}
          </div>
          {choice && <Bar><button onClick={() => setStep("conferma")} style={barBtn}><span>{choice === "first" ? "Primo disponibile" : `Ritiro alle ${fmt(choice.readyMin)}`}</span><span>Continua →</span></button></Bar>}
        </div>
      )}

      {step === "conferma" && preview && session && (
        <div style={{ maxWidth: 580, margin: "0 auto" }}>
          <Top onBack={() => setStep("quando")} title="Conferma prenotazione" />
          <div style={{ padding: "20px 18px", textAlign: "center" }}>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>{session.dayLabel} {session.dateLabel} · pronto per le</div>
            <div className="arch" style={{ fontWeight: 900, fontSize: 76, lineHeight: 0.95, color: C.blue, margin: "4px 0" }}>{fmt(preview.readyMin)}</div>
            {preview.tranches > 1 && <div style={{ fontSize: 12, color: C.muted }}>Preparato in {preview.tranches} tranche, consegnato insieme</div>}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, margin: "22px 0", textAlign: "left" }}>
              {lines.map((v) => <div key={v.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}><span>{v.qty > 1 ? `${v.qty}× ` : ""}{v.label}</span><span style={{ color: C.muted }}>{euro(v.price * v.qty)}</span></div>)}
              {serviceCharge > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginTop: 4 }}>
                  <span>Costo servizio di prenotazione</span>
                  <span>{euro(serviceCharge)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}><span>Totale</span><span style={{ color: C.blue }}>{euro(totalConServizio)}</span></div>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Il tuo nome" style={{ width: "100%", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, padding: "13px 14px", fontSize: 16, marginBottom: 14 }} />
            <button onClick={() => name.trim() && setStep("pagamento")} disabled={!name.trim()} style={{ width: "100%", background: name.trim() ? C.blue : C.line, color: name.trim() ? "#fff" : C.muted, border: "none", borderRadius: 12, padding: "15px", fontWeight: 700, fontSize: 15, cursor: name.trim() ? "pointer" : "default" }}>Confermo</button>
            <button onClick={() => { setStep("quando"); }} style={{ background: "none", color: C.muted, border: "none", marginTop: 12, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>Annulla</button>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>Lo slot è tenuto per te per alcuni minuti, fino alla conferma.</div>
          </div>
        </div>
      )}

      {step === "pagamento" && (
        <div style={{ maxWidth: 580, margin: "0 auto" }}>
          <Top onBack={() => setStep("conferma")} title={PAY_ENABLED.length === 1 ? "Pagamento" : "Come vuoi pagare?"} />
          <div style={{ padding: "18px 18px 24px" }}>
            {PAY_ENABLED.includes("loco") && <PayOption title="Paga in loco" sub="Saldi al ritiro: contanti o carta in cassa" on={pay === "loco"} onClick={() => setPay("loco")} />}
            {PAY_ENABLED.includes("online") && <PayOption title="Paga ora" sub="Carta · Apple Pay · Google Pay" on={pay === "online"} onClick={() => setPay("online")} />}
            {err && <div style={{ color: "#C8441A", fontSize: 13, margin: "6px 0 12px" }}>{err}</div>}
            {(() => {
              const ready = !!pay && !busy;
              return (
                <button onClick={commit} disabled={!ready} style={{ width: "100%", background: ready ? C.blue : C.line, color: ready ? "#fff" : C.muted, border: "none", borderRadius: 12, padding: "15px", fontWeight: 700, fontSize: 15, cursor: ready ? "pointer" : "default", marginTop: 8 }}>
                  {busy ? "Attendere…" : pay === "online" ? "Vai al pagamento" : "Conferma prenotazione"}
                </button>
              );
            })()}
            {pay === "online" && <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 10 }}>Verrai reindirizzato al checkout sicuro.</div>}
          </div>
        </div>
      )}

      {step === "done" && result && session && (
        <div style={{ maxWidth: 580, margin: "0 auto", padding: "56px 22px 0", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#fff", fontSize: 28 }}>✓</div>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>{session.dayLabel} {session.dateLabel} · pronto per le</div>
          <div className="arch" style={{ fontWeight: 900, fontSize: 80, lineHeight: 0.95, color: C.blue, margin: "2px 0 6px" }}>{fmt(result.readyMin)}</div>
          {result.proposedDifferent && <div style={{ fontSize: 12, color: C.muted }}>L'orario scelto era pieno: questa è la prima disponibilità.</div>}
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", margin: "18px 0 4px" }}>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>Codice di ritiro</div>
            <div className="arch" style={{ fontWeight: 900, fontSize: 40, color: C.ink, lineHeight: 1, marginTop: 2 }}>#{result.code}</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Mostralo o dillo al banco quando ritiri.</div>
          </div>
          <div style={{ fontSize: 12.5, color: pay === "online" ? C.veg : C.muted, fontWeight: 600, marginTop: 4 }}>{pay === "online" ? "Pagato online" : "Pagamento in loco"}</div>
          <a href={waHref} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: C.wa, color: "#04331b", borderRadius: 12, padding: "15px", fontWeight: 700, fontSize: 15, textDecoration: "none", marginTop: 22 }}>Invia conferma su WhatsApp</a>
          <button onClick={reset} style={{ background: "none", color: C.muted, border: "none", marginTop: 16, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Nuova prenotazione</button>
        </div>
      )}
      <div style={{ textAlign: "center", padding: "18px 0 14px", fontSize: 11, color: C.muted, opacity: 0.55, letterSpacing: 0.3 }}>
        <a href="https://mattewinflamestudio.com" target="_blank" rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}>
          Built by MattewInFlames Studio
        </a>
      </div>
    </div>
  );
}

function Ghost({ t }: { t: string }) { return <div className="arch" style={{ fontWeight: 900, fontSize: "clamp(30px,9vw,46px)", color: C.ghost, letterSpacing: -1, marginTop: 28, marginBottom: 4, lineHeight: 1 }}>{t}</div>; }
function Bar({ children }: { children: React.ReactNode }) { return <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.bg, borderTop: `1px solid ${C.line}`, padding: "12px 18px", boxShadow: "0 -4px 16px rgba(27,27,71,.06)", zIndex: 40 }}><div style={{ maxWidth: 580, margin: "0 auto" }}>{children}</div></div>; }
const barBtn: React.CSSProperties = { width: "100%", background: C.blue, color: "#fff", border: "none", borderRadius: 12, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontWeight: 700, fontSize: 14 };

/* ----------------------------------------------------------------------------
   Card dello special: fascia ambra con la finestra dichiarata e i pezzi
   residui, barra di avanzamento, stati "ultimi pezzi" ed "esaurito".
   Lo special vive FUORI MENÙ: nessun configuratore (formato, menu, extra,
   sostituzioni). Si aggiunge e basta, a prezzo fisso, fino a esaurimento.
   ---------------------------------------------------------------------------- */
function SpecialCard({ item, left, cart, onAdd, sessionLabel }: {
  item: MenuItem; left: number;
  cart: Record<string, CartLine>; onAdd: (k: string, d: Omit<CartLine, "qty">, q: number) => void;
  sessionLabel: string;
}) {
  const totale = item.special?.stock ?? 0;
  const esaurito = left <= 0;
  const pochi = !esaurito && left <= SPECIAL_LOW;
  const perc = totale > 0 ? Math.round((left / totale) * 100) : 0;
  const accento = pochi ? C.red : C.amber;

  const line = specialCartLine(item);
  const qty = cart[line.key]?.qty ?? 0;
  const raggiuntoTetto = qty >= left;           // non si può ordinare più dei pezzi rimasti
  const set = (q: number) => onAdd(line.key, line, q);

  if (esaurito) {
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 13, padding: "13px 14px", marginBottom: 12, opacity: 0.6,
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, textDecoration: "line-through" }}>{item.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Andato a ruba, alla prossima!</div>
        </div>
        <span style={{ background: C.surface, color: C.muted, borderRadius: 20, padding: "4px 11px", fontSize: 10.5,
                       fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7, flexShrink: 0 }}>Esaurito</span>
      </div>
    );
  }

  return (
    <div style={{ border: `1.5px solid ${accento}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ background: accento, color: "#fff", padding: "5px 13px", fontSize: 10, fontWeight: 800,
                    letterSpacing: 1.1, textTransform: "uppercase", display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span>Solo {sessionLabel.toLowerCase() || "oggi"}</span>
        <span>{pochi ? `ultimi ${left}` : `restano ${left} / ${totale}`}</span>
      </div>
      <div style={{ padding: "12px 13px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              {item.name}{item.veg && <Leaf size={13} color={C.veg} />}
              {qty > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: C.blue, borderRadius: 20, padding: "1px 7px" }}>{qty}</span>}
            </div>
            {item.desc && <div style={{ fontSize: 12, color: C.muted, margin: "3px 0 0", lineHeight: 1.4 }}>{item.desc}</div>}
            <div style={{ fontSize: 13, color: C.blue, fontWeight: 600, marginTop: 4 }}>{euro(item.solo ?? 0)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {qty > 0 && <button onClick={() => set(qty - 1)} style={rnd} aria-label="Togli">−</button>}
            {qty > 0 && <span style={{ width: 14, textAlign: "center", fontWeight: 700 }}>{qty}</span>}
            <button onClick={() => set(qty + 1)} disabled={raggiuntoTetto} aria-label="Aggiungi"
              style={{ ...rnd, background: raggiuntoTetto ? C.surface : C.blue, borderColor: raggiuntoTetto ? C.line : C.blue,
                       color: raggiuntoTetto ? C.muted : "#fff", cursor: raggiuntoTetto ? "default" : "pointer" }}>+</button>
          </div>
        </div>
        {raggiuntoTetto && qty > 0 && <div style={{ fontSize: 11.5, color: accento, marginTop: 8 }}>Hai già preso tutti i pezzi rimasti.</div>}
        <div style={{ height: 4, borderRadius: 3, background: C.amberline, overflow: "hidden", marginTop: 9 }}>
          <span style={{ display: "block", height: "100%", width: `${perc}%`, background: accento }} />
        </div>
      </div>
    </div>
  );
}

/* Corpo di uno special (nome, prezzo, pezzi rimasti, stepper, barra), SENZA il
   contenitore esterno: così può stare sia nella card singola sia, accorpato,
   dentro un unico riquadro quando gli special sono più di uno. */
function SpecialBody({ item, left, cart, onAdd }: {
  item: MenuItem; left: number;
  cart: Record<string, CartLine>; onAdd: (k: string, d: Omit<CartLine, "qty">, q: number) => void;
}) {
  const totale = item.special?.stock ?? 0;
  const esaurito = left <= 0;
  const pochi = !esaurito && left <= SPECIAL_LOW;
  const perc = totale > 0 ? Math.round((left / totale) * 100) : 0;
  const accento = pochi ? C.red : C.amber;
  const line = specialCartLine(item);
  const qty = cart[line.key]?.qty ?? 0;
  const raggiuntoTetto = qty >= left;
  const set = (q: number) => onAdd(line.key, line, q);

  if (esaurito) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, opacity: 0.6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, textDecoration: "line-through" }}>{item.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Andato a ruba, alla prossima!</div>
        </div>
        <span style={{ background: C.surface, color: C.muted, borderRadius: 20, padding: "4px 11px", fontSize: 10.5,
                       fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7, flexShrink: 0 }}>Esaurito</span>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
            {item.name}{item.veg && <Leaf size={13} color={C.veg} />}
            {qty > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: C.blue, borderRadius: 20, padding: "1px 7px" }}>{qty}</span>}
          </div>
          {item.desc && <div style={{ fontSize: 12, color: C.muted, margin: "3px 0 0", lineHeight: 1.4 }}>{item.desc}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: C.blue, fontWeight: 600 }}>{euro(item.solo ?? 0)}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: accento, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {pochi ? `ultimi ${left}` : `restano ${left}/${totale}`}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          {qty > 0 && <button onClick={() => set(qty - 1)} style={rnd} aria-label="Togli">−</button>}
          {qty > 0 && <span style={{ width: 14, textAlign: "center", fontWeight: 700 }}>{qty}</span>}
          <button onClick={() => set(qty + 1)} disabled={raggiuntoTetto} aria-label="Aggiungi"
            style={{ ...rnd, background: raggiuntoTetto ? C.surface : C.blue, borderColor: raggiuntoTetto ? C.line : C.blue,
                     color: raggiuntoTetto ? C.muted : "#fff", cursor: raggiuntoTetto ? "default" : "pointer" }}>+</button>
        </div>
      </div>
      {raggiuntoTetto && qty > 0 && <div style={{ fontSize: 11.5, color: accento, marginTop: 8 }}>Hai già preso tutti i pezzi rimasti.</div>}
      <div style={{ height: 4, borderRadius: 3, background: C.amberline, overflow: "hidden", marginTop: 9 }}>
        <span style={{ display: "block", height: "100%", width: `${perc}%`, background: accento }} />
      </div>
    </>
  );
}

/* Più special insieme: un unico riquadro con l'evidenza ambra, invece di tanti
   piccoli riquadri separati. Ogni special resta una riga a sé, divisa dalle
   altre da una linea sottile. */
function SpecialsGroup({ items, cart, onAdd, sessionLabel }: {
  items: { item: MenuItem; left: number }[];
  cart: Record<string, CartLine>; onAdd: (k: string, d: Omit<CartLine, "qty">, q: number) => void;
  sessionLabel: string;
}) {
  return (
    <div style={{ border: `1.5px solid ${C.amber}`, borderRadius: 13, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ background: C.amber, color: "#fff", padding: "6px 13px", fontSize: 10.5, fontWeight: 800,
                    letterSpacing: 1.1, textTransform: "uppercase", display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span>★ Special di oggi</span>
        <span>Solo {sessionLabel.toLowerCase() || "oggi"}</span>
      </div>
      {items.map(({ item, left }, i) => (
        <div key={item.id} style={{ padding: "12px 13px", borderTop: i > 0 ? `1px solid ${C.amberline}` : "none" }}>
          <SpecialBody item={item} left={left} cart={cart} onAdd={onAdd} />
        </div>
      ))}
    </div>
  );
}

function BurgerCard({ item, drinks, cart, onAdd, bare, maxQty }: {
  item: MenuItem; drinks: MenuItem[]; cart: Record<string, CartLine>;
  onAdd: (k: string, d: Omit<CartLine, "qty">, q: number) => void;
  /** dentro la card special: niente bordo, il contenitore ha già il suo */
  bare?: boolean;
  /** tetto alla quantità: i pezzi ancora disponibili di uno special */
  maxQty?: number;
}) {
  const [open, setOpen] = useState(false);
  const [fmtId, setFmtId] = useState<FormatId>("singolo");
  const [type, setType] = useState<CartType>("panino");
  const [drinkId, setDrinkId] = useState<string>("");
  const [ex, setEx] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [swaps, setSwaps] = useState<string[]>([]);
  const f = FORMATS[fmtId];
  const ingredients = ingredientsOf(item);
  // bibita compresa: la prima senza sovrapprezzo, altrimenti la prima disponibile
  const drink = drinks.find((d) => d.id === drinkId)
             ?? drinks.find((d) => menuDrinkSurcharge(d) === 0)
             ?? drinks[0];
  const cfg: PaninoConfig = {
    item, format: fmtId, type, drink,
    extras: EXTRA.map((e) => ({ ...e, q: ex[e.id] || 0 })).filter((e) => e.q > 0),
    removed, swaps,
  };
  const price = cartPrice(cfg);
  const inCart = Object.keys(cart).filter((k) => k.startsWith(item.id + "|")).reduce((s, k) => s + cart[k].qty, 0);
  const bumpEx = (id: string, d: number) => setEx((p) => { const q = Math.max(0, (p[id] || 0) + d); const n = { ...p, [id]: q }; if (!q) delete n[id]; return n; });
  const toggleRm = (ing: string) => setRemoved((r) => r.includes(ing) ? r.filter((x) => x !== ing) : [...r, ing]);
  const toggleSwap = (id: string) => setSwaps((v) => v.includes(id) ? v.filter((x) => x !== id) : [...v, id]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const reset = () => { setOpen(false); setEx({}); setRemoved([]); setSwaps([]); setDrinkId(""); setType("panino"); setFmtId("singolo"); };
  const add = () => {
    const line = cartLineOf(cfg);
    // per gli special non si può superare i pezzi rimasti (il controllo vero
    // resta nella transazione: qui si evita solo di far sperare invano)
    const giaMiei = Object.values(cart).filter((l) => l.specialId === item.id).reduce((s, l) => s + l.qty, 0);
    if (maxQty != null && giaMiei >= maxQty) { setOpen(false); return; }
    onAdd(line.key, line, (cart[line.key]?.qty || 0) + 1);
    reset();
  };
  const removeFromCart = () => {
    const curKey = cartKey(cfg);
    const myKeys = Object.keys(cart).filter((k) => k.startsWith(item.id + "|"));
    // Rimuove la variante configurata ora se presente; altrimenti tutte le varianti del panino
    const targets = myKeys.includes(curKey) ? [curKey] : myKeys;
    targets.forEach((k) => onAdd(k, cart[k], 0)); // qty 0 = elimina
    reset();
  };
  return (
    <div style={bare ? undefined : { borderBottom: `1px solid ${C.line}` }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", background: "none", border: "none", textAlign: "left", padding: bare ? "0 0 2px" : "14px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}>{item.name}{item.veg && <Leaf size={13} color={C.veg} />}{inCart > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: C.blue, borderRadius: 20, padding: "1px 7px" }}>{inCart}</span>}</span>
          <div style={{ fontSize: 12, color: C.muted, margin: "3px 0 0", lineHeight: 1.4 }}>{item.desc}</div>
          <div style={{ fontSize: 13, color: C.blue, fontWeight: 600, marginTop: 4 }}>da {euro(item.solo ?? 0)}</div>
        </div>
        <span style={{ width: 34, height: 34, borderRadius: "50%", border: `1.6px solid ${C.blue}`, color: open ? "#fff" : C.blue, background: open ? C.blue : "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, lineHeight: 1, flexShrink: 0, transform: open ? "rotate(45deg)" : "none", transition: "transform .2s" }}>+</span>
      </button>
      {open && createPortal(
        <>
          <div className="cb-scrim" onClick={() => setOpen(false)} />
          <div className="cb-panel" role="dialog" aria-modal="true" aria-label={item.name}>
            <button className="cb-close" onClick={() => setOpen(false)} aria-label="Chiudi">✕</button>
            <div className="cb-grab" />
            <div style={{ padding: "8px 20px 0" }}>
              <div className="arch" style={{ fontWeight: 800, fontSize: 20, display: "flex", alignItems: "center", gap: 6 }}>{item.name}{item.veg && <Leaf size={14} color={C.veg} />}{inCart > 0 && <span style={{ fontFamily: "Inter,sans-serif", fontSize: 11, fontWeight: 700, color: "#fff", background: C.blue, borderRadius: 20, padding: "2px 8px" }}>già {inCart} nell'ordine</span>}</div>
              <div style={{ fontSize: 12.5, color: C.muted, margin: "3px 0 4px", lineHeight: 1.4 }}>{item.desc}</div>
            </div>
            <div style={{ overflowY: "auto", padding: "8px 20px 14px", flex: 1 }}>
              {/* 1 · che prodotto è: formato (= patty) e tipo, vicini */}
              <Label>Formato</Label>
              <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>{(Object.keys(FORMATS) as FormatId[]).map((id) => <button key={id} onClick={() => setFmtId(id)} style={chip(fmtId === id)}>{FORMATS[id].label}{FORMATS[id].surcharge ? <span style={{ opacity: 0.7 }}> +{FORMATS[id].surcharge}</span> : null}</button>)}</div>
              <Label>Tipo</Label>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => setType("panino")} style={chip(type === "panino")}>Solo panino</button>
                <button onClick={() => setType("menu")} style={chip(type === "menu")}>Menu</button>
              </div>
              {type === "menu" && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>+ patatine fritte + bibita a scelta</div>}

              {/* 2 · composizione del panino: prima si toglie, poi si aggiunge */}
              {ingredients.length > 0 && (
                <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
                  <Label>Ingredienti · togli quelli che non vuoi</Label>
                  {ingredients.map((ing, i) => {
                    const off = removed.includes(ing);
                    return (
                      <div key={ing} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: i < ingredients.length - 1 ? `1px solid ${C.line}` : "none" }}>
                        <span style={{ fontSize: 13.5, color: off ? C.muted : C.ink, textDecoration: off ? "line-through" : "none" }}>{ing}</span>
                        <button onClick={() => toggleRm(ing)} role="switch" aria-checked={!off} aria-label={off ? `Rimetti ${ing}` : `Togli ${ing}`}
                          style={{ width: 44, height: 26, borderRadius: 20, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", padding: 0, background: off ? "#D8D8E4" : C.blue, transition: "background .15s" }}>
                          <span style={{ position: "absolute", top: 3, left: off ? 3 : 21, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {(item.swaps ?? []).length > 0 && (
                <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
                  <Label>Sostituzioni</Label>
                  {(item.swaps ?? []).map((sw, i, arr) => {
                    const on = swaps.includes(sw.id);
                    return (
                      <button key={sw.id} onClick={() => toggleSwap(sw.id)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", cursor: "pointer",
                                 padding: "8px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none", textAlign: "left" }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${on ? C.blue : C.muted}`, background: on ? C.blue : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{on ? "✓" : ""}</span>
                        <span style={{ flex: 1, fontSize: 13.5, color: C.ink }}>{sw.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: sw.price ? C.blue : C.veg }}>{sw.price ? `+${euro(sw.price)}` : "incluso"}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px" }}>
                <Label>Extra · su questo panino</Label>
                {EXTRA.map((e, i) => { const q = ex[e.id] || 0; return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: i < EXTRA.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <span style={{ fontSize: 13.5 }}>{e.name} <span style={{ color: C.muted }}>· {euro(e.price)}</span></span>
                    {q === 0 ? <button onClick={() => bumpEx(e.id, 1)} style={{ width: 36, height: 36, borderRadius: "50%", background: "transparent", border: `1.5px solid ${C.blue}`, color: C.blue, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>+</button>
                      : <div style={{ display: "flex", alignItems: "center", gap: 9 }}><button onClick={() => bumpEx(e.id, -1)} style={{ ...rnd, width: 36, height: 36 }}>−</button><span style={{ width: 12, textAlign: "center", fontWeight: 700, fontSize: 13 }}>{q}</span><button onClick={() => bumpEx(e.id, 1)} style={{ ...rnd, width: 36, height: 36, background: C.blue, borderColor: C.blue, color: "#fff" }}>+</button></div>}
                  </div>); })}
              </div>

              {/* 3 · accessorio del menu: la bibita, in fondo */}
              {type === "menu" && (
                <div style={{ marginTop: 14 }}>
                  <Label>Bibita compresa</Label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {drinks.map((d) => {
                      const sur = menuDrinkSurcharge(d);
                      const on = drink?.id === d.id;
                      return (
                        <button key={d.id} onClick={() => setDrinkId(d.id)}
                          style={{ display: "flex", alignItems: "center", gap: 9, textAlign: "left", cursor: "pointer",
                                   background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink,
                                   border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 10, padding: "10px 12px" }}>
                          <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, border: `2px solid ${on ? "#fff" : C.muted}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}
                          </span>
                          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{d.name}</span>
                          {sur > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: on ? "#fff" : C.blue }}>+{euro(sur)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="arch" style={{ fontWeight: 800, fontSize: 24, color: C.blue, flexShrink: 0 }}>{euro(price)}</span>
              {inCart > 0 && (
                <button onClick={removeFromCart} aria-label="Rimuovi dall'ordine" style={{ flexShrink: 0, width: 50, height: 50, borderRadius: 12, background: "#FDECEA", border: "1px solid #F2C4BC", color: "#C8321B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={20} />
                </button>
              )}
              <button onClick={add} style={{ flex: 1, minWidth: 0, background: C.blue, color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Aggiungi</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function SimpleRow({ item, qty, onAdd, onSub }: { item: { name: string; price: number }; qty: number; onAdd: () => void; onSub: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 0", borderBottom: `1px solid ${C.line}` }}>
      <div><span style={{ fontWeight: 600, fontSize: 14.5 }}>{item.name}</span><div style={{ fontSize: 13, color: C.blue, fontWeight: 600, marginTop: 3 }}>{euro(item.price)}</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{qty > 0 && <button onClick={onSub} style={rnd}>−</button>}{qty > 0 && <span style={{ width: 14, textAlign: "center", fontWeight: 700 }}>{qty}</span>}<button onClick={onAdd} style={{ ...rnd, background: C.blue, borderColor: C.blue, color: "#fff" }}>+</button></div>
    </div>
  );
}
function PayOption({ title, sub, on, onClick }: { title: string; sub: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 13, background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 12, padding: "15px 16px", cursor: "pointer", marginBottom: 12 }}>
      <span style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div><div style={{ fontSize: 12, opacity: 0.8 }}>{sub}</div></span>
      <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "#fff" : C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{on && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff" }} />}</span>
    </button>
  );
}
function Top({ onBack, title }: { onBack: () => void; title: string }) { return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.bg, zIndex: 5 }}><button onClick={onBack} style={rnd}>‹</button><span className="arch" style={{ fontWeight: 800, fontSize: 20 }}>{title}</span></div>; }
function Label({ children }: { children: React.ReactNode }) { return <div style={{ fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: C.muted, margin: "0 0 7px", fontWeight: 600 }}>{children}</div>; }
const rnd: React.CSSProperties = { width: 40, height: 40, borderRadius: "50%", background: C.bg, color: C.ink, border: `1px solid ${C.line}`, cursor: "pointer", flexShrink: 0, fontSize: 18, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" };
const chip = (on: boolean): React.CSSProperties => ({ flex: "1 1 auto", background: on ? C.blue : C.surface, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.blue : C.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const dayCard: React.CSSProperties = { flexShrink: 0, minWidth: 84, background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 11, padding: "10px 12px", cursor: "pointer", textAlign: "left" };
const dayCardOn: React.CSSProperties = { background: C.blue, color: "#fff", borderColor: C.blue };
