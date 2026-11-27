import { classSession } from "./store.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { "X-Requested-With": "StudyBuddy" }; // the server only accepts changes from our own pages
  if (body !== undefined) headers["Content-Type"] = "application/json";
  // Students identify themselves with the private token their browser got when they joined a class.
  if (path.startsWith("/api/student/") && !path.endsWith("/join")) {
    const s = classSession.get();
    if (s) headers.Authorization = `Bearer ${s.token}`;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach StudyBuddy. Check your connection and try again.", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error ?? "Something went wrong. Try again.", res.status);
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b = {}) => request("POST", p, b),
  put: (p, b = {}) => request("PUT", p, b),
  del: (p) => request("DELETE", p),
};
