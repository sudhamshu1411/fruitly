/* Build your box — fruit list and display totals come from the live catalogue;
   the final price is computed again by the backend when subscribing/ordering. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    var F = window.Fruitly, API = window.FruitlyAPI;
    if (!F || !API) return;

    var CATALOG = [];
    try {
      CATALOG = await API.fruits();
    } catch (e) {
      F.toast("Can’t reach the Fruitly kitchen right now — try a refresh.");
      return;
    }
    var byId = {};
    CATALOG.forEach(function (f) { byId[f.id] = f; });

    var box = F.readBox();
    Object.keys(box).forEach(function (id) {
      if (!byId[id] || byId[id].sold_out) delete box[id];
    });
    if (!Object.keys(box).length) box = { mango: 2, kiwi: 1, pomegranate: 1 };

    var cutting = "cubed";
    var cadence = "alternate";
    var days = { 0: true, 1: false, 2: true, 3: false, 4: true, 5: false, 6: false };
    var DAY_LABELS = API.DAY_KEYS;

    var chipWrap = document.getElementById("fruit-chips");
    var qtyList = document.getElementById("qty-list");
    var sumList = document.getElementById("sum-list");
    var sumGrams = document.getElementById("sum-grams");
    var sumPrice = document.getElementById("sum-price");
    var sumDays = document.getElementById("sum-days");
    var selCount = document.getElementById("select-count");
    var cadenceNote = document.getElementById("cadence-note");

    /* ----- fruit chips from the catalogue ----- */
    CATALOG.forEach(function (f) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("data-fruit", f.id);
      chip.textContent = f.sold_out ? f.name + " · back at 5am" : f.name;
      chip.disabled = f.sold_out;
      if (f.sold_out) chip.style.opacity = "0.5";
      chip.addEventListener("click", function () {
        if (box[f.id]) delete box[f.id]; else box[f.id] = 1;
        render();
      });
      chipWrap.appendChild(chip);
    });

    /* ----- cutting style ----- */
    document.querySelectorAll("[data-cut]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        cutting = chip.getAttribute("data-cut");
        document.querySelectorAll("[data-cut]").forEach(function (c) {
          var on = c === chip;
          c.classList.toggle("is-on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        render();
      });
    });

    /* ----- cadence ----- */
    document.querySelectorAll("[data-cadence]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        cadence = chip.getAttribute("data-cadence");
        document.querySelectorAll("[data-cadence]").forEach(function (c) {
          var on = c === chip;
          c.classList.toggle("is-on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        if (cadence === "weekly" || cadence === "monthly") {
          var first = activeDays()[0];
          for (var k = 0; k < 7; k++) days[k] = k === (first === undefined ? 5 : first);
        }
        render();
      });
    });

    /* ----- delivery days ----- */
    document.querySelectorAll("[data-day]").forEach(function (btn) {
      var key = parseInt(btn.getAttribute("data-day"), 10);
      btn.addEventListener("click", function () {
        if (cadence === "daily") return;
        if (cadence === "weekly" || cadence === "monthly") {
          for (var k = 0; k < 7; k++) days[k] = k === key;
        } else {
          days[key] = !days[key];
        }
        render();
      });
    });

    function activeDays() {
      return Object.keys(days).map(Number).filter(function (k) { return days[k]; }).sort();
    }

    function items() {
      return Object.keys(box).map(function (id) { return { fruit_id: id, cups: box[id] }; });
    }

    function render() {
      var ids = Object.keys(box);
      selCount.textContent = ids.length + " of " + CATALOG.filter(function (f) { return !f.sold_out; }).length + " selected";

      document.querySelectorAll("[data-fruit]").forEach(function (chip) {
        var on = !!box[chip.getAttribute("data-fruit")];
        chip.classList.toggle("is-on", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });

      /* quantity rows */
      qtyList.innerHTML = "";
      if (!ids.length) {
        qtyList.innerHTML = '<p class="muted small" style="margin:6px 0 0">Pick at least one fruit above.</p>';
      }
      ids.forEach(function (id) {
        var f = byId[id];
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;padding:14px 18px;border-radius:20px;background:var(--paper)";
        row.innerHTML =
          '<span style="width:12px;height:12px;border-radius:999px;background:' + f.color + ';flex:none"></span>' +
          '<span style="font:500 16px/1 var(--sans)"></span>' +
          '<span class="muted small">' + f.grams_per_cup + "g per cup · " + API.rupees(f.price_paise) + "</span>" +
          '<span class="stepper" style="margin-left:auto">' +
          '<button type="button" class="stepper__btn stepper__btn--minus" aria-label="One less cup">−</button>' +
          '<span class="stepper__count">' + box[id] + (box[id] === 1 ? " cup" : " cups") + "</span>" +
          '<button type="button" class="stepper__btn stepper__btn--plus" aria-label="One more cup">+</button>' +
          "</span>";
        row.children[1].textContent = f.name;
        row.querySelector(".stepper__btn--minus").addEventListener("click", function () {
          box[id]--;
          if (box[id] <= 0) delete box[id];
          render();
        });
        row.querySelector(".stepper__btn--plus").addEventListener("click", function () {
          box[id] = Math.min(box[id] + 1, 9);
          render();
        });
        qtyList.appendChild(row);
      });

      /* summary — display math from the live catalogue */
      var grams = 0, paise = 0;
      ids.forEach(function (id) {
        grams += byId[id].grams_per_cup * box[id];
        paise += byId[id].price_paise * box[id];
      });
      sumList.innerHTML = ids.length ? "" : '<p class="muted small" style="margin:0">Your box is empty.</p>';
      ids.forEach(function (id) {
        var f = byId[id];
        var line = document.createElement("div");
        line.style.cssText = "display:flex;justify-content:space-between;gap:12px";
        var l = document.createElement("span");
        l.textContent = f.name + " · " + cutting;
        var r = document.createElement("span");
        r.style.fontWeight = "600";
        r.textContent = box[id] + (box[id] === 1 ? " cup" : " cups") + " · " + f.grams_per_cup * box[id] + "g";
        line.append(l, r);
        sumList.appendChild(line);
      });
      sumGrams.textContent = grams + "g per delivery";
      sumPrice.textContent = API.rupees(paise);

      /* days */
      var act = activeDays();
      document.querySelectorAll("[data-day]").forEach(function (btn) {
        var k = parseInt(btn.getAttribute("data-day"), 10);
        var on = cadence === "daily" ? true : days[k];
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      sumDays.textContent =
        cadence === "daily" ? "Every morning" :
        act.length ? act.map(function (k) { return DAY_LABELS[k]; }).join(" · ") +
          (cadence === "monthly" ? " — first week of the month" : "") :
        "Pick your delivery days";
      cadenceNote.textContent =
        cadence === "daily" ? "A fresh box every morning, before 8am." :
        cadence === "alternate" ? "Delivered on the days you pick." :
        cadence === "weekly" ? "One chosen day, every week." :
        "One delivery in the first week of each month.";

      F.writeBox(box);
    }

    /* ----- checkout, for real ----- */
    async function guarded(btn, fn) {
      var was = btn.textContent;
      btn.disabled = true;
      btn.textContent = "One moment…";
      try {
        var s = await API.session();
        if (!s) { location.href = "auth.html?next=build.html"; return; }
        await fn();
      } catch (e) {
        F.toast(e.message);
        btn.disabled = false;
        btn.textContent = was;
      }
    }

    function showConfirmation(title, lines, cta) {
      var card = document.getElementById("summary-card");
      card.innerHTML =
        '<div style="display:flex;flex-direction:column;gap:18px;align-items:flex-start">' +
        '<span class="pill pill--fresh">Confirmed</span>' +
        '<h2 class="h3" style="font-size:24px"></h2>' +
        '<div class="muted" style="display:flex;flex-direction:column;gap:8px;font-size:15px" id="confirm-lines"></div>' +
        '<a class="btn btn--green" href="' + cta.href + '">' + cta.label + "</a></div>";
      card.querySelector("h2").textContent = title;
      var wrap = card.querySelector("#confirm-lines");
      lines.forEach(function (t) {
        var p = document.createElement("span");
        p.textContent = t;
        wrap.appendChild(p);
      });
      F.clearBox();
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    document.getElementById("subscribe-cta").addEventListener("click", function () {
      var btn = this;
      if (!Object.keys(box).length) { F.toast("Pick at least one fruit first."); return; }
      if (cadence !== "daily" && !activeDays().length) { F.toast("Pick your delivery days."); return; }
      guarded(btn, async function () {
        var r = await API.createSubscription({
          cadence: cadence, days: activeDays(), cutting: cutting, items: items()
        });
        showConfirmation("Your Fruitly is set.", [
          API.rupees(r.price_paise) + " per delivery · " + r.grams + "g",
          "First delivery " + API.dateLabel(r.first_delivery) + ", before 8am.",
          "Skip or swap until midnight, any day."
        ], { href: "plans.html", label: "See your plan" });
      });
    });

    document.getElementById("once-cta").addEventListener("click", function () {
      var btn = this;
      if (!Object.keys(box).length) { F.toast("Pick at least one fruit first."); return; }
      guarded(btn, async function () {
        var r = await API.placeOrder(items(), cutting);
        showConfirmation("Order placed.", [
          API.rupees(r.total_paise) + " · arriving " + API.dateLabel(r.delivery_date) + ", before 8am.",
          "Pay on delivery."
        ], { href: "orders.html", label: "Track it in Orders" });
      });
    });

    render();
  });
})();
