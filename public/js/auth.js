// Who is logged in (a teacher, a student, or nobody). The login itself is an HttpOnly cookie the browser keeps;
// this just remembers what /api/auth/me said so the header and pages can react.
import { api } from "./api.js";
import { classSession } from "./store.js";

let user; // undefined = not asked yet, null = logged out, otherwise { id, role, displayName, username, email }
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

export const auth = {
  get: () => user,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(u) {
    user = u;
    notify();
  },
  async refresh() {
    try {
      user = (await api.get("/api/auth/me")).user;
      // A class picked through a student account (no device token) belongs to that login. If the login has ended
      // (logged out elsewhere, password reset, expired) don't keep showing that student's class on this device.
      const s = classSession.get();
      if (s && !s.token && user?.role !== "student") classSession.clear();
    } catch {
      user = null;
    }
    notify();
    return user;
  },
  async logout() {
    await api.post("/api/auth/logout").catch(() => {});
    // A class chosen through an account belongs to that account; a guest's device token stays with the device.
    if (classSession.get() && !classSession.get().token) classSession.clear();
    user = null;
    notify();
  },
};

export const currentUser = async () => (auth.get() === undefined ? auth.refresh() : auth.get());
