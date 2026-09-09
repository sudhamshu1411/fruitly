/* Fruitly API layer — every write goes through the backend, which recomputes
   prices and enforces ownership. Nothing here is trusted by the server. */
(function () {
  "use strict";
  if (!window.supabase || !window.FRUITLY_CONFIG) {
    console.error("Fruitly: supabase-js or config missing");
    return;
  }

  var sb = window.supabase.createClient(
    window.FRUITLY_CONFIG.url,
    window.FRUITLY_CONFIG.anonKey
  );

  function unwrap(res) {
    if (res.error) {
      var msg = res.error.message || "something went wrong";
      // Postgres RAISE messages arrive as "P0001: <msg>" via PostgREST
      throw new Error(msg.replace(/^[A-Z0-9]{5}:\s*/, ""));
    }
    return res.data;
  }

  var API = {
    client: sb,

    /* ---------- auth ---------- */
    session: async function () {
      return (await sb.auth.getSession()).data.session || null;
    },
    /* The signed-in user's id. Every "my data" query below filters on this
       explicitly. RLS is the security boundary, but staff policies read
       "own row OR is_staff()", so a staff session would otherwise match every
       customer's rows — silently on a list, and fatally on maybeSingle(). */
    uid: async function () {
      var s = await API.session();
      return s ? s.user.id : null;
    },
    requireSession: async function (nextPage) {
      var s = await API.session();
      if (!s) {
        var next = encodeURIComponent(nextPage || location.pathname.split("/").pop() || "index.html");
        location.href = "auth.html?next=" + next;
        return null;
      }
      return s;
    },
    signUp: async function (email, password, fullName) {
      var res = await sb.functions.invoke("signup", {
        body: { email: email, password: password, full_name: fullName }
      });
      if (res.error) {
        var detail = null;
        try { detail = await res.error.context.json(); } catch (e) { /* no body */ }
        throw new Error((detail && detail.error) || "could not create the account");
      }
      return API.signIn(email, password);
    },
    signIn: async function (email, password) {
      return unwrap(await sb.auth.signInWithPassword({ email: email, password: password }));
    },
    signOut: async function () {
      await sb.auth.signOut();
    },

    /* ---------- catalogue (public) ---------- */
    fruits: async function () {
      return unwrap(await sb.from("fruits").select("*").eq("is_active", true).order("sort"));
    },
    boxes: async function () {
      return unwrap(await sb.from("boxes").select("*").order("sort"));
    },

    /* ---------- profile & account ---------- */
    profile: async function () {
      return unwrap(await sb.from("profiles").select("*")
        .eq("id", await API.uid()).maybeSingle());
    },
    saveProfile: async function (fields) {
      var uid = (await API.session()).user.id;
      return unwrap(await sb.from("profiles").update({
        full_name: fields.full_name,
        phone: fields.phone || null,
        doorstep_note: fields.doorstep_note || null
      }).eq("id", uid).select().single());
    },
    addresses: async function () {
      return unwrap(await sb.from("addresses").select("*")
        .eq("user_id", await API.uid()).order("created_at"));
    },
    addAddress: async function (a) {
      var uid = (await API.session()).user.id;
      return unwrap(await sb.from("addresses").insert({
        user_id: uid, label: a.label || "Home", line1: a.line1, line2: a.line2 || null,
        city: a.city || "Bengaluru", pincode: a.pincode, is_default: true
      }).select().single());
    },
    deleteAddress: async function (id) {
      return unwrap(await sb.from("addresses").delete().eq("id", id));
    },
    makeDefaultAddress: async function (id) {
      return unwrap(await sb.from("addresses").update({ is_default: true }).eq("id", id).select());
    },
    exclusions: async function () {
      return unwrap(await sb.from("exclusions").select("fruit_id")
        .eq("user_id", await API.uid()));
    },
    setExclusions: async function (fruitIds) {
      return unwrap(await sb.rpc("set_exclusions", { p_fruit_ids: fruitIds }));
    },

    /* ---------- subscription lifecycle ---------- */
    mySubscription: async function () {
      return unwrap(await sb.from("subscriptions")
        .select("*, subscription_items(fruit_id, cups)")
        .eq("user_id", await API.uid())
        .in("status", ["active", "paused"]).maybeSingle());
    },
    mySkips: async function (subId) {
      return unwrap(await sb.from("skips").select("skip_date").eq("subscription_id", subId));
    },
    createSubscription: async function (opts) {
      return unwrap(await sb.rpc("create_subscription", {
        p_cadence: opts.cadence,
        p_days: opts.days || [],
        p_cutting: opts.cutting || "cubed",
        p_payment: opts.payment || "cod",
        p_box_id: opts.boxId || null,
        p_items: opts.items || null
      }));
    },
    placeOrder: async function (items, cutting) {
      return unwrap(await sb.rpc("place_one_time_order", {
        p_items: items, p_cutting: cutting || "cubed"
      }));
    },
    skip: async function (subId, date) {
      return unwrap(await sb.rpc("skip_delivery", { p_subscription: subId, p_date: date }));
    },
    unskip: async function (subId, date) {
      return unwrap(await sb.rpc("unskip_delivery", { p_subscription: subId, p_date: date }));
    },
    pause: async function (subId, untilDate) {
      return unwrap(await sb.rpc("pause_subscription", { p_subscription: subId, p_until: untilDate }));
    },
    resume: async function (subId) {
      return unwrap(await sb.rpc("resume_subscription", { p_subscription: subId }));
    },
    cancelSubscription: async function (subId) {
      return unwrap(await sb.rpc("cancel_subscription", { p_subscription: subId }));
    },
    updatePrefs: async function (subId, days, cutting) {
      return unwrap(await sb.rpc("update_subscription_prefs", {
        p_subscription: subId, p_days: days, p_cutting: cutting
      }));
    },

    /* ---------- orders ---------- */
    myOrders: async function (limit) {
      return unwrap(await sb.from("orders")
        .select("*, order_items(fruit_id, cups, price_paise_per_cup), ratings(stars)")
        .eq("user_id", await API.uid())
        .order("delivery_date", { ascending: false }).limit(limit || 30));
    },
    rateOrder: async function (orderId, stars, comment) {
      return unwrap(await sb.rpc("rate_order", {
        p_order: orderId, p_stars: stars, p_comment: comment || null
      }));
    },

    /* ---------- staff ---------- */
    adminToday: async function () {
      return unwrap(await sb.rpc("admin_today"));
    },
    adminOrders: async function () {
      return unwrap(await sb.from("orders")
        .select("*, profiles!orders_user_id_fkey(full_name)")
        .order("delivery_date", { ascending: true })
        .order("created_at", { ascending: true }).limit(60));
    },
    advanceOrder: async function (orderId) {
      return unwrap(await sb.rpc("advance_order", { p_order: orderId }));
    },
    failOrder: async function (orderId) {
      return unwrap(await sb.rpc("fail_order", { p_order: orderId }));
    },

    /* ---------- formatting ---------- */
    rupees: function (paise) {
      var r = paise / 100;
      return "₹" + (Number.isInteger(r) ? r : r.toFixed(2));
    },
    dateLabel: function (iso) {
      var d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    },
    DAY_KEYS: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],

    /* Next n delivery dates for a cadence, client-side, for display only. */
    upcomingDates: function (cadence, days, n) {
      var out = [];
      var d = new Date();
      for (var i = 1; i <= 70 && out.length < (n || 3); i++) {
        var t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
        var dow = (t.getDay() + 6) % 7; // 0 = Mon
        var hit = cadence === "daily" ? true
          : cadence === "monthly" ? days.indexOf(dow) >= 0 && t.getDate() <= 7
          : days.indexOf(dow) >= 0;
        if (hit) {
          out.push(t.getFullYear() + "-" +
            String(t.getMonth() + 1).padStart(2, "0") + "-" +
            String(t.getDate()).padStart(2, "0"));
        }
      }
      return out;
    }
  };

  /* Hydrate any static price/availability markup from the live catalogue. */
  API.hydrateCatalog = async function () {
    try {
      var fruits = await API.fruits();
      fruits.forEach(function (f) {
        document.querySelectorAll('[data-price-of="' + f.id + '"]').forEach(function (el) {
          el.textContent = API.rupees(f.price_paise);
        });
        document.querySelectorAll('[data-meta-of="' + f.id + '"]').forEach(function (el) {
          el.textContent = f.cut_desc + " · " + f.grams_per_cup + "g cup";
        });
        document.querySelectorAll('[data-fruit-card="' + f.id + '"]').forEach(function (card) {
          card.classList.toggle("is-out", f.sold_out);
          card.querySelectorAll("[data-add]").forEach(function (b) {
            b.disabled = f.sold_out;
          });
        });
      });
    } catch (e) { /* static prices remain as fallback */ }
  };

  /* Nav account state: green avatar when signed in. */
  document.addEventListener("DOMContentLoaded", async function () {
    try {
      var s = await API.session();
      if (s) {
        document.querySelectorAll('a[href="account.html"].avatar').forEach(function (el) {
          el.style.background = "var(--green)";
          el.style.color = "#fff";
        });
        document.querySelectorAll("[data-signedout-only]").forEach(function (el) { el.hidden = true; });
      } else {
        document.querySelectorAll("[data-signedin-only]").forEach(function (el) { el.hidden = true; });
      }
    } catch (e) { /* offline — leave defaults */ }
  });

  window.FruitlyAPI = API;
})();
