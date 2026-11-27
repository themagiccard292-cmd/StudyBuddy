// Small shared HTTP helpers.
import { randomBytes, randomInt, createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const newId = () => randomBytes(4).toString("hex");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- tiny validators: throw a friendly 400 instead of crashing ----
export function str(value, { name = "value", min = 0, max = 10000, trim = true, optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    if (min > 0) throw new HttpError(400, `${name} is required.`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be text.`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, `${name} is too short.`);
  if (v.length > max) throw new HttpError(400, `${name} is too long (max ${max.toLocaleString()} characters).`);
  return v;
}

export function int(value, { name = "value", min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} isn't valid.`);
  return n;
}

export function oneOf(value, allowed, { name = "value", fallback } = {}) {
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new HttpError(400, `${name} isn't valid.`);
  return value;
}

export function list(value, { name = "list", max = 50, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return [];
    throw new HttpError(400, `${name} is required.`);
  }
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be a list.`);
  if (value.length > max) throw new HttpError(400, `${name} has too many items.`);
  return value;
}

/** snake_case row keys -> camelCase (database rows -> JSON for the browser). */
export const camel = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
