import { supabase } from "./supabase";

/** Postgres errors raised by our functions are written for people; show them as they are. */
export function messageFrom(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message: unknown }).message);
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "Could not reach ConnectMe. Check your internet connection and try again.";
    if (/jwt|not authenticated/i.test(m)) return "Your session has expired. Sign in again to continue.";
    return m;
  }
  return "Something went wrong. Try again.";
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFrom(error));
  return data as T;
}

export function publicUrl(bucket: "avatars" | "portfolio", path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function signedUrl(bucket: "verification" | "request-photos", path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** Shrinks large phone photos before upload so registration works on slow networks. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<File | Blob> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadFile(bucket: string, userId: string, kind: string, file: File): Promise<string> {
  const body = await compressImage(file);
  const ext = body.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${userId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType: body.type || undefined });
  if (error) throw new Error(error.message.includes("exceeded") ? "That file is too large. Choose one under 10 MB." : "The upload failed. Check your connection and try again.");
  return path;
}

export class FunctionUnavailable extends Error {}

/**
 * Calls a server function. Throws FunctionUnavailable when it is not deployed or not configured (404/501/network),
 * so callers can fall back to the manual path. Other errors carry the function's own message.
 */
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error, response } = await supabase.functions.invoke(name, { body });
  if (error) {
    const status = (response as Response | undefined)?.status;
    if (status === 404 || status === 501 || !status) throw new FunctionUnavailable(name);
    let msg = messageFrom(error);
    try { const j = await (response as Response).json(); if (j?.message) msg = j.message; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as T;
}
