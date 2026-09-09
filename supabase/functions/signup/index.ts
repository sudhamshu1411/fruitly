// Fruitly · signup edge function
// Creates a confirmed user via the admin API so account creation works
// instantly without an SMTP setup. The service-role key never leaves the
// server; the client only ever gets back "ok" and then signs in normally.
//
// Because it goes through admin.createUser, Supabase Auth's own signup rate
// limits never apply — so this function does its own throttling. The endpoint
// is reachable by anyone holding the public anon key, which is by design (a
// visitor has no account yet) and is exactly why the throttle matters.

import { createClient } from "npm:@supabase/supabase-js@2";

// Browser origins permitted to call this. Leaving ALLOWED_ORIGINS unset keeps
// the original "any origin" behaviour; set it to the site's origins (comma
// separated) to lock it down. CORS only ever constrains browsers — a script
// ignores it entirely — so the throttle below is the control that matters.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.length === 0) headers["Access-Control-Allow-Origin"] = "*";
  else if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST only" });

  let payload: { email?: string; password?: string; full_name?: string };
  try {
    payload = await req.json();
  } catch {
    return json(req, 400, { error: "invalid JSON body" });
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const password = payload.password ?? "";
  const fullName = (payload.full_name ?? "").trim().slice(0, 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return json(req, 400, { error: "enter a valid email address" });
  }
  if (password.length < 8 || password.length > 72) {
    return json(req, 400, { error: "password must be 8–72 characters" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Per-IP budget: 5 an hour, 20 a day. note_signup_attempt records the attempt
  // and returns false once the caller is over it. Only an explicit false
  // blocks — if the check itself errors we let the request through, since the
  // database answering it is the same one createUser needs anyway.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  try {
    const { data, error: throttleError } = await admin.rpc("note_signup_attempt", {
      p_ip_hash: await sha256Hex(ip || "unknown"),
    });
    if (!throttleError && data === false) {
      return json(req, 429, {
        error: "too many sign-up attempts from here — try again in an hour",
      });
    }
  } catch {
    // fall through: never let a throttle outage take signup down with it
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return json(req, exists ? 409 : 400, {
      error: exists ? "that email already has a Fruitly account — sign in instead" : error.message,
    });
  }
  return json(req, 200, { ok: true });
});
