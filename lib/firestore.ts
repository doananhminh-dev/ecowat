import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export type UserRole = "user" | "admin";

export type Device = {
  id: number;
  name: string;
  power: number;
  quantity: number;
  hours: number;
};

export type UserEnergyData = {
  usageType: "Sinh hoạt / Trường học" | "Doanh nghiệp / Công ty";
  billingMode: "Đơn giá cố định" | "Biểu giá EVN";
  devices: Device[];
  price: string;
  days: string;
  savingGoal: string;
  savedEnergy: number;
  savedCost: number;
};

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt?: unknown;
  updatedAt?: unknown;
  data: UserEnergyData;
};

export const defaultEnergyData: UserEnergyData = {
  usageType: "Sinh hoạt / Trường học",
  billingMode: "Biểu giá EVN",
  devices: [],
  price: "0",
  days: "0",
  savingGoal: "0",
  savedEnergy: 0,
  savedCost: 0,
};

export async function ensureUserProfile(params: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  forceAdmin?: boolean;
}) {
  const ref = doc(db, "users", params.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: params.uid,
      email: params.email || "",
      displayName: params.displayName || "",
      role: params.forceAdmin ? "admin" : "user",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      data: defaultEnergyData,
    });
    return;
  }

  const current = snap.data() as UserProfile;

  await updateDoc(ref, {
    email: params.email || current.email || "",
    displayName: params.displayName || current.displayName || "",
    role: params.forceAdmin ? "admin" : current.role || "user",
    updatedAt: serverTimestamp(),
  });
}

export function subscribeUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void
) {
  const ref = doc(db, "users", uid);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback(snap.data() as UserProfile);
  });
}

export async function saveUserEnergyData(uid: string, data: UserEnergyData) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    data,
    updatedAt: serverTimestamp(),
  });
}