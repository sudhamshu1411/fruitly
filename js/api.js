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
    window.FRUITLY_CONFIG.anonKey,
    {
      auth: {
        /* Set explicitly rather than relying on the library default. PKCE
           returns a single-use code in the query string, exchanged against a
           verifier this browser generated and never sent — so a code captured
           from a URL, a referrer header or shoulder-surfed history is useless
           to anyone else. The implicit alternative puts the access and refresh
           tokens straight in the URL fragment. */
        flowType: "pkce",
        detectSessionInUrl: true,   // the callback page depends on this
        autoRefreshToken: true,
        persistSession: true
      }
    }
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
    /* Where Supabase sends people back to after they click a link in an email
       or finish with Google. Same page handles both. */
    callbackUrl: function (next) {
      var base = location.origin + location.pathname.replace(/[^/]*$/, "");
      var safe = /^[a-z0-9-]+\.html$/.test(next || "") ? next : "account.html";
      return base + "auth-callback.html?next=" + encodeURIComponent(safe);
    },

    /* Standard signUp, not the admin API. This is what makes confirmation real:
       the account exists but cannot sign in until the emailed link is clicked,
       so a spam signup is an inert row rather than a usable account.

       Supabase deliberately returns success for an address that already exists
       (with an identities array of length 0) so this cannot be used to discover
       who has an account — so the caller must not treat "no error" as "new
       account created". */
    signUp: async function (email, password, fullName, next) {
      var res = await sb.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: fullName || "" },
          emailRedirectTo: API.callbackUrl(next)
        }
      });
      if (res.error) throw new Error(res.error.message);
      var user = res.data && res.data.user;
      return {
        // A session only comes back when confirmation is switched off.
        needsConfirmation: !(res.data && res.data.session),
        // Empty identities means the address was already registered.
        alreadyRegistered: !!(user && user.identities && user.identities.length === 0)
      };
    },

    resendConfirmation: async function (email, next) {
      return unwrap(await sb.auth.resend({
        type: "signup",
        email: email,
        options: { emailRedirectTo: API.callbackUrl(next) }
      }));
    },

    /* PKCE is the default for OAuth in supabase-js v2, so no client secret ever
       touches the browser and the code cannot be replayed from a stolen URL.
       prompt=select_account stops Google silently reusing whichever account
       happens to be signed in, which is the usual cause of "it logged me into
       the wrong account". */
    signInWithGoogle: async function (next) {
      var res = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: API.callbackUrl(next),
          queryParams: { prompt: "select_account" }
        }
      });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    signIn: async function (email, password) {
      return unwrap(await sb.auth.signInWithPassword({ email: email, password: password }));
    },
    signOut: async function () {
      await sb.auth.signOut();
    },
    /* Sends the recovery mail. Supabase answers the same way whether or not the
       address is registered, so this never confirms who has an account. */
    requestPasswordReset: async function (email) {
      var base = location.origin + location.pathname.replace(/[^/]*$/, "");
      return unwrap(await sb.auth.resetPasswordForEmail(email, {
        redirectTo: base + "reset.html"
      }));
    },
    /* Only works while a session exists — either the recovery link's temporary
       session, or an ordinary signed-in one changing their password. */
    updatePassword: async function (password) {
      return unwrap(await sb.auth.updateUser({ password: password }));
    },
    onAuthEvent: function (fn) {
      return sb.auth.onAuthStateChange(fn);
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
    /* ---------- staff: catalogue, inventory, finance ----------
       Cost prices and the stock ledger live behind these calls, never in the
       public catalogue query. Every one is staff-gated server-side; the UI
       hiding a button is a convenience, not the control. */
    adminCatalog: async function () {
      return unwrap(await sb.rpc("admin_catalog"));
    },
    adminFinance: async function (fromDate, toDate) {
      return unwrap(await sb.rpc("admin_finance_summary", { p_from: fromDate, p_to: toDate }));
    },
    adjustStock: async function (fruitId, delta, reason, note) {
      return unwrap(await sb.rpc("adjust_stock", {
        p_fruit_id: fruitId, p_delta: delta, p_reason: reason, p_note: note || null
      }));
    },
    setFruitOps: async function (fruitId, costPaise, reorderThreshold) {
      return unwrap(await sb.rpc("set_fruit_ops", {
        p_fruit_id: fruitId, p_cost_price_paise: costPaise, p_reorder_threshold: reorderThreshold
      }));
    },
    stockLedger: async function (fruitId, limit) {
      return unwrap(await sb.from("inventory_movements")
        .select("*").eq("fruit_id", fruitId)
        .order("created_at", { ascending: false }).limit(limit || 20));
    },
    openIssues: async function () {
      return unwrap(await sb.from("fulfillment_issues")
        .select("*").is("resolved_at", null)
        .order("issue_date", { ascending: false }).limit(50));
    },
    resolveIssue: async function (id) {
      return unwrap(await sb.rpc("resolve_fulfillment_issue", { p_id: id }));
    },
    categories: async function () {
      return unwrap(await sb.from("categories").select("*").order("sort"));
    },
    saveCategory: async function (c) {
      return unwrap(await sb.from("categories")
        .upsert({ id: c.id, name: c.name, sort: c.sort || 100, is_active: c.is_active !== false })
        .select().single());
    },
    deleteCategory: async function (id) {
      return unwrap(await sb.from("categories").delete().eq("id", id));
    },
    setFruitCategory: async function (fruitId, categoryId) {
      return unwrap(await sb.from("fruits").update({ category_id: categoryId || null }).eq("id", fruitId).select());
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
