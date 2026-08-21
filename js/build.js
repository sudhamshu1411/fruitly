/* Build your box — the whole builder is client-side; state persists in localStorage. */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var F = window.Fruitly;
    if (!F) return;
    var FRUITS = F.FRUITS;

    var box = F.readBox();
    if (!Object.keys(box).length) box = { mango: 2, kiwi: 1, pomegranate: 1 }; // starter selection

    var excluded = { papaya: true };
    var cutting = "Cubed";
    var days = { M: true, T: false, W: true, T2: false, F: true, S: false, S2: false };
    var DAY_LABELS = { M: "Mon", T: "Tue", W: "Wed", T2: "Thu", F: "Fri", S: "Sat", S2: "Sun" };

    var qtyList = document.getElementById("qty-list");
    var sumList = document.getElementById("sum-list");
    var sumGrams = document.getElementById("sum-grams");
    var sumPrice = document.getElementById("sum-price");
    var sumDays = document.getElementById("sum-days");
    var selCount = document.getElementById("select-count");

    /* ----- fruit select chips ----- */
    document.querySelectorAll("[data-fruit]").forEach(function (chip) {
      var id = chip.getAttribute("data-fruit");
      chip.setAttribute("aria-pressed", box[id] ? "true" : "false");
      chip.classList.toggle("is-on", !!box[id]);
      chip.addEventListener("click", function () {
        if (box[id]) delete box[id];
        else box[id] = 1;
        chip.classList.toggle("is-on", !!box[id]);
        chip.setAttribute("aria-pressed", box[id] ? "true" : "false");
        render();
      });
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

    /* ----- delivery days ----- */
    document.querySelectorAll("[data-day]").forEach(function (btn) {
      var key = btn.getAttribute("data-day");
      btn.addEventListener("click", function () {
        days[key] = !days[key];
        btn.classList.toggle("is-on", days[key]);
        btn.setAttribute("aria-pressed", days[key] ? "true" : "false");
        render();
      });
    });

    /* ----- exclusions ----- */
    document.querySelectorAll("[data-exclude]").forEach(function (chip) {
      var id = chip.getAttribute("data-exclude");
      chip.addEventListener("click", function () {
        excluded[id] = !excluded[id];
        chip.classList.toggle("chip--never", excluded[id]);
        chip.setAttribute("aria-pressed", excluded[id] ? "true" : "false");
        chip.textContent = FRUITS[id].name.split(" ")[0] === "Black" ? "Black grapes" : chip.textContent;
        chip.innerHTML = excluded[id] ? chip.getAttribute("data-label") + " ✕" : chip.getAttribute("data-label");
        render();
      });
    });

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function render() {
      var ids = Object.keys(box);
      if (selCount) selCount.textContent = ids.length + " of " + document.querySelectorAll("[data-fruit]").length + " selected";

      /* quantity rows */
      if (qtyList) {
        qtyList.innerHTML = "";
        if (!ids.length) {
          qtyList.innerHTML = '<p class="muted small" style="margin:6px 0 0">Pick at least one fruit above.</p>';
        }
        ids.forEach(function (id) {
          var f = FRUITS[id];
          var row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;padding:14px 18px;border-radius:20px;background:var(--paper)";
          row.innerHTML =
            '<span style="width:12px;height:12px;border-radius:999px;background:' + f.color + ';flex:none"></span>' +
            '<span style="font:500 16px/1 var(--sans)">' + esc(f.name) + "</span>" +
            '<span class="muted small">' + f.grams + "g per cup</span>" +
            '<span class="stepper" style="margin-left:auto">' +
            '<button type="button" class="stepper__btn stepper__btn--minus" aria-label="One less cup of ' + esc(f.name) + '">−</button>' +
            '<span class="stepper__count">' + box[id] + (box[id] === 1 ? " cup" : " cups") + "</span>" +
            '<button type="button" class="stepper__btn stepper__btn--plus" aria-label="One more cup of ' + esc(f.name) + '">+</button>' +
            "</span>";
          row.querySelector(".stepper__btn--minus").addEventListener("click", function () {
            box[id]--;
            if (box[id] <= 0) {
              delete box[id];
              var chip = document.querySelector('[data-fruit="' + id + '"]');
              if (chip) { chip.classList.remove("is-on"); chip.setAttribute("aria-pressed", "false"); }
            }
            render();
          });
          row.querySelector(".stepper__btn--plus").addEventListener("click", function () {
            box[id] = Math.min(box[id] + 1, 9);
            render();
          });
          qtyList.appendChild(row);
        });
      }

      /* summary */
      var t = F.boxTotals(box);
      if (sumList) {
        sumList.innerHTML = ids.length
          ? ids.map(function (id) {
              var f = FRUITS[id];
              return '<div style="display:flex;justify-content:space-between;gap:12px">' +
                '<span>' + esc(f.name) + " · " + esc(cutting.toLowerCase()) + "</span>" +
                '<span style="font-weight:600">' + box[id] + (box[id] === 1 ? " cup" : " cups") + " · " + f.grams * box[id] + "g</span></div>";
            }).join("")
          : '<p class="muted small" style="margin:0">Your box is empty.</p>';
      }
      if (sumGrams) sumGrams.textContent = t.grams + "g per delivery";
      if (sumPrice) sumPrice.textContent = "₹" + t.price;

      var activeDays = Object.keys(days).filter(function (k) { return days[k]; });
      if (sumDays) {
        sumDays.textContent = activeDays.length
          ? activeDays.map(function (k) { return DAY_LABELS[k]; }).join(" · ")
          : "Pick your delivery days";
      }

      var cta = document.getElementById("subscribe-cta");
      if (cta) {
        var ok = ids.length > 0 && activeDays.length > 0;
        cta.setAttribute("aria-disabled", ok ? "false" : "true");
      }

      F.writeBox(box);
    }

    render();
  });
})();
