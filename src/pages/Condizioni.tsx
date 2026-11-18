/* ============================================================================
   CHEEBO · Condizioni d'uso (/condizioni-uso) e Condizioni di garanzia
   (/condizioni-garanzia). Uso: sito, ordine, prezzi, pagamento, ritiro.
   Garanzia: annullamento e rimborsi, recesso escluso, conformità e reclami.
   I dati del venditore vengono da src/lib/legal.ts.
   ⚠️ Testo da far rivedere da un legale.
   ========================================================================== */
import type { ReactNode } from "react";
import { LEGAL, CONDIZIONI_VERSIONE, ANNULLAMENTO_MINUTI, legalMancanti } from "../lib/legal";

const C = { bg: "#FFFFFF", surface: "#F5F5FB", line: "#E8E8F2", blue: "#2E2C8B", ink: "#1B1B47", muted: "#8786A4", red: "#C8321B" };

const v = (s: string) => s.trim() || "[da completare]";
const dataIt = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

function Sez({ n, titolo, children }: { n: number; titolo: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 26 }} aria-labelledby={`s${n}`}>
      <h2 id={`s${n}`} style={{ fontSize: 16.5, fontWeight: 800, color: C.ink, margin: "0 0 8px" }}>{n}. {titolo}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.6, color: C.ink }}>{children}</div>
    </section>
  );
}

export default function Condizioni({ parte }: { parte: "uso" | "garanzia" }) {
  const mancanti = legalMancanti();
  const contatti = <>telefono/WhatsApp <b>{v(LEGAL.telefono)}</b>, {LEGAL.email.trim() ? <>email <b>{LEGAL.email}</b></> : <>PEC <b>{v(LEGAL.pec)}</b></>}</>;
  const titolo = parte === "uso" ? "Condizioni d'uso" : "Condizioni di garanzia";

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink, fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
      <style>{`.cond p{margin:0 0 9px}.cond ul{margin:0 0 9px;padding-left:20px}.cond li{margin:0 0 4px}.cond a{color:${C.blue}}`}</style>
      <div className="cond" style={{ maxWidth: 720, margin: "0 auto", padding: "28px 18px 60px" }}>
        <a href="/" style={{ fontSize: 13, color: C.blue, textDecoration: "none", fontWeight: 600 }}>‹ Torna al menu</a>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: C.blue, margin: "14px 0 4px", lineHeight: 1.15 }}>{titolo}</h1>
        <div style={{ fontSize: 13, color: C.muted }}>
          In vigore dal {dataIt(CONDIZIONI_VERSIONE)} ·{" "}
          {parte === "uso" ? <a href="/condizioni-garanzia">Condizioni di garanzia</a> : <a href="/condizioni-uso">Condizioni d'uso</a>}
        </div>

        {mancanti.length > 0 && (
          <div role="alert" style={{ marginTop: 16, background: "#FDECE8", border: `1px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
            Bozza: mancano i dati del venditore ({mancanti.join(", ")}).
          </div>
        )}

        {parte === "garanzia" && (
          <div style={{ marginTop: 18, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 15px", fontSize: 14, lineHeight: 1.55 }}>
            <b>In breve.</b> Puoi annullare con rimborso completo fino a {ANNULLAMENTO_MINUTI} minuti prima dell'apertura del servizio che hai scelto;
            dopo, l'ordine non è più annullabile né rimborsabile, perché le preparazioni sono espresse. Se non ritiri, non c'è rimborso.
            Se siamo noi a non poter preparare l'ordine, ti rimborsiamo tutto. Se qualcosa non va al ritiro, dillo subito al personale.
          </div>
        )}

        {parte === "uso" ? (
          <>
        <Sez n={1} titolo="Chi siamo">
          <p>Il servizio di ordinazione online è offerto da <b>{v(LEGAL.ragioneSociale)}</b>, con sede legale in {v(LEGAL.sedeLegale)},
            partita IVA e codice fiscale {v(LEGAL.piva)}{LEGAL.rea.trim() ? `, REA ${LEGAL.rea}` : ""} (di seguito "il Locale").</p>
          <p>Contatti: {contatti}{LEGAL.email.trim() && LEGAL.pec.trim() ? <>, PEC <b>{LEGAL.pec}</b></> : null}.</p>
        </Sez>
        <Sez n={2} titolo="Oggetto">
          <p>Queste condizioni d'uso regolano l'uso del sito e la vendita a distanza dei prodotti alimentari preparati dal Locale,
            ordinati online e ritirati dal cliente presso il punto di ritiro: <b>{v(LEGAL.puntoRitiro)}</b>. Non è prevista la consegna a domicilio.</p>
          <p>Inviando un ordine il cliente dichiara di aver letto e accettato queste condizioni, nella versione in vigore al momento dell'ordine.</p>
        </Sez>
        <Sez n={3} titolo="Uso del sito">
          <ul>
            <li>Il sito serve a ordinare prodotti per il ritiro. È vietato usarlo con sistemi automatici, inviare ordini falsi o di disturbo, o tentare di aggirarne il funzionamento.</li>
            <li>Il Locale può rifiutare o annullare ordini anomali o palesemente fraudolenti, rimborsando quanto eventualmente pagato.</li>
            <li>Il Locale si impegna a mantenere il sito funzionante, ma non può garantirne la disponibilità continua: le prenotazioni online possono essere sospese, ad esempio durante il servizio o in caso di imprevisti.</li>
            <li>Testi, immagini e marchi presenti sul sito appartengono al Locale o ai rispettivi titolari.</li>
          </ul>
        </Sez>
        <Sez n={4} titolo="Ordine e conclusione del contratto">
          <ul>
            <li>Il cliente sceglie i prodotti, il giorno, il servizio e l'orario di ritiro tra quelli disponibili.</li>
            <li>Prima del pagamento il sito mostra il riepilogo: prodotti, prezzi, costo del servizio di prenotazione, totale e orario di ritiro.
              Se l'orario scelto non è più disponibile, il sito propone l'orario più vicino e lo mostra prima che il cliente paghi.</li>
            <li>Il contratto è concluso quando il pagamento va a buon fine. La conferma, con il codice dell'ordine, compare a schermo.</li>
          </ul>
        </Sez>
        <Sez n={5} titolo="Prezzi">
          <p>I prezzi sono in euro e comprendono l'IVA. L'eventuale costo del servizio di prenotazione è indicato separatamente nel riepilogo e incluso nel totale.
            Vale il prezzo mostrato al momento dell'ordine.</p>
        </Sez>
        <Sez n={6} titolo="Pagamento">
          <p>Il pagamento avviene online al momento dell'ordine, tramite la piattaforma sicura del fornitore di servizi di pagamento (carte, Apple Pay, Google Pay).
            I dati della carta sono trattati esclusivamente dal fornitore del servizio di pagamento e non sono mai visibili al Locale.
            Il documento fiscale è emesso dal Locale secondo la normativa vigente.</p>
        </Sez>
        <Sez n={7} titolo="Ritiro">
          <ul>
            <li>L'ordine si ritira al punto di ritiro, all'orario indicato nella conferma, comunicando nome e codice dell'ordine.</li>
            <li>I prodotti sono preparati espressi per l'orario indicato. Se il cliente non si presenta, l'ordine si considera eseguito e <b>non è rimborsato</b>.</li>
          </ul>
        </Sez>
        <Sez n={8} titolo="Annullamento, rimborsi e garanzia">
          <p>Annullamento dell'ordine, rimborsi, esclusione del diritto di recesso, garanzia sui prodotti e reclami sono regolati dalle <a href="/condizioni-garanzia">Condizioni di garanzia</a>, che fanno parte di queste condizioni.</p>
        </Sez>
        <Sez n={9} titolo="Allergeni">
          <p>Le informazioni sugli allergeni presenti in ciascun prodotto sono disponibili prima dell'ordine, su richiesta, contattando il Locale ({contatti}).
            Chi ha allergie o intolleranze è invitato a chiedere prima di ordinare.</p>
        </Sez>
        <Sez n={10} titolo="Dati personali">
          <p>Il nome e i dati dell'ordine sono usati dal Locale, titolare del trattamento, solo per gestire l'ordine e adempiere agli obblighi di legge.
            Per informazioni o per esercitare i propri diritti ci si può rivolgere ai contatti del punto 1.</p>
        </Sez>
        <Sez n={11} titolo="Legge applicabile e controversie">
          <p>Queste condizioni sono regolate dalla legge italiana. Per le controversie con i consumatori è competente il giudice del luogo di residenza o domicilio del consumatore.
            Il consumatore può inoltre ricorrere agli organismi di risoluzione alternativa delle controversie (ADR) previsti dal Codice del Consumo.</p>
        </Sez>
        <Sez n={12} titolo="Modifiche">
          <p>Il Locale può aggiornare queste condizioni. Si applica la versione in vigore al momento dell'ordine, la cui data è indicata in cima alla pagina.</p>
        </Sez>
          </>
        ) : (
          <>
        <Sez n={1} titolo="Chi siamo">
          <p>Il servizio di ordinazione online è offerto da <b>{v(LEGAL.ragioneSociale)}</b>, con sede legale in {v(LEGAL.sedeLegale)},
            partita IVA e codice fiscale {v(LEGAL.piva)}{LEGAL.rea.trim() ? `, REA ${LEGAL.rea}` : ""} (di seguito "il Locale").</p>
          <p>Contatti: {contatti}{LEGAL.email.trim() && LEGAL.pec.trim() ? <>, PEC <b>{LEGAL.pec}</b></> : null}.</p>
        </Sez>
        <Sez n={2} titolo="Oggetto">
          <p>Queste condizioni di garanzia completano le <a href="/condizioni-uso">Condizioni d'uso</a> e regolano annullamento, rimborsi, recesso, garanzia sui prodotti e reclami per gli ordini fatti sul sito.</p>
        </Sez>
        <Sez n={3} titolo="Annullamento da parte del cliente">
          <ul>
            <li>Il cliente può annullare l'ordine, con <b>rimborso completo</b>, fino a <b>{ANNULLAMENTO_MINUTI} minuti prima dell'apertura del servizio</b> in cui è previsto il ritiro
              (ad esempio entro le 19:00 per un servizio che apre alle 19:30), contattando il Locale ({contatti}) e indicando nome e codice dell'ordine.</li>
            <li>Dopo questo termine l'ordine <b>non è annullabile né rimborsabile</b>, perché il Locale inizia a organizzare la preparazione.</li>
            <li>I rimborsi sono effettuati con lo stesso mezzo di pagamento usato per l'ordine, entro 14 giorni dalla richiesta. I tempi di accredito dipendono dalla banca o dal circuito.</li>
          </ul>
        </Sez>
        <Sez n={4} titolo="Mancato ritiro">
          <p>I prodotti sono preparati espressi per l'orario di ritiro indicato. Se il cliente non si presenta, l'ordine si considera eseguito e <b>non è rimborsato</b>.</p>
        </Sez>
        <Sez n={5} titolo="Diritto di recesso">
          <p>Il diritto di recesso previsto dal Codice del Consumo per i contratti a distanza è escluso, ai sensi dell'art. 59, comma 1, lettere c) e d), del D.Lgs. 206/2005,
            perché i prodotti sono preparati su richiesta del cliente, secondo le sue scelte, e sono deperibili.
            La possibilità di annullare descritta al punto 3 è una facoltà concessa dal Locale.</p>
        </Sez>
        <Sez n={6} titolo="Annullamento da parte del Locale">
          <p>Se il Locale non può preparare un ordine già pagato (ad esempio per guasto, chiusura imprevista o altre cause indipendenti dalla sua volontà),
            avvisa il cliente appena possibile e lo <b>rimborsa per intero</b>, costo del servizio di prenotazione compreso.</p>
        </Sez>
        <Sez n={7} titolo="Garanzia e reclami">
          <ul>
            <li>Il Locale garantisce che i prodotti corrispondono all'ordine, come previsto dalla garanzia legale di conformità (artt. 128 e seguenti del Codice del Consumo).</li>
            <li>Se un prodotto è sbagliato, manca o non è integro, il cliente lo segnala <b>al momento del ritiro</b> al personale, che lo sostituisce;
              se la sostituzione non è possibile, il Locale rimborsa il prezzo del prodotto interessato.</li>
            <li>Problemi riscontrati dopo il ritiro e altri reclami vanno inviati ai contatti del punto 1, il prima possibile, indicando nome, codice dell'ordine e cosa non va.
              Il Locale risponde nel più breve tempo possibile.</li>
          </ul>
        </Sez>
        <Sez n={8} titolo="Legge applicabile e controversie">
          <p>Queste condizioni sono regolate dalla legge italiana. Per le controversie con i consumatori è competente il giudice del luogo di residenza o domicilio del consumatore.
            Il consumatore può inoltre ricorrere agli organismi di risoluzione alternativa delle controversie (ADR) previsti dal Codice del Consumo.</p>
        </Sez>
        <Sez n={9} titolo="Modifiche">
          <p>Il Locale può aggiornare queste condizioni. Si applica la versione in vigore al momento dell'ordine, la cui data è indicata in cima alla pagina.</p>
        </Sez>
          </>
        )}
      </div>
    </div>
  );
}
