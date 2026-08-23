// Fruitly · signup edge function
// Creates a confirmed user via the admin API so account creation works
// instantly without an SMTP setup. The service-role key never leaves the
// server; the client only ever gets back "ok" and then signs in normally.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let payload: { email?: string; password?: string; full_name?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const password = payload.password ?? "";
  const fullName = (payload.full_name ?? "").trim().slice(0, 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return json(400, { error: "enter a valid email address" });
  }
  if (password.length < 8 || password.length > 72) {
    return json(400, { error: "password must be 8–72 characters" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    return json(exists ? 409 : 400, {
      error: exists ? "that email already has a Fruitly account — sign in instead" : error.message,
    });
  }
  return json(200, { ok: true });
});
