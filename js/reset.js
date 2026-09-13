/* Reset page. Supabase-js parses the recovery token out of the URL fragment on
   load and turns it into a short-lived session; updateUser() then needs nothing
   but that session. So the job here is to wait for the session to appear, and
   say something useful when it never does — an expired or reused link is the
   normal failure, not an exception. */
document.addEventListener("DOMContentLoaded", function () {
  var API = window.FruitlyAPI;
  var form = document.getElementById("reset-form");
  var status = document.getElementById("reset-status");
  var title = document.getElementById("reset-title");
  var err = document.getElementById("reset-error");
  var submit = document.getElementById("reset-submit");
  var back = document.getElementById("reset-back");

  function fail(message) {
    status.textContent = message;
    form.hidden = true;
    back.hidden = false;
    if (!document.getElementById("reset-help")) {
      var help = document.createElement("p");
      help.id = "reset-help";
      help.className = "small muted";
      help.style.margin = "0";
      help.appendChild(document.createTextNode("Locked out for good? Email "));
      var a = document.createElement("a");
      a.href = "mailto:support@fruitly.fit";
      a.textContent = "support@fruitly.fit";
      help.appendChild(a);
      help.appendChild(document.createTextNode("."));
      back.parentNode.insertBefore(help, back.nextSibling);
    }
  }

  /* Supabase reports a dead link in the fragment rather than by throwing. */
  var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (hash.get("error")) {
    var code = hash.get("error_code") || "";
    title.textContent = "That link has expired";
    fail(/expired|otp_expired/i.test(code + " " + (hash.get("error_description") || ""))
      ? "Reset links are good for one hour and one use. Ask for a fresh one from the sign-in page."
      : (hash.get("error_description") || "That link is not valid any more.").replace(/\+/g, " "));
    return;
  }

  var settled = false;
  function ready() {
    if (settled) return;
    settled = true;
    status.textContent = "Choose something you don’t use anywhere else.";
    form.hidden = false;
    document.getElementById("f-new").focus();
  }

  /* Does this load carry a recovery token? PKCE puts a one-time code in the
     query string; the older implicit flow puts tokens in the fragment. */
  var hasToken = new URLSearchParams(location.search).has("code") ||
                 hash.has("access_token") || hash.get("type") === "recovery";

  /* When a token is present the page must wait for supabase-js to exchange it,
     and must NOT accept whatever session is already in localStorage.

     Otherwise someone already signed in as one person, opening a reset link
     belonging to another (a shared laptop, a forwarded email), gets the form
     immediately against the *cached* session — and updateUser() then changes
     the wrong account's password. So with a token we only settle on an auth
     event fired after this point, never on the session we started with. */
  API.onAuthEvent(function (event, session) {
    if (!session) return;
    if (hasToken && event !== "PASSWORD_RECOVERY" && event !== "SIGNED_IN") return;
    ready();
  });

  (async function () {
    /* No token means an ordinary signed-in visit to change a password, which
       the existing session is exactly the right thing to use. */
    if (!hasToken) {
      if (await API.session()) return ready();
    }
    for (var i = 0; i < 20; i++) {
      if (settled) return;
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    if (settled) return;
    settled = true;
    title.textContent = "This link won’t open";
    fail("Open the reset link from your email directly, or ask for a new one from the sign-in page.");
  })();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    var a = document.getElementById("f-new").value;
    var b = document.getElementById("f-confirm").value;
    if (a.length < 8) { err.textContent = "Use at least 8 characters."; return; }
    if (a !== b) { err.textContent = "Those two don’t match."; return; }

    submit.disabled = true;
    var was = submit.textContent;
    submit.textContent = "Saving…";
    try {
      await API.updatePassword(a);
      title.textContent = "Password changed";
      form.hidden = true;
      status.textContent = "You’re signed in on this device. Use the new password next time.";
      back.textContent = "Go to your account";
      back.href = "account.html";
      back.hidden = false;
    } catch (ex) {
      err.textContent = ex.message;
      submit.disabled = false;
      submit.textContent = was;
    }
  });
});
