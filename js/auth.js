document.addEventListener("DOMContentLoaded", function () {
  var mode = "signin";
  var tabs = { signin: document.getElementById("tab-signin"), signup: document.getElementById("tab-signup") };
  var nameField = document.getElementById("name-field");
  var submit = document.getElementById("auth-submit");
  var err = document.getElementById("auth-error");
  var pw = document.getElementById("f-password");
  var note = document.getElementById("auth-note");
  var forgot = document.getElementById("forgot");

  function setMode(m) {
    mode = m;
    Object.keys(tabs).forEach(function (k) {
      tabs[k].classList.toggle("is-on", k === m);
      tabs[k].setAttribute("aria-selected", k === m ? "true" : "false");
    });
    nameField.hidden = m !== "signup";
    submit.textContent = m === "signup" ? "Create account" : "Sign in";
    pw.autocomplete = m === "signup" ? "new-password" : "current-password";
    err.textContent = "";
    note.textContent = "";
    forgot.hidden = m !== "signin";
  }
  tabs.signin.addEventListener("click", function () { setMode("signin"); });
  tabs.signup.addEventListener("click", function () { setMode("signup"); });

  forgot.addEventListener("click", async function () {
    var email = document.getElementById("f-email").value.trim();
    err.textContent = "";
    note.textContent = "";
    if (!email) {
      err.textContent = "Enter your email above first, then tap this again.";
      document.getElementById("f-email").focus();
      return;
    }
    forgot.disabled = true;
    var was = forgot.textContent;
    forgot.textContent = "Sending…";
    try {
      await FruitlyAPI.requestPasswordReset(email);
    } catch (ex) {
      // Deliberately not surfaced: a failure here would otherwise reveal
      // whether the address is registered.
    }
    // Same wording either way, so this never confirms who has an account.
    note.textContent = "If that email has a Fruitly account, a reset link is on its way.";
    forgot.disabled = false;
    forgot.textContent = was;
  });

  document.getElementById("auth-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    note.textContent = "";
    var email = document.getElementById("f-email").value.trim();
    var password = pw.value;
    var name = document.getElementById("f-name").value.trim();
    if (!email || password.length < 8) {
      err.textContent = "Enter your email and a password of 8+ characters.";
      return;
    }
    submit.disabled = true;
    submit.textContent = mode === "signup" ? "Creating…" : "Signing in…";
    try {
      if (mode === "signup") await FruitlyAPI.signUp(email, password, name);
      else await FruitlyAPI.signIn(email, password);
      var next = new URLSearchParams(location.search).get("next") || "account.html";
      if (!/^[a-z0-9-]+\.html$/.test(next)) next = "account.html";
      location.href = next;
    } catch (ex) {
      var message = ex.message === "Invalid login credentials"
        ? "That email and password don’t match."
        : ex.message;
      submit.disabled = false;
      setMode(mode);
      err.textContent = message;
    }
  });
});
