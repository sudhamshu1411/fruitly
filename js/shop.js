/* Shop — category tabs. */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    var tabs = document.querySelectorAll("[data-tab]");
    var groups = document.querySelectorAll("[data-group]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var cat = tab.getAttribute("data-tab");
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-on", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        groups.forEach(function (g) {
          var show = cat === "all" || g.getAttribute("data-group") === cat;
          g.hidden = !show;
        });
      });
    });
  });
})();
