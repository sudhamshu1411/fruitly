/* Ops dashboard — staff only. KPIs, pipeline and the order queue are live;
   Advance moves an order through the kitchen exactly like the floor would. */
(function () {
  "use strict";

  var STAGE_COLORS = { placed: "#C4E5C9", preparing: "#8FC9A0", packed: "#79BF8F", out_for_delivery: "#379159", delivered: "#0D5229" };
  var STAGE_LABELS = {
    placed: "Placed", preparing: "Preparing", packed: "Packed",
    out_for_delivery: "Out for delivery", delivered: "Delivered",
    skipped: "Skipped", cancelled: "Cancelled", failed: "Failed"
  };

  document.addEventListener("DOMContentLoaded", async function () {
    var F = window.Fruitly, API = window.FruitlyAPI;
    var root = document.getElementById("admin-root");
    if (!API || !root) return;

    var session = await API.requireSession("admin.html");
    if (!session) return;

    var profile;
    try { profile = await API.profile(); } catch (e) { profile = null; }
    if (!profile || !profile.is_staff) {
      root.innerHTML = "";
      var gate = el("div", "card card--pad");
      gate.style.cssText = "display:flex;flex-direction:column;gap:14px;align-items:flex-start;max-width:520px";
      gate.appendChild(el("h2", "h3", "Staff only."));
      var p = el("p", "muted", "This dashboard is for the Fruitly ops team. If that’s you, ask an admin to add you as staff.");
      p.style.margin = "0";
      gate.appendChild(p);
      var back = el("a", "btn btn--outline btn--sm", "Back to Fruitly");
      back.href = "index.html";
      gate.appendChild(back);
      root.appendChild(gate);
      return;
    }

    document.getElementById("admin-user").textContent = profile.full_name || "Ops";
    await refresh();

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    async function refresh() {
      var data, orders;
      try {
        data = await API.adminToday();
        orders = await API.adminOrders();
      } catch (e) {
        root.innerHTML = "";
        root.appendChild(el("p", "lede", "Couldn’t load operations — " + e.message));
        return;
      }
      render(data, orders);
    }

    function render(d, orders) {
      root.innerHTML = "";

      var dateLine = document.getElementById("admin-date");
      dateLine.textContent = new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "short"
      }) + " · orders lock 00:00 IST · tickets 00:05";

      /* KPI tiles */
      var tiles = el("div", "grid grid-4");
      tiles.style.gap = "18px";
      tiles.appendChild(tile("Orders today", String(d.orders_total),
        d.active_subscriptions + " active subscription" + (d.active_subscriptions === 1 ? "" : "s")));
      tiles.appendChild(tile("Boxes to prepare", String(d.boxes_to_prepare), "placed + preparing"));
      tiles.appendChild(tile("Revenue today", API.rupees(d.revenue_paise), "excludes skips and fails"));
      tiles.appendChild(tile("Average rating", d.avg_rating != null ? d.avg_rating + " ★" : "—", "across all deliveries"));
      root.appendChild(tiles);

      /* pipeline */
      var pipe = el("div", "card");
      pipe.style.cssText = "padding:var(--card-pad);display:flex;flex-direction:column;gap:18px";
      var ph = el("div");
      ph.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap";
      ph.appendChild(el("span", "label", "Preparation → delivery · today"));
      var failedN = (d.by_status && d.by_status.failed) || 0;
      if (failedN) ph.appendChild(el("span", "pill pill--warn", failedN + " failed · reattempt 17:00"));
      pipe.appendChild(ph);

      var stages = ["placed", "preparing", "packed", "out_for_delivery", "delivered"];
      var counts = stages.map(function (s) { return (d.by_status && d.by_status[s]) || 0; });
      var totalLive = counts.reduce(function (a, b) { return a + b; }, 0);
      if (totalLive > 0) {
        var bar = el("div", "stagebar");
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", "Pipeline: " + stages.map(function (s, i) {
          return counts[i] + " " + STAGE_LABELS[s].toLowerCase();
        }).join(", "));
        stages.forEach(function (s, i) {
          if (!counts[i]) return;
          var seg = el("span");
          seg.style.cssText = "flex:" + counts[i] + " 1 0;background:" + STAGE_COLORS[s];
          bar.appendChild(seg);
        });
        pipe.appendChild(bar);
      } else {
        pipe.appendChild(el("p", "small muted", "No boxes on today’s board yet — tickets appear at 00:05 IST."));
      }
      var legend = el("div", "legend");
      stages.forEach(function (s, i) {
        var item = el("span");
        var sw = el("i");
        sw.style.background = STAGE_COLORS[s];
        item.appendChild(sw);
        item.append(STAGE_LABELS[s] + " · ");
        item.appendChild(el("b", null, String(counts[i])));
        legend.appendChild(item);
      });
      pipe.appendChild(legend);
      root.appendChild(pipe);

      /* two-column: fruits required + order queue */
      var row = el("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap";

      var fr = el("div", "card");
      fr.style.cssText = "flex:1 1 380px;padding:var(--card-pad) var(--card-pad) 14px;min-width:0";
      var frh = el("div");
      frh.style.cssText = "padding-bottom:14px";
      frh.appendChild(el("span", "label", "Fruits required today"));
      fr.appendChild(frh);
      if (!d.fruits_required.length) {
        fr.appendChild(el("p", "small muted", "Nothing on the cut list yet.")).style.paddingBottom = "16px";
      } else {
        var tblWrap = el("div");
        tblWrap.style.overflowX = "auto";
        var tbl = el("table", "table");
        tbl.innerHTML = "<thead><tr><th>Fruit</th><th class='num'>Cups</th><th class='num'>Kg</th></tr></thead>";
        var tb = el("tbody");
        d.fruits_required.forEach(function (f) {
          var tr = el("tr");
          var td1 = el("td");
          var dot = el("i", "fruitdot");
          dot.style.background = f.color;
          td1.appendChild(dot);
          td1.append(f.name);
          tr.appendChild(td1);
          tr.appendChild(el("td", "num", String(f.cups))).style.fontWeight = "500";
          tr.appendChild(el("td", "num muted", String(f.kg)));
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        tblWrap.appendChild(tbl);
        fr.appendChild(tblWrap);
      }
      row.appendChild(fr);

      /* order queue */
      var q = el("div", "card");
      q.style.cssText = "flex:1.6 1 460px;padding:var(--card-pad) var(--card-pad) 14px;min-width:0";
      var qh = el("div");
      qh.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px";
      qh.appendChild(el("span", "label", "Order queue"));
      var re = el("button", "textbtn", "Refresh");
      re.type = "button";
      re.addEventListener("click", refresh);
      qh.appendChild(re);
      q.appendChild(qh);

      var open = orders.filter(function (o) {
        return ["skipped", "cancelled"].indexOf(o.status) < 0;
      }).slice(0, 14);
      if (!open.length) q.appendChild(el("p", "small muted", "Queue is clear.")).style.paddingBottom = "16px";
      var list = el("div", "rowlist");
      open.forEach(function (o) {
        var r = el("div", "row");
        r.style.padding = "12px 0";
        var main = el("div", "row__main");
        main.appendChild(el("span", null,
          (o.profiles && o.profiles.full_name ? o.profiles.full_name : "Customer") +
          " · " + API.rupees(o.total_paise))).style.cssText = "font-weight:600;font-size:14.5px";
        main.appendChild(el("span", "small muted",
          API.dateLabel(o.delivery_date) + " · " + o.grams + "g · " + o.cutting +
          (o.payment_status === "paid" ? " · paid" : " · pay on delivery")));
        r.appendChild(main);
        var pillCls = o.status === "delivered" ? "pill--fresh" : o.status === "failed" ? "pill--warn" : "pill--neutral";
        r.appendChild(el("span", "pill " + pillCls, STAGE_LABELS[o.status] || o.status));
        if (["placed", "preparing", "packed", "out_for_delivery"].indexOf(o.status) >= 0) {
          var adv = el("button", "btn btn--green btn--sm", "Advance");
          adv.type = "button";
          adv.style.cssText += ";padding:0 16px;font-size:calc(13px * var(--ui))";
          adv.addEventListener("click", async function () {
            adv.disabled = true;
            try { await API.advanceOrder(o.id); await refresh(); }
            catch (e) { if (F) F.toast(e.message); adv.disabled = false; }
          });
          r.appendChild(adv);
          var fail = el("button", "textbtn textbtn--danger", "Fail");
          fail.type = "button";
          fail.addEventListener("click", async function () {
            try { await API.failOrder(o.id); await refresh(); }
            catch (e) { if (F) F.toast(e.message); }
          });
          r.appendChild(fail);
        }
        list.appendChild(r);
      });
      q.appendChild(list);
      row.appendChild(q);
      root.appendChild(row);
    }

    function tile(label, num, note) {
      var t = el("div", "card stat");
      t.appendChild(el("span", "label", label));
      t.appendChild(el("span", "stat__num", num));
      t.appendChild(el("span", "small muted", note));
      return t;
    }
  });
})();
