/* CHEEBO · WhatsApp */
import { LOCALE_PHONE } from "./firebase";

export function buildConfirmMessage(name: string, dayLabel: string, readyHHMM: string, items: string[], paid: boolean, code?: number): string {
  const lines = items.map((i) => `• ${i}`).join("\n");
  const codeLine = code != null ? `Codice ritiro: #${code}\n` : "";
  return `Ciao, sono ${name}! Prenotazione confermata per ${dayLabel} alle ${readyHHMM}:\n${codeLine}${lines}\nPagamento: ${paid ? "pagato online" : "in loco"}`;
}

export function waLink(text: string, phone: string = LOCALE_PHONE): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
