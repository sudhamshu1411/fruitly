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

    var catalogRoot = document.getElementById("catalog-root");
    var financeRoot = document.getElementById("finance-root");
    var alerts = document.getElementById("admin-alerts");
    var title = document.getElementById("admin-title");
    var panels = { today: root, catalog: catalogRoot, finance: financeRoot };
    var titles = { today: "Today\u2019s operations", catalog: "Catalogue & stock", finance: "Finance" };
    var loaded = { today: false, catalog: false, finance: false };

    function currentTab() {
      var h = (location.hash || "#today").replace("#", "");
      return panels[h] ? h : "today";
    }

    async function showTab(name) {
      Object.keys(panels).forEach(function (k) {
        panels[k].hidden = k !== name;
      });
      document.querySelectorAll("[data-tab]").forEach(function (a) {
        var on = a.getAttribute("data-tab") === name;
        if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
      title.textContent = titles[name];
      if (name === "catalog" && !loaded.catalog) { loaded.catalog = true; await renderCatalog(); }
      if (name === "finance" && !loaded.finance) { loaded.finance = true; await renderFinance(); }
    }

    window.addEventListener("hashchange", function () { showTab(currentTab()); });

    await refresh();
    await renderAlerts();
    await showTab(currentTab());

    /* ---------- alerts: low stock and unfulfilled boxes, always visible ---------- */
    async function renderAlerts() {
      alerts.innerHTML = "";
      var cat;
      try { cat = await API.adminCatalog(); } catch (e) { return; }
      if (!cat) return;   // an RPC can answer null; never let that break the header
      if (cat.low_stock_count > 0) {
        var a = el("a", "pill pill--warn", cat.low_stock_count + " low on stock");
        a.href = "admin.html#catalog";
        alerts.appendChild(a);
      }
      if (cat.open_fulfillment_issues > 0) {
        var b = el("a", "pill pill--warn", cat.open_fulfillment_issues + " unfulfilled");
        b.href = "admin.html#finance";
        alerts.appendChild(b);
      }
    }

    /* ---------- catalogue & stock ---------- */
    async function renderCatalog() {
      catalogRoot.innerHTML = "";
      var data;
      try {
        data = await API.adminCatalog();
      } catch (e) {
        catalogRoot.appendChild(el("p", "lede", "Couldn\u2019t load the catalogue \u2014 " + e.message));
        return;
      }
      if (!data || !data.fruits) {
        catalogRoot.appendChild(el("p", "lede", "The catalogue came back empty."));
        return;
      }

      var catNames = {};
      data.categories.forEach(function (c) { catNames[c.id] = c.name; });

      /* stock table */
      var card = el("div", "card");
      card.style.cssText = "padding:var(--card-pad);min-width:0";
      var head = el("div");
      head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;flex-wrap:wrap";
      head.appendChild(el("span", "label", "Stock, cost and margin"));
      head.appendChild(el("span", "small muted", "Cost and margin are staff-only \u2014 they never reach the storefront."));
      card.appendChild(head);

      var wrap = el("div");
      wrap.style.overflowX = "auto";
      var tbl = el("table", "table");
      tbl.innerHTML = "<thead><tr><th>Fruit</th><th>Category</th><th class='num'>Sells for</th>" +
        "<th class='num'>Costs</th><th class='num'>Margin</th><th class='num'>In stock</th><th class='num'>Reorder at</th><th>Adjust</th></tr></thead>";
      var tb = el("tbody");

      data.fruits.forEach(function (f) {
        var tr = el("tr");
        if (f.low_stock) tr.style.background = "rgba(242,107,29,0.07)";

        tr.appendChild(el("td", null, f.name)).style.fontWeight = "500";

        var tdCat = el("td");
        var sel = el("select");
        sel.style.cssText = "height:34px;border-radius:10px;border:1px solid var(--hairline);background:#fff;padding:0 8px;font:400 13px/1 var(--sans)";
        var none = el("option", null, "\u2014"); none.value = "";
        sel.appendChild(none);
        data.categories.forEach(function (c) {
          var o = el("option", null, c.name);
          o.value = c.id;
          if (c.id === f.category_id) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", async function () {
          try { await API.setFruitCategory(f.id, sel.value); if (F) F.toast(f.name + " \u2192 " + (catNames[sel.value] || "no category")); }
          catch (e) { if (F) F.toast(e.message); }
        });
        tdCat.appendChild(sel);
        tr.appendChild(tdCat);

        tr.appendChild(el("td", "num", API.rupees(f.price_paise)));
        tr.appendChild(el("td", "num muted", f.cost_price_paise == null ? "\u2014" : API.rupees(f.cost_price_paise)));

        var margin = f.cost_price_paise == null ? null : f.price_paise - f.cost_price_paise;
        var pct = margin == null ? null : Math.round((margin / f.price_paise) * 100);
        var tdM = el("td", "num", margin == null ? "\u2014" : API.rupees(margin) + " \u00b7 " + pct + "%");
        if (margin != null) tdM.style.color = pct >= 40 ? "var(--green)" : "var(--orange-deep)";
        tdM.style.fontWeight = "500";
        tr.appendChild(tdM);

        var tdS = el("td", "num", String(f.stock_qty));
        tdS.style.fontWeight = "600";
        if (f.low_stock) tdS.style.color = "var(--orange-deep)";
        tr.appendChild(tdS);

        tr.appendChild(el("td", "num muted", String(f.reorder_threshold)));

        var tdA = el("td");
        tdA.style.cssText = "white-space:nowrap";
        [["+10", 10], ["+50", 50], ["\u221210", -10]].forEach(function (pair) {
          var b = el("button", "textbtn", pair[0]);
          b.type = "button";
          b.style.marginRight = "10px";
          b.addEventListener("click", async function () {
            b.disabled = true;
            try {
              await API.adjustStock(f.id, pair[1], pair[1] > 0 ? "restock" : "wastage");
              await renderCatalog();
              await renderAlerts();
            } catch (e) { if (F) F.toast(e.message); b.disabled = false; }
          });
          tdA.appendChild(b);
        });
        tr.appendChild(tdA);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      card.appendChild(wrap);
      catalogRoot.appendChild(card);

      /* categories */
      var cc = el("div", "card");
      cc.style.cssText = "padding:var(--card-pad);min-width:0";
      cc.appendChild(el("span", "label", "Categories"));
      var list = el("div");
      list.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;padding:14px 0";
      data.categories.forEach(function (c) {
        var chip = el("span", "pill pill--neutral", c.name);
        var x = el("button", "textbtn textbtn--danger", "\u00d7");
        x.type = "button";
        x.style.marginLeft = "8px";
        x.addEventListener("click", async function () {
          try { await API.deleteCategory(c.id); await renderCatalog(); }
          catch (e) { if (F) F.toast(e.message); }
        });
        chip.appendChild(x);
        list.appendChild(chip);
      });
      cc.appendChild(list);

      var form = el("div");
      form.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;align-items:center";
      var nameIn = el("input");
      nameIn.placeholder = "New category name";
      nameIn.style.cssText = "height:40px;border-radius:12px;border:1px solid var(--hairline);padding:0 14px;font:400 14px/1 var(--sans);flex:1 1 200px";
      var addBtn = el("button", "btn btn--green btn--sm", "Add category");
      addBtn.type = "button";
      addBtn.addEventListener("click", async function () {
        var nm = nameIn.value.trim();
        if (nm.length < 2) { if (F) F.toast("Give it a name first."); return; }
        var slug = nm.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
        if (slug.length < 2) { if (F) F.toast("Letters only, please."); return; }
        addBtn.disabled = true;
        try {
          await API.saveCategory({ id: slug, name: nm, sort: 100 });
          nameIn.value = "";
          await renderCatalog();
        } catch (e) { if (F) F.toast(e.message); }
        addBtn.disabled = false;
      });
      form.append(nameIn, addBtn);
      cc.appendChild(form);
      catalogRoot.appendChild(cc);
    }

    /* ---------- finance ---------- */
    async function renderFinance() {
      financeRoot.innerHTML = "";
      var to = new Date();
      var from = new Date(to.getTime() - 29 * 86400000);
      var iso = function (d) { return d.toISOString().slice(0, 10); };

      var data;
      try {
        data = await API.adminFinance(iso(from), iso(to));
      } catch (e) {
        financeRoot.appendChild(el("p", "lede", "Couldn\u2019t load finance \u2014 " + e.message));
        return;
      }
      if (!data || !data.payments) {
        financeRoot.appendChild(el("p", "lede", "No finance data for this window."));
        return;
      }

      var margin = data.revenue_paise - data.cogs_paise;
      var pct = data.revenue_paise > 0 ? Math.round((margin / data.revenue_paise) * 100) : 0;

      var kpis = el("div", "grid grid-4");
      kpis.style.gap = "18px";
      kpis.appendChild(tile("Revenue \u00b7 30 days", API.rupees(data.revenue_paise), data.orders_count + " orders"));
      kpis.appendChild(tile("Cost of goods", API.rupees(data.cogs_paise),
        data.cogs_coverage.items_with_cost + " of " + data.cogs_coverage.items_total + " items have a cost set"));
      kpis.appendChild(tile("Gross margin", API.rupees(margin), pct + "% of revenue"));
      kpis.appendChild(tile("Cash to collect", API.rupees(data.payments.cod_pending_paise), "COD not yet paid"));
      financeRoot.appendChild(kpis);

      /* daily revenue */
      var card = el("div", "card");
      card.style.cssText = "padding:var(--card-pad)";
      card.appendChild(el("span", "label", "Revenue by day"));
      if (!data.by_day.length) {
        card.appendChild(el("p", "small muted", "No delivered orders in this window yet.")).style.margin = "14px 0 0";
      } else {
        var max = data.by_day.reduce(function (m, d) { return Math.max(m, d.revenue_paise); }, 0) || 1;
        var chart = el("div");
        chart.style.cssText = "display:flex;align-items:flex-end;gap:4px;height:140px;padding-top:18px";
        data.by_day.forEach(function (d) {
          var bar = el("div");
          bar.style.cssText = "flex:1 1 0;min-width:4px;border-radius:6px 6px 0 0;background:var(--green);height:" +
            Math.max(4, Math.round((d.revenue_paise / max) * 120)) + "px";
          bar.title = d.date + " \u00b7 " + API.rupees(d.revenue_paise) + " \u00b7 " + d.orders + " orders";
          chart.appendChild(bar);
        });
        card.appendChild(chart);
        var axis = el("div");
        axis.style.cssText = "display:flex;justify-content:space-between;padding-top:8px";
        axis.appendChild(el("span", "small muted", data.by_day[0].date));
        axis.appendChild(el("span", "small muted", data.by_day[data.by_day.length - 1].date));
        card.appendChild(axis);
      }
      financeRoot.appendChild(card);

      /* payments */
      var pay = el("div", "card");
      pay.style.cssText = "padding:var(--card-pad);display:flex;flex-direction:column;gap:12px";
      pay.appendChild(el("span", "label", "Payments"));
      [["Collected on delivery", data.payments.cod_paid_paise],
       ["Still to collect", data.payments.cod_pending_paise],
       ["Paid online", data.payments.online_paise]].forEach(function (r) {
        var line = el("div");
        line.style.cssText = "display:flex;justify-content:space-between;gap:16px";
        line.appendChild(el("span", "muted", r[0]));
        line.appendChild(el("span", null, API.rupees(r[1]))).style.fontWeight = "600";
        pay.appendChild(line);
      });
      financeRoot.appendChild(pay);

      /* unfulfilled */
      var issues = [];
      try { issues = await API.openIssues(); } catch (e) { issues = []; }
      var ic = el("div", "card");
      ic.style.cssText = "padding:var(--card-pad)";
      ic.appendChild(el("span", "label", "Boxes that could not be made"));
      if (!issues.length) {
        ic.appendChild(el("p", "small muted", "Nothing outstanding \u2014 every subscription was fulfilled.")).style.margin = "14px 0 0";
      } else {
        var il = el("div", "rowlist");
        issues.forEach(function (i) {
          var r = el("div", "row");
          r.style.padding = "12px 0";
          var m = el("div", "row__main");
          m.appendChild(el("span", null, API.dateLabel(i.issue_date) + " \u00b7 " + i.reason)).style.fontWeight = "600";
          var detail = "";
          if (i.detail && i.detail.length) {
            detail = i.detail.map(function (d) {
              return d.fruit_id + " (needed " + d.needed + ", had " + d.have + ")";
            }).join(", ");
          } else if (i.detail && i.detail.error) {
            detail = i.detail.error;
          }
          m.appendChild(el("span", "small muted", detail));
          r.appendChild(m);
          var done = el("button", "textbtn", "Mark handled");
          done.type = "button";
          done.addEventListener("click", async function () {
            done.disabled = true;
            try { await API.resolveIssue(i.id); await renderFinance(); await renderAlerts(); }
            catch (e) { if (F) F.toast(e.message); done.disabled = false; }
          });
          r.appendChild(done);
          il.appendChild(r);
        });
        ic.appendChild(il);
      }
      financeRoot.appendChild(ic);
    }

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
