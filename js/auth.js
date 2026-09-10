/* Sign in, sign up with email confirmation, and Continue with Google.
   Two rules govern the messaging here:
     1. Never reveal whether an address has an account. Supabase already
        returns success for a duplicate signup; this file must not undo that
        by saying "already registered".
     2. An unconfirmed account is a dead end unless we offer the way out, so
        "email not confirmed" gets a resend button rather than a shrug. */
document.addEventListener("DOMContentLoaded", function () {
  var API = window.FruitlyAPI;
  var mode = "signin";
  var lastEmail = "";

  var tabs = { signin: document.getElementById("tab-signin"), signup: document.getElementById("tab-signup") };
  var nameField = document.getElementById("name-field");
  var submit = document.getElementById("auth-submit");
  var err = document.getElementById("auth-error");
  var pw = document.getElementById("f-password");
  var emailIn = document.getElementById("f-email");
  var note = document.getElementById("auth-note");
  var forgot = document.getElementById("forgot");
  var resend = document.getElementById("resend");
  var googleBtn = document.getElementById("google-btn");
  var googleLabel = document.getElementById("google-label");
  var authCard = document.getElementById("auth-card");
  var sentCard = document.getElementById("sent-card");

  /* Only ever navigate to a bare page in this site. Anything else — a scheme,
     a protocol-relative //host, a path — is discarded, so ?next= cannot be
     used to bounce someone to another origin after they sign in. */
  function safeNext() {
    var next = new URLSearchParams(location.search).get("next") || "account.html";
    return /^[a-z0-9-]+\.html$/.test(next) ? next : "account.html";
  }

  function setMode(m) {
    mode = m;
    Object.keys(tabs).forEach(function (k) {
      tabs[k].classList.toggle("is-on", k === m);
      tabs[k].setAttribute("aria-selected", k === m ? "true" : "false");
    });
    nameField.hidden = m !== "signup";
    submit.textContent = m === "signup" ? "Create account" : "Sign in";
    pw.autocomplete = m === "signup" ? "new-password" : "current-password";
    pw.placeholder = m === "signup" ? "8+ characters" : "Your password";
    googleLabel.textContent = m === "signup" ? "Sign up with Google" : "Continue with Google";
    err.textContent = "";
    note.textContent = "";
    forgot.hidden = m !== "signin";
    resend.hidden = true;
  }
  tabs.signin.addEventListener("click", function () { setMode("signin"); });
  tabs.signup.addEventListener("click", function () { setMode("signup"); });

  /* ---------- Google ---------- */
  googleBtn.addEventListener("click", async function () {
    err.textContent = "";
    note.textContent = "";
    googleBtn.disabled = true;
    var was = googleLabel.textContent;
    googleLabel.textContent = "Taking you to Google…";
    try {
      // Redirects away on success, so nothing after this runs in the happy path.
      await API.signInWithGoogle(safeNext());
    } catch (ex) {
      googleBtn.disabled = false;
      googleLabel.textContent = was;
      err.textContent = /provider is not enabled/i.test(ex.message)
        ? "Google sign-in isn’t switched on for this site yet."
        : ex.message;
    }
  });

  /* ---------- confirmation panel ---------- */
  function showSent(email) {
    lastEmail = email;
    document.getElementById("sent-email").textContent = email;
    authCard.hidden = true;
    sentCard.hidden = false;
  }

  document.getElementById("sent-back").addEventListener("click", function () {
    sentCard.hidden = true;
    authCard.hidden = false;
    setMode("signup");
    emailIn.value = "";
    emailIn.focus();
  });

  /* Shared by both resend affordances. Supabase rate-limits resends server
     side; the local cooldown just stops someone hammering the button into
     that error. */
  function wireResend(btn, target, idleLabel) {
    btn.addEventListener("click", async function () {
      var email = (target === "sent" ? lastEmail : emailIn.value.trim());
      if (!email) {
        err.textContent = "Enter your email above first.";
        emailIn.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = "Sending…";
      try { await API.resendConfirmation(email, safeNext()); } catch (ex) { /* see below */ }
      // Same wording whatever happened — a failure here would otherwise say
      // whether the address exists or is already confirmed.
      var out = target === "sent" ? document.getElementById("sent-note") : note;
      out.textContent = "Sent. Give it a minute.";
      var left = 30;
      btn.textContent = "Wait " + left + "s";
      var tick = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(tick);
          btn.disabled = false;
          btn.textContent = idleLabel;
        } else {
          btn.textContent = "Wait " + left + "s";
        }
      }, 1000);
    });
  }
  wireResend(document.getElementById("sent-resend"), "sent", "Send it again");
  wireResend(resend, "form", "Resend the confirmation email");

  /* ---------- forgot password ---------- */
  forgot.addEventListener("click", async function () {
    var email = emailIn.value.trim();
    err.textContent = "";
    note.textContent = "";
    if (!email) {
      err.textContent = "Enter your email above first, then tap this again.";
      emailIn.focus();
      return;
    }
    forgot.disabled = true;
    var was = forgot.textContent;
    forgot.textContent = "Sending…";
    try {
      await API.requestPasswordReset(email);
    } catch (ex) {
      // Deliberately not surfaced: a failure would reveal whether the address
      // is registered.
    }
    note.textContent = "If that email has a Fruitly account, a reset link is on its way.";
    forgot.disabled = false;
    forgot.textContent = was;
  });

  /* ---------- email + password ---------- */
  document.getElementById("auth-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    note.textContent = "";
    resend.hidden = true;

    var email = emailIn.value.trim();
    var password = pw.value;
    var name = document.getElementById("f-name").value.trim();

    if (!email || password.length < 8) {
      err.textContent = "Enter your email and a password of 8+ characters.";
      return;
    }

    submit.disabled = true;
    submit.textContent = mode === "signup" ? "Creating…" : "Signing in…";

    try {
      if (mode === "signup") {
        var res = await API.signUp(email, password, name, safeNext());
        if (res.needsConfirmation) {
          // Shown identically for a brand-new address and one that already has
          // an account, because saying which would leak who is registered.
          showSent(email);
          return;
        }
        location.href = safeNext();   // confirmation switched off on the project
        return;
      }

      await API.signIn(email, password);
      location.href = safeNext();
    } catch (ex) {
      var m = ex.message || "";
      submit.disabled = false;
      setMode(mode);

      if (/email not confirmed/i.test(m)) {
        err.textContent = "This account still needs confirming — check your inbox.";
        resend.hidden = false;
      } else if (/invalid login credentials/i.test(m)) {
        err.textContent = "That email and password don’t match.";
      } else if (/rate limit|too many|for security purposes|after \d+ seconds/i.test(m)) {
        // Supabase phrases its throttle as "For security purposes, you can only
        // request this after N seconds" — not the word "rate limit" at all.
        var wait = m.match(/after (\d+) seconds?/i);
        err.textContent = wait
          ? "Too many attempts just now. Try again in " + wait[1] + " seconds."
          : "Too many attempts just now. Give it a minute.";
      } else {
        err.textContent = m;
      }
    }
  });
});
