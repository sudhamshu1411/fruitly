/* Where people land after clicking a confirmation link or finishing with
   Google. supabase-js exchanges the code or fragment for a session on load;
   this page's job is to wait for that, then get out of the way — and to say
   something useful when it doesn't happen, because an expired link and a
   declined Google consent screen are both ordinary outcomes, not crashes. */
document.addEventListener("DOMContentLoaded", function () {
  var API = window.FruitlyAPI;
  var title = document.getElementById("cb-title");
  var message = document.getElementById("cb-message");
  var spinner = document.getElementById("cb-spinner");
  var actions = document.getElementById("cb-actions");
  var primary = document.getElementById("cb-primary");

  /* Same allow-list as auth.js: a bare page in this site, nothing else, so a
     tampered ?next= cannot redirect someone off-origin with a live session. */
  function safeNext() {
    var next = new URLSearchParams(location.search).get("next") || "account.html";
    return /^[a-z0-9-]+\.html$/.test(next) ? next : "account.html";
  }

  function fail(headline, detail, offerHelp) {
    spinner.hidden = true;
    title.textContent = headline;
    message.textContent = detail;
    actions.hidden = false;
    // Someone who cannot get in has no other route to us, so give them one.
    if (offerHelp) {
      var help = document.createElement("p");
      help.className = "small muted";
      help.style.margin = "0";
      help.appendChild(document.createTextNode("Still stuck? Email "));
      var a = document.createElement("a");
      a.href = "mailto:support@fruitly.fit";
      a.textContent = "support@fruitly.fit";
      help.appendChild(a);
      help.appendChild(document.createTextNode(" and we'll sort it out."));
      actions.appendChild(help);
    }
  }

  /* Supabase reports failures in the query string (PKCE) or the fragment
     (implicit), depending on the flow — check both. */
  var qs = new URLSearchParams(location.search);
  var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  var errCode = qs.get("error_code") || hash.get("error_code") || "";
  var errName = qs.get("error") || hash.get("error") || "";
  var errText = (qs.get("error_description") || hash.get("error_description") || "").replace(/\+/g, " ");

  if (errName || errCode) {
    if (/expired|otp_expired/i.test(errCode + " " + errText)) {
      title.textContent = "That link has expired";
      fail("That link has expired",
        "Confirmation links are good for one hour and one use. Ask for a fresh one from the sign-in page.");
    } else if (/access_denied/i.test(errName)) {
      fail("Sign-in cancelled", "You didn’t finish at Google, so nothing has changed. You can try again whenever.");
    } else {
      fail("That didn’t work", errText || "The link is no longer valid. Try signing in again.", true);
    }
    return;
  }

  var settled = false;
  function done(session) {
    if (settled) return;
    settled = true;
    title.textContent = "You’re in";
    message.textContent = "Taking you to your account…";
    // replace() so the callback URL — which carried the one-time code — does
    // not sit in history for the back button to re-trigger.
    location.replace(safeNext());
  }

  API.onAuthEvent(function (_event, session) { if (session) done(session); });

  (async function () {
    for (var i = 0; i < 30; i++) {
      if (settled) return;
      var s = await API.session();
      if (s) return done(s);
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    if (settled) return;
    settled = true;
    fail("We couldn’t finish signing you in",
      "The link may have already been used. Open the most recent email, or sign in with your password.", true);
  })();
});
