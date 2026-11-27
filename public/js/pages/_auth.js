import { currentUser } from "../auth.js";
import { classSession } from "../store.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";

/** Teacher pages call this first. Returns the teacher, or sends the visitor somewhere sensible. */
export async function requireTeacher() {
  const user = await currentUser();
  if (!user) {
    navigate("/login?role=teacher", { replace: true });
    return null;
  }
  if (user.role !== "teacher") {
    toast("That page is for teachers.", { error: true });
    navigate("/", { replace: true });
    return null;
  }
  return user;
}

/**
 * Student pages call this first. True when there is a class to work in: a guest's device token, or a logged-in
 * student with a chosen class. Otherwise the visitor is sent to where they can pick or join one.
 */
export async function requireStudentClass() {
  const session = classSession.get();
  if (session?.token) return true;
  const user = await currentUser();
  if (user?.role === "student") {
    if (session?.classId) return true; // the server double-checks the account really is in that class
    navigate("/class", { replace: true });
    return false;
  }
  navigate("/join", { replace: true });
  return false;
}
