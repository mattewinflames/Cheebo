/* Seed del menu completo su Firestore, autenticato come admin.
   Uso (fuori da rete aziendale):  node --env-file=.env scripts/seed.mjs
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const cfg = {
  apiKey: process.env.VITE_FB_API_KEY,
  authDomain: process.env.VITE_FB_AUTH_DOMAIN,
  projectId: process.env.VITE_FB_PROJECT_ID,
  storageBucket: process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID,
  appId: process.env.VITE_FB_APP_ID,
};
const app = initializeApp(cfg);
const db = getFirestore(app);
const auth = getAuth(app);

// login come admin (le regole consentono la scrittura del menu solo agli utenti autenticati)
await signInWithEmailAndPassword(auth, process.env.SEED_EMAIL, process.env.SEED_PASSWORD);
console.log("login ok:", auth.currentUser?.email);

/* ----------------------------------------------------------------------------
   `ingredients`  → ingredienti TOGLIIBILI, elenco fornito dal cliente (23/07/26).
                    Ciò che non è elencato NON è togliibile: patty, pollo,
                    maiale, tofu e — per il Pulled Pork — la salsa BBQ.
   `menuSurcharge` → quanto costa in più la bibita se scelta DENTRO un menu.
                     Se il campo manca si ricava dalla differenza con 2,50.
   ---------------------------------------------------------------------------- */
const MENU = [
  { id: "classic",  type: "smash", name: "Classic",   desc: "American cheese, cipolla, insalata, pomodoro, salsa Cheebo", solo: 6.0, menu: 11.5, veg: false, allergens: [1,3,6,7,10], active: true, order: 1,
    ingredients: ["American cheese", "Cipolla", "Insalata", "Pomodoro", "Salsa Cheebo"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "formvegano", name: "Formaggio vegano" }] },
  { id: "oklahoma", type: "smash", name: "Oklahoma",  desc: "American cheese, cipolla smashata, ketchup, senape", solo: 6.5, menu: 12.0, veg: false, allergens: [1,3,7,10], active: true, order: 2,
    ingredients: ["American cheese", "Cipolla smashata", "Ketchup", "Senape"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "formvegano", name: "Formaggio vegano" }] },
  { id: "crispy",   type: "smash", name: "Crispy",    desc: "American cheese, bacon, cipolla, pickles, salsa Cheebo", solo: 7.5, menu: 13.0, veg: false, allergens: [1,3,6,7,10,12], active: true, order: 3,
    ingredients: ["American cheese", "Bacon", "Cipolla", "Pickles", "Salsa Cheebo"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "formvegano", name: "Formaggio vegano" }] },
  { id: "smashveg", type: "smash", name: "Smash veg", desc: "Patty plant based, cipolla, veg cheddar, ketchup, senape", solo: 9.0, menu: 14.5, veg: true, allergens: [1,6,10], active: true, order: 4,
    ingredients: ["Cheddar", "Cipolla", "Ketchup", "Senape"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "vegcheddar", name: "Veg cheddar" }] },
  { id: "chicken",    type: "burger", name: "Chicken",     desc: "Pollo fritto, pickles, coleslaw, salsa bianca", solo: 9.0, menu: 14.5, veg: false, allergens: [1,3,7,8,10,12], active: true, order: 5, singleFormatOnly: true,
    ingredients: ["Salsa bianca", "Pickles", "Coleslaw"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }] },
  { id: "pulledpork", type: "burger", name: "Pulled Pork", desc: "Maiale sfilacciato, coleslaw, salsa BBQ", solo: 10.0, menu: 15.5, veg: false, allergens: [1,3,7,10], active: true, order: 6, singleFormatOnly: true,
    ingredients: ["Coleslaw"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }] },
  { id: "burgerveg",  type: "burger", name: "Burgerveg",   desc: "Tofu affumicato fritto, pickles, coleslaw veg, salsa", solo: 9.0, menu: 14.5, veg: true, allergens: [1,6,10,12], active: true, order: 7, singleFormatOnly: true,
    ingredients: ["Salsa", "Pickles", "Coleslaw veg"],
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "coleslawveg", name: "Coleslaw vegana" }] },

  { id: "tender",   type: "side", name: "Tender di pollo",    price: 4.5, active: true, order: 8 },
  { id: "patdolci", type: "side", name: "Patatine dolci",     price: 4.0, active: true, order: 9 },
  { id: "patfritte",type: "side", name: "Patatine fritte",    price: 3.5, active: true, order: 10 },
  { id: "trippa",   type: "side", name: "Polpette di trippa", price: 4.0, active: true, order: 11 },

  { id: "salsa-cheebo",    type: "salsa", name: "Salsa Cheebo",           price: 1.0, active: true, order: 20 },
  { id: "salsa-agrodolce", type: "salsa", name: "Salsa Agrodolce Piccante", price: 0.5, active: true, order: 21 },
  { id: "ketchup-heinz",   type: "salsa", name: "Ketchup Heinz",          price: 0.5, active: true, order: 22 },
  { id: "maionese-heinz",  type: "salsa", name: "Maionese Heinz",         price: 0.5, active: true, order: 23 },
  { id: "honey-mustard",   type: "salsa", name: "Honey Mustard Heinz",    price: 0.5, active: true, order: 24 },
  { id: "bbq-heinz",       type: "salsa", name: "BBQ Heinz",              price: 0.5, active: true, order: 25 },
  { id: "agrodolce-heinz", type: "salsa", name: "Agrodolce Heinz",        price: 0.5, active: true, order: 26 },
  { id: "curry-heinz",     type: "salsa", name: "Curry Mango Heinz",      price: 0.5, active: true, order: 27 },

  { id: "nutellone",type: "dolce", name: "Nutellone",      price: 4.0, active: true, order: 12 },
  { id: "cookies",  type: "dolce", name: "Cookies",        price: 3.0, active: true, order: 13 },
  { id: "cinnamon", type: "dolce", name: "Cinnamon Rolls", price: 4.0, active: true, order: 14 },

  /* Bibite — elenco e prezzi forniti dal cliente (23/07/26).
     `price` è il prezzo alla carta, cioè quello del catalogo fuori menu.
     `menuSurcharge` = quanto si paga in più scegliendola DENTRO un menu.
     Valori confermati dal cliente (23/07/26): tutte le bibite sono comprese
     nel menu senza sovrapprezzo — iced tea e Peroni inclusi — tranne la birra
     artigianale, che il menù stampato indica a +3
     ("panino + patatine fritte + soft drink (birra artigianale +3)"). */
  { id: "cocacola",  type: "drink", name: "Coca-Cola",                   price: 2.5, menuSurcharge: 0,   active: true, order: 15 },
  { id: "cocazero",  type: "drink", name: "Coca-Cola Zero",              price: 2.5, menuSurcharge: 0,   active: true, order: 16 },
  { id: "fanta",     type: "drink", name: "Fanta",                       price: 2.5, menuSurcharge: 0,   active: true, order: 17 },
  { id: "sevenup",   type: "drink", name: "7up",                         price: 2.5, menuSurcharge: 0,   active: true, order: 18 },
  { id: "thepesca",  type: "drink", name: "Thè alla pesca",              price: 2.5, menuSurcharge: 0,   active: true, order: 19 },
  { id: "acquanat",  type: "drink", name: "Acqua naturale",              price: 1.5, menuSurcharge: 0,   active: true, order: 20 },
  { id: "acquafriz", type: "drink", name: "Acqua frizzante",             price: 1.5, menuSurcharge: 0,   active: true, order: 21 },
  { id: "icedtea",   type: "drink", name: "Iced tea artigianale",        price: 3.5, menuSurcharge: 0,   active: true, order: 22 },
  { id: "peroni",    type: "drink", name: "Birra Peroni Nastro Azzurro", price: 3.5, menuSurcharge: 0,   active: true, order: 23 },
  { id: "birrac",    type: "drink", name: "Birra artigianale",           price: 5.0, menuSurcharge: 3,   active: true, order: 24 }, // menù stampato: +3
];

const DA_DISATTIVARE = ["soft", "birra", "acqua"];


// I tre smash di base occupano la piastra; gli altri panini no (modificabile poi da admin)
const GRIDDLE = new Set(["classic", "oklahoma", "crispy"]);

for (const m of MENU) {
  const { id, ...data } = m;
  if (m.type === "smash" || m.type === "burger") data.griddle = GRIDDLE.has(id);
  await setDoc(doc(db, "menu", id), data);
  console.log("seed:", id);
}

// Le voci uscite di listino non si cancellano (potrebbero comparire in ordini
// storici): si spengono, così spariscono dal sito ma restano consultabili.
let spente = 0;
for (const id of DA_DISATTIVARE) {
  const ref = doc(db, "menu", id);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().active !== false) {
    await updateDoc(ref, { active: false });
    console.log("disattivata:", id);
    spente++;
  }
}

console.log(`\nFatto: ${MENU.length} voci scritte, ${spente} disattivate.`);
process.exit(0);