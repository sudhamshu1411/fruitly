// Fruitly · signup edge function — RETIRED
//
// This used to create accounts through admin.createUser with
// email_confirm: true, which was the only way to get a usable account when
// the project had no SMTP configured.
//
// Signup now goes through supabase.auth.signUp() from the browser, so the
// address is actually proven before the account can be used. That makes this
// function a confirmation bypass: anyone holding the public anon key could
// still call it and mint a pre-confirmed account for an address they do not
// own. Deleting an edge function is not something the deploy tooling here can
// do, so it is replaced with a tombstone that refuses every request.
//
// Do not restore this. If a server-side signup path is ever needed again,
// write one that sends a confirmation link instead of skipping it.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "This endpoint has been retired. Sign up from the site." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
