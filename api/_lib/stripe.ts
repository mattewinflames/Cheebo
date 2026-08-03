/* Client Stripe (lato server). La secret key sta SOLO qui, mai nel bundle client.
   Nessuna apiVersion esplicita: si usa quella di default dell'account, così non
   si lega il codice a un literal che cambia fra le versioni dell'SDK. */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY mancante nelle variabili d'ambiente");

export const stripe = new Stripe(key);
