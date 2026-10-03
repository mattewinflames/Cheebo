import {
  collection, doc, onSnapshot, query, orderBy, where,
  setDoc, updateDoc, deleteDoc, serverTimestamp, deleteField,
} from "firebase/firestore";
import { db } from "./firebase";
import type { MenuItem } from "./menu";

export function subscribeMenu(
  cb: (items: MenuItem[]) => void,
  onlyActive = false,
  onError?: (e: Error) => void,
): () => void {
  const base = collection(db, "menu");
  const q = onlyActive
    ? query(base, where("active", "==", true), orderBy("order", "asc"))
    : query(base, orderBy("order", "asc"));

  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let unsub: (() => void) | null = null;
  let retries = 0;

  const subscribe = () => {
    unsub = onSnapshot(
      q,
      (snap) => {
        retries = 0;
        cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MenuItem[]);
      },
      (err) => {
        console.error("[subscribeMenu] errore:", err);
        onError?.(err);
        // Retry esponenziale: 2s, 4s, 8s… max 30s
        const delay = Math.min(2000 * Math.pow(2, retries), 30000);
        retries++;
        retryTimeout = setTimeout(subscribe, delay);
      },
    );
  };

  subscribe();

  return () => {
    if (retryTimeout) clearTimeout(retryTimeout);
    unsub?.();
  };
}

export async function saveItem(item: MenuItem): Promise<void> {
  const { id, ...data } = item;
  // limitedStock null → rimuove il campo da Firestore (torna a vendita libera)
  const payload: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  if (payload["limitedStock"] == null) payload["limitedStock"] = deleteField();
  await setDoc(doc(db, "menu", id), payload, { merge: true });
}

export async function setActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, "menu", id), { active, updatedAt: serverTimestamp() });
}

export async function removeItem(id: string): Promise<void> {
  await deleteDoc(doc(db, "menu", id));
}
