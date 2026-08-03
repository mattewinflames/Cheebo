/* CHEEBO · Menu store (Firestore) — tutte le voci del menu */
import {
  collection, doc, onSnapshot, query, orderBy, where,
  setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { MenuItem } from "./menu";

export function subscribeMenu(cb: (items: MenuItem[]) => void, onlyActive = false): () => void {
  const base = collection(db, "menu");
  const q = onlyActive
    ? query(base, where("active", "==", true), orderBy("order", "asc"))
    : query(base, orderBy("order", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MenuItem[]));
}

export async function saveItem(item: MenuItem): Promise<void> {
  const { id, ...data } = item;
  await setDoc(doc(db, "menu", id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
export async function setActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, "menu", id), { active, updatedAt: serverTimestamp() });
}
export async function removeItem(id: string): Promise<void> {
  await deleteDoc(doc(db, "menu", id));
}
