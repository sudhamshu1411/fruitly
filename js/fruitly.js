/* Fruitly — shared UI + box state. No backend: the box lives in localStorage. */
(function () {
  "use strict";

  /* ---------- catalogue (sample pricing) ---------- */
  var FRUITS = {
    mango:       { name: "Alphonso mango", cut: "Peeled and cubed",  grams: 220, price: 120, color: "#FFC233" },
    kiwi:        { name: "Kiwi",           cut: "Peeled and sliced", grams: 180, price: 90,  color: "#A8C64D" },
    watermelon:  { name: "Watermelon",     cut: "Deseeded and cubed",grams: 250, price: 80,  color: "#FF6B5A" },
    pomegranate: { name: "Pomegranate",    cut: "Hand-seeded",       grams: 200, price: 110, color: "#8E3B6B" },
    papaya:      { name: "Papaya",         cut: "Deseeded and cubed",grams: 250, price: 70,  color: "#F2A93B" },
    pineapple:   { name: "Pineapple",      cut: "Cored and ringed",  grams: 220, price: 95,  color: "#E8B94A" },
    grapes:      { name: "Black grapes",   cut: "Washed, seedless",  grams: 200, price: 85,  color: "#5A2646" }
  };

  /* ---------- box state ---------- */
  var KEY = "fruitly.box.v1";

  function readBox() {
    try {
      var raw = localStorage.getItem(KEY);
      var box = raw ? JSON.parse(raw) : {};
      if (!box || typeof box !== "object") return {};
      var clean = {};
      Object.keys(box).forEach(function (id) {
        var n = parseInt(box[id], 10);
        if (FRUITS[id] && n > 0) clean[id] = Math.min(n, 9);
      });
      return clean;
    } catch (e) { return {}; }
  }

  function writeBox(box) {
    try { localStorage.setItem(KEY, JSON.stringify(box)); } catch (e) { /* private mode etc. */ }
    updateBadge(box);
  }

  function boxCount(box) {
    return Object.keys(box).reduce(function (s, id) { return s + box[id]; }, 0);
  }

  function boxTotals(box) {
    var grams = 0, price = 0;
    Object.keys(box).forEach(function (id) {
      grams += FRUITS[id].grams * box[id];
      price += FRUITS[id].price * box[id];
    });
    return { grams: grams, price: price, cups: boxCount(box) };
  }

  function updateBadge(box) {
    var el = document.querySelector("[data-boxbadge]");
    if (el) el.setAttribute("data-count", String(boxCount(box || readBox())));
  }

  /* ---------- toast ---------- */
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(function () { toastEl.classList.add("is-show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-show"); }, 2200);
  }

  /* ---------- nav ---------- */
  function initNav() {
    var bar = document.querySelector(".navbar");
    var toggle = document.querySelector(".nav-toggle");
    if (bar && toggle) {
      toggle.addEventListener("click", function () {
        var open = bar.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!els.length || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- add-to-box buttons (Home + Shop) ---------- */
  function initAddButtons() {
    document.querySelectorAll("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-add");
        if (!FRUITS[id]) return;
        var box = readBox();
        box[id] = Math.min((box[id] || 0) + 1, 9);
        writeBox(box);
        toast(FRUITS[id].name + " added — " + boxCount(box) + (boxCount(box) === 1 ? " cup" : " cups") + " in your box");
      });
    });
  }

  /* ---------- checkout stub dialog ---------- */
  function initCheckoutStub() {
    var dlg = document.getElementById("checkout-sheet");
    document.querySelectorAll("[data-checkout]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (dlg && dlg.showModal) dlg.showModal();
        else toast("Checkout isn’t connected in this build yet.");
      });
    });
    if (dlg) {
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      dlg.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () { dlg.close(); });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initReveal();
    initAddButtons();
    initCheckoutStub();
    updateBadge();
  });

  window.Fruitly = {
    FRUITS: FRUITS,
    readBox: readBox,
    writeBox: writeBox,
    boxTotals: boxTotals,
    updateBadge: updateBadge,
    toast: toast
  };
})();
