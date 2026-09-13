/* Live configuration check.

   Supabase exposes GET /auth/v1/settings unauthenticated (it is what the client
   library itself reads to know which buttons to show), so a browser can ask the
   project directly which providers are on and whether confirmation is enforced.
   That is the half of this setup that lives in a dashboard rather than in the
   repo, and therefore the half that silently drifts.

   Nothing here writes configuration. It reads, compares against what this site
   needs, and names the exact screen to fix each miss. */
document.addEventListener("DOMContentLoaded", function () {
  var CFG = window.FRUITLY_CONFIG;
  var list = document.getElementById("checks");
  var tally = document.getElementById("tally");
  var results = [];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  }); }

  /* Built with DOM nodes rather than innerHTML: some of what is rendered is a
     server-supplied error string, and this page exists to be trusted. */
  function add(state, name, note, fix, copyValue) {
    results.push(state);
    var row = document.createElement("div");
    row.className = "chk";
    row.setAttribute("data-state", state);

    var dot = document.createElement("div");
    dot.className = "chk__dot";
    row.appendChild(dot);

    var body = document.createElement("div");
    body.className = "chk__body";

    var h = document.createElement("p");
    h.className = "chk__name";
    h.textContent = name;
    body.appendChild(h);

    if (note) {
      var n = document.createElement("p");
      n.className = "chk__note";
      n.textContent = note;
      body.appendChild(n);
    }

    if (fix) {
      var f = document.createElement("p");
      f.className = "chk__fix";
      f.innerHTML = fix;   // fix strings are authored here, never server data
      body.appendChild(f);
    }

    if (copyValue) {
      var rowc = document.createElement("div");
      rowc.className = "copyrow";
      var code = document.createElement("code");
      code.textContent = copyValue;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(copyValue).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1400);
        }, function () { btn.textContent = "Press ⌘C"; });
      });
      rowc.appendChild(code);
      rowc.appendChild(btn);
      body.appendChild(rowc);
    }

    row.appendChild(body);
    list.appendChild(row);
  }

  function summarise() {
    var bad = results.filter(function (r) { return r === "fail"; }).length;
    var warn = results.filter(function (r) { return r === "warn"; }).length;
    if (bad === 0 && warn === 0) {
      tally.textContent = "Everything this page can see is configured correctly.";
      tally.style.color = "var(--green)";
    } else {
      tally.textContent = bad + " to fix" + (warn ? ", " + warn + " to look at" : "") + ".";
      tally.style.color = bad ? "#B3330E" : "#C2731A";
    }
  }

  /* ---------- origin ---------- */
  var origin = location.origin;
  var base = origin + location.pathname.replace(/[^/]*$/, "");

  if (/^https:\/\/fruitly\.fit$/.test(origin)) {
    add("pass", "Origin", "You are on https://fruitly.fit — the canonical origin.");
  } else if (/^https:\/\/www\.fruitly\.fit$/.test(origin)) {
    add("fail", "Origin",
      "You are on www.fruitly.fit. A session created here belongs to a different origin than one created on the apex, so OAuth can return someone to a page with no session.",
      "The apex redirect is not taking effect. Check <b>Vercel → Settings → Domains</b> has <code>fruitly.fit</code> as primary.");
  } else {
    add("warn", "Origin",
      "You are on " + origin + ", not https://fruitly.fit. Results below still apply, but every URL this page suggests is built from this origin — so run it again on the real domain before trusting them.");
  }

  /* ---------- what Supabase must allow ---------- */
  add("pass", "URLs Supabase must accept",
    "Authentication → URL Configuration. Site URL is the first line; both of the others belong in Redirect URLs. Supabase refuses to redirect anywhere unlisted, and does it silently.",
    null,
    "https://fruitly.fit\n" + base + "auth-callback.html\n" + base + "reset.html");

  /* ---------- live settings ---------- */
  fetch(CFG.url + "/auth/v1/settings", { headers: { apikey: CFG.anonKey } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (s) {
      var ext = s.external || {};

      /* mailer_autoconfirm true means Supabase confirms addresses itself —
         i.e. the confirmation email is switched OFF. */
      if (s.mailer_autoconfirm === true) {
        add("fail", "Email confirmation is OFF",
          "Supabase is auto-confirming every address, so nobody has to prove they own the email they signed up with.",
          "This is the pre-account-takeover hole: Supabase links identities sharing an address and only discards <i>unconfirmed</i> ones, so a stranger can register your customer's address with a password of their choosing, wait for them to use Continue with Google, and keep a working password on their account. Turn <b>Confirm email</b> ON in <b>Authentication → Sign In / Providers → Email</b> before Google goes live.");
      } else {
        add("pass", "Email confirmation", "On. Accounts cannot sign in until the emailed link is clicked.");
      }

      if (s.disable_signup === true) {
        add("fail", "Signups are disabled",
          "Nobody can create an account. Signup returns “Signups not allowed for this instance”.",
          "Turn <b>Allow new users to sign up</b> ON in <b>Authentication → Sign In / Providers → Email</b>. It is the signup path now — the throttled edge function it used to route around has been retired.");
      } else {
        add("pass", "Signups", "Allowed.");
      }

      if (ext.email === false) {
        add("fail", "Email provider is off", "Password sign-in is disabled entirely.",
          "Enable <b>Email</b> in <b>Authentication → Sign In / Providers</b>.");
      } else {
        add("pass", "Email + password", "Enabled.");
      }

      if (ext.google === true) {
        add("pass", "Google sign-in", "The provider is enabled in Supabase.");
      } else {
        add("fail", "Google sign-in is not enabled",
          "The button on the sign-in page will fail. No Google identity has ever been created on this project.",
          "Paste your Client ID and Secret into <b>Authentication → Sign In / Providers → Google</b>. In Google Cloud the authorised redirect URI is Supabase's, not this site's — that is what trips most people up:",
          CFG.url + "/auth/v1/callback");
      }

      summarise();
    })
    .catch(function (e) {
      add("fail", "Could not reach Supabase",
        "GET /auth/v1/settings failed: " + e.message,
        "Check <code>js/config.js</code> points at the right project and that the project is not paused.");
      summarise();
    });

  /* ---------- live signup test ---------- */
  var form = document.getElementById("test-form");
  var err = document.getElementById("test-error");
  var submit = document.getElementById("test-submit");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    err.style.color = "#B3330E";
    var email = document.getElementById("test-email").value.trim();
    if (!email) { err.textContent = "Enter an address."; return; }

    submit.disabled = true;
    var was = submit.textContent;
    submit.textContent = "Sending…";
    try {
      /* A throwaway password: this account is a probe. It still has to satisfy
         the project's minimum length. */
      var pw = "Fx" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "!9";
      var out = await window.FruitlyAPI.signUp(email, pw, "Auth check", "account.html");
      err.style.color = "var(--green)";
      err.textContent = out.alreadyRegistered
        ? "That address already has an account, so no new signup mail was sent. Try one that does not."
        : "Accepted. If SMTP is configured the mail is on its way — check the inbox, and check it came from support@fruitly.fit.";
    } catch (ex) {
      var m = ex.message || String(ex);
      if (/sending.*email|smtp|mail/i.test(m)) {
        err.textContent = m + " — that is SMTP. Custom SMTP is not set, or the host/username/password is wrong.";
      } else if (/only request this after|rate/i.test(m)) {
        err.textContent = m + " — Supabase's own throttle, not a fault. Wait and retry.";
      } else if (/signups not allowed/i.test(m)) {
        err.textContent = m + " — turn on Allow new users to sign up.";
      } else {
        err.textContent = m;
      }
    }
    submit.disabled = false;
    submit.textContent = was;
  });
});
