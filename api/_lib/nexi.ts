/* Client Nexi XPay (lato server). La API key sta SOLO qui, mai nel bundle client.
   Usa l'ambiente sandbox in test, produzione in live — basta cambiare le env. */

const key = process.env.NEXI_API_KEY;
if (!key) throw new Error("NEXI_API_KEY mancante nelle variabili d'ambiente");

export const NEXI_API_KEY = key;

// In test punta al sandbox, in produzione all'endpoint live.
// Basta impostare NEXI_ENV=production per passare al live.
export const NEXI_BASE_URL =
  process.env.NEXI_ENV === "production"
    ? "https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1"
    : "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp/api/v1";

export interface NexiHppRequest {
  order: {
    orderId: string;
    amount: string;   // importo in centesimi, come stringa
    currency: string;
    description?: string;
    customField?: string;
  };
  paymentSession: {
    actionType: "PAY";
    amount: string;
    currency: string;
    resultUrl: string;
    cancelUrl: string;
    notificationUrl: string;
    language?: string;
  };
}

export interface NexiHppResponse {
  hostedPage: string;
  securityToken: string;
}

/** Crea una sessione HPP Nexi e restituisce l'URL di redirect + securityToken. */
export async function createHppOrder(
  payload: NexiHppRequest,
  correlationId: string
): Promise<NexiHppResponse> {
  const res = await fetch(`${NEXI_BASE_URL}/orders/hpp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": NEXI_API_KEY,
      "Correlation-Id": correlationId,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Nexi HPP error ${res.status}: ${JSON.stringify(err)}`);
  }
  return res.json() as Promise<NexiHppResponse>;
}
