/* Fruitly — shared UI + the box (cart). The box is presentation state only:
   prices and totals are computed by the backend at checkout, never here. */
(function () {
  "use strict";

  // Display labels for toasts; the authoritative catalogue lives in the backend.
  var FRUIT_LABELS = {
    mango: "Alphonso mango", kiwi: "Kiwi", watermelon: "Watermelon",
    pomegranate: "Pomegranate", papaya: "Papaya", pineapple: "Pineapple",
    grapes: "Black grapes", strawberry: "Strawberry"
  };

  var KEY = "fruitly.box.v1";

  function readBox() {
    try {
      var raw = localStorage.getItem(KEY);
      var box = raw ? JSON.parse(raw) : {};
      if (!box || typeof box !== "object") return {};
      var clean = {};
      Object.keys(box).forEach(function (id) {
        var n = parseInt(box[id], 10);
        if (/^[a-z_]{2,30}$/.test(id) && n > 0) clean[id] = Math.min(n, 9);
      });
      return clean;
    } catch (e) { return {}; }
  }

  function writeBox(box) {
    try { localStorage.setItem(KEY, JSON.stringify(box)); } catch (e) { /* private mode */ }
    updateBadge(box);
  }

  function clearBox() { writeBox({}); }

  function boxCount(box) {
    return Object.keys(box).reduce(function (s, id) { return s + box[id]; }, 0);
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
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-show"); }, 2600);
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

  /* ---------- add-to-box buttons ---------- */
  function initAddButtons() {
    document.querySelectorAll("[data-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var id = btn.getAttribute("data-add");
        var box = readBox();
        box[id] = Math.min((box[id] || 0) + 1, 9);
        writeBox(box);
        var n = boxCount(box);
        toast((FRUIT_LABELS[id] || "Added") + " — " + n + (n === 1 ? " cup" : " cups") + " in your box");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initAddButtons();
    updateBadge();
    if (window.FruitlyAPI) window.FruitlyAPI.hydrateCatalog();
  });

  window.Fruitly = {
    FRUIT_LABELS: FRUIT_LABELS,
    readBox: readBox,
    writeBox: writeBox,
    clearBox: clearBox,
    updateBadge: updateBadge,
    toast: toast
  };
})();
