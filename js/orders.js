/* Orders — real orders, a live status timeline, and tap-to-rate. */
(function () {
  "use strict";

  var STEPS = [
    { key: "placed", label: "Order locked" },
    { key: "preparing", label: "In the kitchen" },
    { key: "packed", label: "Sealed & chilled" },
    { key: "out_for_delivery", label: "Out for delivery" },
    { key: "delivered", label: "At your door" }
  ];
  var RANK = { placed: 0, preparing: 1, packed: 2, out_for_delivery: 3, delivered: 4 };

  document.addEventListener("DOMContentLoaded", async function () {
    var F = window.Fruitly, API = window.FruitlyAPI;
    var root = document.getElementById("orders-root");
    if (!F || !API || !root) return;

    var session = await API.requireSession("orders.html");
    if (!session) return;

    var catalog = {}, orders = [];
    try {
      (await API.fruits()).forEach(function (f) { catalog[f.id] = f; });
      orders = await API.myOrders(30);
    } catch (e) {
      root.innerHTML = "";
      root.appendChild(el("p", "lede", "Couldn’t load your orders — " + e.message));
      return;
    }

    render();

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function istTime(iso) {
      try {
        return new Date(iso).toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata"
        });
      } catch (e) { return ""; }
    }

    function itemsLine(o) {
      if (!o.order_items || !o.order_items.length) return "Curated box · " + o.grams + "g";
      return o.order_items.map(function (i) {
        var f = catalog[i.fruit_id];
        return (f ? f.name.toLowerCase() : i.fruit_id) + (i.cups > 1 ? " ×" + i.cups : "");
      }).join(", ");
    }

    function eventTime(o, key) {
      var ev = (o.events || []).filter(function (e) { return e.event === key; }).pop();
      return ev ? istTime(ev.at) : null;
    }

    function render() {
      root.innerHTML = "";

      if (!orders.length) {
        var empty = el("div", "card card--pad");
        empty.style.cssText = "display:flex;flex-direction:column;gap:16px;align-items:flex-start;max-width:560px";
        empty.appendChild(el("h2", "h3", "No orders yet."));
        var p = el("p", "muted", "Subscribe or order once — your first box shows up here the moment it exists.");
        p.style.margin = "0";
        empty.appendChild(p);
        var cta = el("a", "btn btn--primary", "Build your box");
        cta.href = "build.html";
        empty.appendChild(cta);
        root.appendChild(empty);
        return;
      }

      var live = orders.filter(function (o) {
        return ["placed", "preparing", "packed", "out_for_delivery"].indexOf(o.status) >= 0;
      }).sort(function (a, b) { return a.delivery_date < b.delivery_date ? -1 : 1; })[0];

      if (live) root.appendChild(trackingCard(live));

      var past = orders.filter(function (o) { return o !== live; });
      if (past.length) {
        var listCard = el("div", "card");
        listCard.style.cssText = "padding:8px var(--card-pad);margin-top:" + (live ? "24px" : "0");
        var lbl = el("p", "label", live ? "Previous deliveries" : "Your deliveries");
        lbl.style.cssText = "padding:26px 0 6px;margin:0";
        listCard.appendChild(lbl);
        var list = el("div", "rowlist");
        past.forEach(function (o) { list.appendChild(orderRow(o)); });
        listCard.appendChild(list);
        root.appendChild(listCard);
      }
    }

    function trackingCard(o) {
      var card = el("div", "card");
      card.style.cssText = "padding:var(--card-pad);display:flex;gap:40px;flex-wrap:wrap";

      var leftCol = el("div");
      leftCol.style.cssText = "flex:1 1 340px;display:flex;flex-direction:column;gap:24px;min-width:0";

      var meta = el("div");
      meta.style.cssText = "display:flex;align-items:center;gap:14px;flex-wrap:wrap";
      meta.appendChild(el("span", "pill pill--fresh", "Arriving " + API.dateLabel(o.delivery_date)));
      meta.appendChild(el("span", "small muted", API.rupees(o.total_paise) + " · " + itemsLine(o)));
      leftCol.appendChild(meta);

      var h = el("h2", "h2", STEPS[RANK[o.status]].label + (o.status === "placed" ? " · cut from 5am" : ""));
      h.style.cssText = "font-variation-settings:'wdth' 114;font-size:calc(clamp(24px,2.4vw,32px) * var(--ui))";
      leftCol.appendChild(h);

      var tl = el("div", "timeline");
      STEPS.forEach(function (step, i) {
        var item = el("div", "timeline__item " +
          (i < RANK[o.status] ? "is-done" : i === RANK[o.status] ? "is-now" : "is-todo"));
        item.appendChild(el("span", "timeline__dot"));
        item.appendChild(el("span", "timeline__label", step.label));
        var t = eventTime(o, step.key);
        item.appendChild(el("span", "timeline__time", t || (i > RANK[o.status] ? "—" : "")));
        tl.appendChild(item);
      });
      leftCol.appendChild(tl);

      var note = el("p", "small muted", "Pay on delivery · skip or swap until midnight from your plan.");
      note.style.margin = "0";
      leftCol.appendChild(note);
      card.appendChild(leftCol);

      var map = el("div");
      map.style.cssText = "flex:1.4 1 420px;position:relative;min-height:320px;border-radius:24px;overflow:hidden;background:var(--sand)";
      map.innerHTML =
        '<svg viewBox="0 0 620 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%">' +
        '<path d="M0 90 H620 M0 200 H620 M0 300 H620" stroke="rgba(19,42,29,0.06)" stroke-width="14"/>' +
        '<path d="M140 0 V360 M330 0 V360 M500 0 V360" stroke="rgba(19,42,29,0.06)" stroke-width="14"/>' +
        '<path d="M60 320 C 150 280, 180 210, 265 200 S 400 150, 440 120 S 520 80, 545 92" fill="none" stroke="#157A3E" stroke-width="3.5" stroke-dasharray="1 10" stroke-linecap="round"/>' +
        '<circle cx="60" cy="320" r="7" fill="#FFFFFF" stroke="#157A3E" stroke-width="3"/></svg>' +
        '<span style="position:absolute;right:44px;top:44px;width:56px;height:56px;border-radius:999px;background:var(--green);display:inline-flex;align-items:center;justify-content:center;box-shadow:var(--shadow-lift)">' +
        '<svg width="32" height="32" viewBox="0 0 100 100" aria-hidden="true"><path d="M58 7C75 12 87 31 87 51C87 73 68 92 45 92C25 92 10 78 10 59C10 46 18 37 29 28C39 20 44 3 58 7Z" fill="#FFC233"/></svg></span>' +
        '<span class="pill" style="position:absolute;left:20px;top:20px;background:rgba(19,42,29,0.5);color:rgba(255,255,255,0.9)">Route map — live tracking coming soon</span>';
      card.appendChild(map);
      return card;
    }

    function orderRow(o) {
      var row = el("div", "row");
      var dc = el("span", "datechip");
      var dt = new Date(o.delivery_date + "T00:00:00");
      dc.append(dt.toLocaleDateString("en-IN", { weekday: "short" }));
      dc.appendChild(el("b", null, String(dt.getDate())));
      row.appendChild(dc);

      var main = el("div", "row__main");
      main.appendChild(el("span", null,
        (o.subscription_id ? "Subscription box" : "One-time box") + " · " + API.rupees(o.total_paise)
      )).style.fontWeight = "600";
      var sub = o.status === "delivered"
        ? "Delivered " + (eventTime(o, "delivered") || "") + " · " + itemsLine(o)
        : itemsLine(o);
      main.appendChild(el("span", "small muted", sub));
      row.appendChild(main);

      var pillCls = {
        delivered: "pill--fresh", skipped: "pill--warn", failed: "pill--warn",
        cancelled: "pill--neutral", placed: "pill--fresh", preparing: "pill--fresh",
        packed: "pill--fresh", out_for_delivery: "pill--fresh"
      }[o.status] || "pill--neutral";
      row.appendChild(el("span", "pill " + pillCls, o.status.replace(/_/g, " ")));

      if (o.status === "delivered") row.appendChild(stars(o));
      return row;
    }

    function stars(o) {
      var wrap = el("span", "stars");
      var current = o.ratings && o.ratings.length ? o.ratings[0].stars : 0;
      wrap.setAttribute("aria-label", current ? "Rated " + current + " of 5" : "Rate this delivery");
      for (var i = 1; i <= 5; i++) {
        (function (k) {
          var b = el("button", "star");
          b.type = "button";
          b.setAttribute("aria-label", k + (k === 1 ? " star" : " stars"));
          b.innerHTML = k <= current
            ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="#FFC233" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z"/></svg>'
            : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(19,42,29,0.3)" stroke-width="1.6" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z"/></svg>';
          b.addEventListener("click", async function () {
            try {
              await API.rateOrder(o.id, k);
              o.ratings = [{ stars: k }];
              var fresh = stars(o);
              wrap.replaceWith(fresh);
              F.toast("Thanks — " + k + (k === 1 ? " star" : " stars") + " noted for tomorrow’s forecast.");
            } catch (e) { F.toast(e.message); }
          });
          wrap.appendChild(b);
        })(i);
      }
      return wrap;
    }
  });
})();
