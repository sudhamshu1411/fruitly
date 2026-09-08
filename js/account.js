/* Account — profile, addresses, never-send list, subscription summary. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    var F = window.Fruitly, API = window.FruitlyAPI;
    var root = document.getElementById("account-root");
    if (!F || !API || !root) return;

    var session = await API.requireSession("account.html");
    if (!session) return;

    var profile, addresses, excluded, sub, catalog = [];
    try {
      profile = await API.profile();
      addresses = await API.addresses();
      excluded = (await API.exclusions()).map(function (r) { return r.fruit_id; });
      sub = await API.mySubscription();
      catalog = await API.fruits();
    } catch (e) {
      root.innerHTML = "";
      root.appendChild(el("p", "lede", "Couldn’t load your account — " + e.message));
      return;
    }

    renderHeader();
    render();

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function input(id, label, value, placeholder) {
      var wrap = el("label");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:8px";
      wrap.appendChild(el("span", "small muted", label));
      var inp = el("input");
      inp.id = id;
      inp.type = "text";
      inp.value = value || "";
      inp.placeholder = placeholder || "";
      inp.style.cssText = "height:48px;padding:0 18px;border-radius:var(--r-input);border:1px solid rgba(19,42,29,0.14);background:#fff;font:400 15px/1 var(--sans)";
      wrap.appendChild(inp);
      return wrap;
    }

    function renderHeader() {
      var head = document.getElementById("account-head");
      head.innerHTML = "";
      var initial = (profile.full_name || session.user.email || "F").trim().charAt(0).toUpperCase();
      var av = el("span", null, initial);
      av.style.cssText = "width:64px;height:64px;border-radius:999px;background:var(--green);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:var(--display);font-variation-settings:'wdth' 112;font-weight:700;font-size:24px";
      head.appendChild(av);
      var col = el("div");
      col.style.cssText = "display:flex;flex-direction:column;gap:6px";
      var h = el("h1", "h1", profile.full_name || "Your account");
      h.style.fontSize = "clamp(30px,3vw,42px)";
      col.appendChild(h);
      var since = new Date(profile.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      col.appendChild(el("span", "small muted", session.user.email + " · Fruitly member since " + since));
      head.appendChild(col);
      var out = el("button", "btn btn--outline btn--sm", "Sign out");
      out.type = "button";
      out.style.marginLeft = "auto";
      out.addEventListener("click", async function () {
        await API.signOut();
        location.href = "index.html";
      });
      head.appendChild(out);
    }

    function render() {
      root.innerHTML = "";

      /* ---- profile card ---- */
      var pc = el("div", "card");
      pc.style.cssText = "padding:30px 34px 34px;display:flex;flex-direction:column;gap:18px";
      pc.appendChild(el("span", "label", "Profile"));
      pc.appendChild(input("p-name", "Your name", profile.full_name, "Asha Rao"));
      pc.appendChild(input("p-phone", "Phone", profile.phone, "+91 …"));
      pc.appendChild(input("p-note", "Doorstep note", profile.doorstep_note, "Leave with security"));
      var save = el("button", "btn btn--green btn--sm", "Save profile");
      save.type = "button";
      save.style.alignSelf = "flex-start";
      save.addEventListener("click", async function () {
        save.disabled = true;
        try {
          profile = await API.saveProfile({
            full_name: document.getElementById("p-name").value.trim(),
            phone: document.getElementById("p-phone").value.trim(),
            doorstep_note: document.getElementById("p-note").value.trim()
          });
          F.toast("Profile saved.");
          renderHeader();
        } catch (e) { F.toast(e.message); }
        save.disabled = false;
      });
      pc.appendChild(save);
      root.appendChild(pc);

      /* ---- addresses card ---- */
      var ac = el("div", "card");
      ac.style.cssText = "padding:30px 34px 34px;display:flex;flex-direction:column;gap:18px";
      ac.appendChild(el("span", "label", "Delivery address"));
      if (!addresses.length) {
        ac.appendChild(el("p", "small muted", "No address yet — your boxes need a doorstep."));
      }
      addresses.forEach(function (a) {
        var row = el("div");
        row.style.cssText = "display:flex;align-items:flex-start;gap:14px;padding:14px 18px;border-radius:20px;background:var(--paper)";
        var col = el("div");
        col.style.cssText = "display:flex;flex-direction:column;gap:4px;flex:1;min-width:0";
        var top = el("div");
        top.style.cssText = "display:flex;align-items:center;gap:10px";
        top.appendChild(el("span", null, a.label)).style.fontWeight = "600";
        if (a.is_default) top.appendChild(el("span", "pill pill--fresh", "Default")).style.cssText += "height:26px";
        col.appendChild(top);
        col.appendChild(el("span", "small muted", a.line1 + (a.line2 ? ", " + a.line2 : "") + ", " + a.city + " " + a.pincode));
        row.appendChild(col);
        var btns = el("div");
        btns.style.cssText = "display:flex;gap:12px;align-items:center";
        if (!a.is_default) {
          var mk = el("button", "textbtn", "Make default");
          mk.type = "button";
          mk.addEventListener("click", async function () {
            try { await API.makeDefaultAddress(a.id); addresses = await API.addresses(); render(); }
            catch (e) { F.toast(e.message); }
          });
          btns.appendChild(mk);
        }
        var del = el("button", "textbtn textbtn--danger", "Remove");
        del.type = "button";
        del.addEventListener("click", async function () {
          try { await API.deleteAddress(a.id); addresses = await API.addresses(); render(); }
          catch (e) { F.toast(e.message); }
        });
        btns.appendChild(del);
        row.appendChild(btns);
        ac.appendChild(row);
      });

      var form = el("div");
      form.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px";
      form.appendChild(input("a-label", "Label", "", "Home"));
      form.appendChild(input("a-pincode", "Pincode", "", "560038"));
      var l1 = input("a-line1", "Address line", "", "14 Lakeview Road, Indiranagar");
      l1.style.gridColumn = "1 / -1";
      form.appendChild(l1);
      form.appendChild(input("a-city", "City", "Bengaluru"));
      ac.appendChild(form);
      var addBtn = el("button", "btn btn--outline btn--sm", "+ Save address");
      addBtn.type = "button";
      addBtn.style.alignSelf = "flex-start";
      addBtn.addEventListener("click", async function () {
        addBtn.disabled = true;
        try {
          await API.addAddress({
            label: document.getElementById("a-label").value.trim() || "Home",
            line1: document.getElementById("a-line1").value.trim(),
            city: document.getElementById("a-city").value.trim() || "Bengaluru",
            pincode: document.getElementById("a-pincode").value.trim()
          });
          addresses = await API.addresses();
          F.toast("Address saved — new orders deliver here.");
          render();
        } catch (e) {
          F.toast(/pincode/.test(e.message) ? "Enter a valid 6-digit pincode." : e.message);
          addBtn.disabled = false;
        }
      });
      ac.appendChild(addBtn);
      root.appendChild(ac);

      /* ---- never send card ---- */
      var nc = el("div", "card");
      nc.style.cssText = "padding:30px 34px 34px;display:flex;flex-direction:column;gap:18px";
      nc.appendChild(el("span", "label", "Never send"));
      nc.appendChild(el("p", "small muted", "Tap a fruit to keep it out of every curated box — even seasonal specials."));
      var chips = el("div");
      chips.style.cssText = "display:flex;flex-wrap:wrap;gap:10px";
      catalog.forEach(function (f) {
        var on = excluded.indexOf(f.id) >= 0;
        var chip = el("button", "chip chip--sm" + (on ? " chip--never" : ""), on ? f.name + " ✕" : f.name);
        chip.type = "button";
        chip.addEventListener("click", async function () {
          var at = excluded.indexOf(f.id);
          if (at >= 0) excluded.splice(at, 1); else excluded.push(f.id);
          try {
            await API.setExclusions(excluded);
            F.toast(at >= 0 ? f.name + " is back on the menu." : f.name + " will never appear in your box.");
            render();
          } catch (e) { F.toast(e.message); }
        });
        chips.appendChild(chip);
      });
      nc.appendChild(chips);
      root.appendChild(nc);

      /* ---- subscription card ---- */
      var sc = el("div", "card card--dark");
      sc.style.cssText = "padding:30px 34px 34px;display:flex;flex-direction:column;gap:18px";
      var scHead = el("div");
      scHead.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";
      scHead.appendChild(el("span", "label", "Subscription")).style.color = "rgba(255,255,255,0.5)";
      var st = el("span", "pill", sub ? (sub.status === "paused" ? "Paused" : "Active") : "None yet");
      st.style.cssText = "background:rgba(255,194,51,0.18);color:var(--mango);height:26px;font-size:12px";
      scHead.appendChild(st);
      sc.appendChild(scHead);
      if (sub) {
        sc.appendChild(el("span", "h3", sub.box_id ? sub.box_id.charAt(0).toUpperCase() + sub.box_id.slice(1) + " Box" : "Your custom box")).style.fontSize = "26px";
        var line = el("span", null,
          { daily: "Daily", alternate: "Alternate days", weekly: "Weekly", monthly: "Monthly" }[sub.cadence] +
          " · " + API.rupees(sub.price_paise) + " per delivery · pay on delivery");
        line.style.cssText = "color:rgba(255,255,255,0.62);font-size:15px";
        sc.appendChild(line);
      } else {
        var none = el("span", null, "Build a box and pick a rhythm — mornings improve immediately.");
        none.style.cssText = "color:rgba(255,255,255,0.62);font-size:15px";
        sc.appendChild(none);
      }
      var scBtns = el("div");
      scBtns.style.cssText = "display:flex;gap:12px;margin-top:auto;flex-wrap:wrap";
      var manage = el("a", "btn btn--white btn--sm", sub ? "Manage plan" : "Start subscription");
      manage.href = sub ? "plans.html" : "build.html";
      scBtns.appendChild(manage);
      sc.appendChild(scBtns);
      root.appendChild(sc);
    }
  });
})();
