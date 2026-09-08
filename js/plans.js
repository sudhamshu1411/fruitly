/* Your plan — everything on this page is the signed-in user's real data. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    var F = window.Fruitly, API = window.FruitlyAPI;
    var root = document.getElementById("plan-root");
    if (!F || !API || !root) return;

    var session = await API.requireSession("plans.html");
    if (!session) return;

    var catalog = {}, sub = null, skips = [];
    try {
      (await API.fruits()).forEach(function (f) { catalog[f.id] = f; });
      sub = await API.mySubscription();
      if (sub) skips = (await API.mySkips(sub.id)).map(function (s) { return s.skip_date; });
    } catch (e) {
      root.innerHTML = "";
      var err = el("p", "lede");
      err.textContent = "Couldn’t load your plan — " + e.message;
      root.appendChild(err);
      return;
    }

    render();

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function cadenceLabel(c) {
      return { daily: "Daily", alternate: "Alternate days", weekly: "Weekly", monthly: "Monthly" }[c] || c;
    }

    function itemsLine() {
      if (!sub.subscription_items || !sub.subscription_items.length) return "Curated box";
      return sub.subscription_items.map(function (i) {
        var f = catalog[i.fruit_id];
        return (f ? f.name : i.fruit_id) + (i.cups > 1 ? " ×" + i.cups : "");
      }).join(" · ");
    }

    async function act(btn, fn, doneMsg) {
      var was = btn.textContent;
      btn.disabled = true;
      try {
        await fn();
        sub = await API.mySubscription();
        skips = sub ? (await API.mySkips(sub.id)).map(function (s) { return s.skip_date; }) : [];
        if (doneMsg) F.toast(doneMsg);
        render();
      } catch (e) {
        F.toast(e.message);
        btn.disabled = false;
        btn.textContent = was;
      }
    }

    function render() {
      root.innerHTML = "";
      document.getElementById("plan-status").textContent = sub
        ? (sub.status === "paused" ? "Paused" : "Active") : "No plan yet";
      document.getElementById("plan-status").className =
        "pill " + (sub && sub.status === "active" ? "pill--fresh" : "pill--neutral");

      if (!sub) {
        var empty = el("div", "card card--pad");
        empty.style.cssText = "display:flex;flex-direction:column;gap:16px;align-items:flex-start;max-width:560px";
        empty.appendChild(el("h2", "h3", "No Fruitly yet."));
        var p = el("p", "muted", "Build a box, pick a rhythm, and your mornings sort themselves out.");
        p.style.margin = "0";
        empty.appendChild(p);
        var cta = el("a", "btn btn--primary", "Build your box");
        cta.href = "build.html";
        empty.appendChild(cta);
        root.appendChild(empty);
        return;
      }

      var wrap = el("div");
      wrap.style.cssText = "display:flex;align-items:flex-start;gap:32px;flex-wrap:wrap";

      /* ------- left column ------- */
      var left = el("div");
      left.style.cssText = "flex:1.8 1 560px;display:flex;flex-direction:column;gap:24px;min-width:0";

      var card = el("div", "card card--dark");
      card.style.cssText = "padding:36px 40px 40px;display:flex;flex-direction:column;gap:26px";
      var head = el("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";
      head.appendChild(el("span", "label", "Your Fruitly")).style.color = "rgba(255,255,255,0.5)";
      head.insertAdjacentHTML("beforeend",
        '<svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true"><path d="M58 7C75 12 87 31 87 51C87 73 68 92 45 92C25 92 10 78 10 59C10 46 18 37 29 28C39 20 44 3 58 7Z" fill="#FFC233"/></svg>');
      card.appendChild(head);

      var titleRow = el("div");
      titleRow.style.cssText = "display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap";
      var tl = el("div");
      tl.style.cssText = "display:flex;flex-direction:column;gap:8px";
      var name = el("span", "h2", sub.box_id ? (sub.box_id.charAt(0).toUpperCase() + sub.box_id.slice(1) + " Box") : "Your custom box");
      name.style.cssText = "color:#fff;font-variation-settings:'wdth' 114";
      tl.appendChild(name);
      var subline = el("span", null, cadenceLabel(sub.cadence) + " · " + sub.cutting + " · " + API.rupees(sub.price_paise) + " per delivery · " + sub.grams + "g");
      subline.style.color = "rgba(255,255,255,0.62)";
      tl.appendChild(subline);
      var itms = el("span", "small", itemsLine());
      itms.style.color = "rgba(255,255,255,0.45)";
      tl.appendChild(itms);
      titleRow.appendChild(tl);

      var strip = el("div", "days days--dark");
      strip.setAttribute("aria-label", "Delivery days");
      for (var k = 0; k < 7; k++) {
        var d = el("span", "day" + (sub.cadence === "daily" || sub.delivery_days.indexOf(k) >= 0 ? " is-on" : ""), "MTWTFSS"[k]);
        strip.appendChild(d);
      }
      titleRow.appendChild(strip);
      card.appendChild(titleRow);

      var upcoming = API.upcomingDates(sub.cadence, sub.delivery_days, 4);
      var nextLive = upcoming.filter(function (d) { return skips.indexOf(d) < 0; })[0];

      var band = el("div");
      band.style.cssText = "background:rgba(255,255,255,0.08);border-radius:20px;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap";
      var bl = el("div");
      bl.style.cssText = "display:flex;flex-direction:column;gap:4px";
      var lbl = el("span", null, sub.status === "paused" ? "Paused until" : "Next delivery");
      lbl.style.cssText = "font:600 12px/1 var(--sans);letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5)";
      bl.appendChild(lbl);
      bl.appendChild(el("span", null,
        sub.status === "paused"
          ? API.dateLabel(sub.paused_until) + " — deliveries resume after"
          : nextLive ? API.dateLabel(nextLive) + " · before 8am" : "—"
      )).style.cssText += "font:600 18px/1.2 var(--sans)";
      band.appendChild(bl);

      var bBtns = el("div");
      bBtns.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";
      if (sub.status === "paused") {
        var resume = el("button", "btn btn--white btn--sm", "Resume now");
        resume.type = "button";
        resume.addEventListener("click", function () {
          act(resume, function () { return API.resume(sub.id); }, "Welcome back — next box is on the calendar.");
        });
        bBtns.appendChild(resume);
      } else if (nextLive) {
        var skipBtn = el("button", "btn btn--ghost-dark btn--sm", "Skip it");
        skipBtn.type = "button";
        skipBtn.addEventListener("click", function () {
          act(skipBtn, function () { return API.skip(sub.id, nextLive); }, "Skipped — nothing is cut for you that morning.");
        });
        bBtns.appendChild(skipBtn);
      }
      var change = el("a", "btn btn--white btn--sm", "Change box");
      change.href = "build.html";
      bBtns.appendChild(change);
      band.appendChild(bBtns);
      card.appendChild(band);
      left.appendChild(card);

      /* upcoming list */
      var up = el("div", "card");
      up.style.cssText = "padding:8px 34px";
      var upLbl = el("p", "label", "Upcoming deliveries");
      upLbl.style.cssText = "padding:24px 0 4px;margin:0";
      up.appendChild(upLbl);
      var list = el("div", "rowlist");
      upcoming.forEach(function (dISO) {
        var skipped = skips.indexOf(dISO) >= 0;
        var row = el("div", "row");
        var dc = el("span", "datechip");
        var dt = new Date(dISO + "T00:00:00");
        dc.append(dt.toLocaleDateString("en-IN", { weekday: "short" }));
        dc.appendChild(el("b", null, String(dt.getDate())));
        row.appendChild(dc);
        var main = el("div", "row__main");
        main.appendChild(el("span", null, sub.box_id ? (sub.box_id.charAt(0).toUpperCase() + sub.box_id.slice(1) + " Box") : "Your custom box")).style.fontWeight = "600";
        main.appendChild(el("span", "small muted", skipped ? "Skipped — tap undo to restore" : "Cut list locks the night before"));
        row.appendChild(main);
        row.appendChild(el("span", "pill " + (skipped ? "pill--warn" : sub.status === "paused" ? "pill--neutral" : "pill--fresh"),
          skipped ? "Skipped" : sub.status === "paused" ? "Paused" : "Scheduled"));
        if (sub.status !== "paused") {
          var b = el("button", "textbtn", skipped ? "Undo" : "Skip");
          b.type = "button";
          b.addEventListener("click", function () {
            act(b, function () {
              return skipped ? API.unskip(sub.id, dISO) : API.skip(sub.id, dISO);
            }, skipped ? "Delivery restored." : "Skipped.");
          });
          row.appendChild(b);
        }
        list.appendChild(row);
      });
      up.appendChild(list);
      left.appendChild(up);
      wrap.appendChild(left);

      /* ------- right column ------- */
      var right = el("div");
      right.style.cssText = "flex:1 1 380px;max-width:440px;display:flex;flex-direction:column;gap:24px";

      /* days + cutting editor */
      var prefs = el("div", "card");
      prefs.style.cssText = "padding:28px 32px 32px;display:flex;flex-direction:column;gap:18px";
      prefs.appendChild(el("span", "label", "Delivery days"));
      var editDays = sub.delivery_days.slice();
      var editCut = sub.cutting;
      var dayWrap = el("div", "days");
      for (var j = 0; j < 7; j++) {
        (function (k) {
          var b = el("button", "day" + (editDays.indexOf(k) >= 0 ? " is-on" : ""), "MTWTFSS"[k]);
          b.type = "button";
          b.addEventListener("click", function () {
            if (sub.cadence === "daily") return;
            if (sub.cadence === "weekly" || sub.cadence === "monthly") {
              editDays = [k];
              dayWrap.querySelectorAll(".day").forEach(function (x, i2) { x.classList.toggle("is-on", i2 === k); });
            } else {
              var at = editDays.indexOf(k);
              if (at >= 0) editDays.splice(at, 1); else editDays.push(k);
              b.classList.toggle("is-on", at < 0);
            }
          });
          dayWrap.appendChild(b);
        })(j);
      }
      prefs.appendChild(dayWrap);
      prefs.appendChild(el("span", "label", "Cutting style"));
      var cutWrap = el("div");
      cutWrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
      ["cubed", "sliced", "whole"].forEach(function (c) {
        var b = el("button", "chip chip--sm" + (c === editCut ? " is-on" : ""), c.charAt(0).toUpperCase() + c.slice(1));
        b.type = "button";
        b.addEventListener("click", function () {
          editCut = c;
          cutWrap.querySelectorAll(".chip").forEach(function (x) { x.classList.toggle("is-on", x === b); });
        });
        cutWrap.appendChild(b);
      });
      prefs.appendChild(cutWrap);
      var save = el("button", "btn btn--outline btn--sm", "Save changes");
      save.type = "button";
      save.addEventListener("click", function () {
        act(save, function () { return API.updatePrefs(sub.id, editDays, editCut); }, "Plan updated.");
      });
      prefs.appendChild(save);
      right.appendChild(prefs);

      /* pause / cancel */
      var away = el("div", "card card--sand");
      away.style.cssText = "padding:28px 32px 32px;display:flex;flex-direction:column;gap:14px";
      away.appendChild(el("span", "label", "Going away?"));
      var note = el("p", null, "Pause for up to 30 days. Your plan, days and prices wait for you.");
      note.style.cssText = "margin:0;font-size:15px;color:var(--ink-75)";
      away.appendChild(note);
      if (sub.status === "active") {
        var pauseRow = el("div");
        pauseRow.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
        [7, 14, 30].forEach(function (nDays) {
          var b = el("button", "btn btn--outline btn--sm", nDays + " days");
          b.type = "button";
          b.addEventListener("click", function () {
            var until = new Date();
            until.setDate(until.getDate() + nDays);
            var iso = until.getFullYear() + "-" + String(until.getMonth() + 1).padStart(2, "0") + "-" + String(until.getDate()).padStart(2, "0");
            act(b, function () { return API.pause(sub.id, iso); }, "Paused — see you soon.");
          });
          pauseRow.appendChild(b);
        });
        away.appendChild(pauseRow);
      }
      var cancel = el("button", "textbtn textbtn--danger", "Cancel plan");
      cancel.type = "button";
      cancel.style.alignSelf = "flex-start";
      cancel.addEventListener("click", function () {
        if (!confirm("Cancel your Fruitly plan? Tomorrow's box (if locked) still arrives; nothing else will.")) return;
        act(cancel, function () { return API.cancelSubscription(sub.id); }, "Plan cancelled.");
      });
      away.appendChild(cancel);
      right.appendChild(away);

      wrap.appendChild(right);
      root.appendChild(wrap);
    }
  });
})();
