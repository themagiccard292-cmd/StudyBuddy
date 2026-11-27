import { api } from "../api.js";
import { navigate } from "../router.js";

/** Teacher pages call this first. Returns the teacher, or sends the visitor to the login page. */
export async function requireTeacher() {
  const { user } = await api.get("/api/auth/me");
  if (!user) {
    navigate("/login", { replace: true });
    return null;
  }
  window.__setTeacher?.(user);
  return user;
}
