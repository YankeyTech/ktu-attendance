// Update 50: shared touch-friendly behaviour for both portals.
// 1) every popup gets a close button  2) row buttons collapse into an Actions menu on phones
// 3) table cells wrap cleanly inside card rows  4) closes menus on outside tap
(function () {
  const mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

  function closeOverlay(ov) {
    ov.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    setTimeout(() => { if (!document.contains(ov)) return; const shown = !ov.hidden && getComputedStyle(ov).display !== "none"; if (shown) { if (ov.id) ov.hidden = true; else ov.remove(); } }, 80);
  }
  function addClose() {
    document.querySelectorAll(".rpt").forEach((ov) => {
      if (ov.classList.contains("palette") || ov.dataset.x) return;
      const c = ov.querySelector(".rptc"); if (!c) return; ov.dataset.x = "1";
      if (c.querySelector(".xbtn,[id$='Close']")) return;
      const b = mk("button", "xbtn", "×"); b.type = "button"; b.setAttribute("aria-label", "Close this window");
      b.addEventListener("click", (e) => { e.stopPropagation(); closeOverlay(ov); });
      c.prepend(b);
    });
  }

  const phone = () => matchMedia("(max-width:700px)").matches;
  const openMenus = new Set();
  function closeMenu(m) {
    m.classList.remove("open"); openMenus.delete(m);
    const tg = m._btn; if (tg) { tg.textContent = "Actions \u25BE"; tg.setAttribute("aria-expanded", "false"); }
    if (m._home && m.parentNode !== m._home) { m.style.left = m.style.top = ""; m._home.appendChild(m); }
  }
  function closeAll(except) { Array.from(openMenus).forEach((m) => { if (m !== except) closeMenu(m); }); }
  function openMenu(m) {
    closeAll(m); m.classList.add("open"); openMenus.add(m);
    const tg = m._btn; tg.textContent = "Actions \u25B4"; tg.setAttribute("aria-expanded", "true");
    if (phone()) return;
    document.body.appendChild(m); // outside the card, so nothing clips or shifts it
    const r = tg.getBoundingClientRect(), w = m.offsetWidth || 190, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
    m.style.top = Math.max(8, (r.bottom + h + 12 > innerHeight) ? r.top - h - 6 : r.bottom + 6) + "px";
  }
  const ARROWS = /[▲▼▴▾⇅↕⇕↑↓]/g;
  function cardify() {
    document.querySelectorAll("#app table").forEach((t) => {
      const hs = Array.from(t.querySelectorAll("thead th")).map((h) => h.textContent.replace(ARROWS, "").trim()); if (!hs.length) return;
      t.querySelectorAll("tbody tr").forEach((r) => Array.from(r.children).forEach((td, i) => {
        if (td.tagName !== "TD" || td.dataset.wrapped) return;
        if (!td.dataset.label && hs[i]) td.dataset.label = hs[i]; td.dataset.label = (td.dataset.label || "").replace(ARROWS, "").trim();
        if (td.colSpan > 1) { td.dataset.wrapped = "1"; return; }
        const kids = Array.from(td.children), acts = kids.filter((k) => k.matches("button,a[href]"));
        const holder = mk("div", "cv");
        if (acts.length >= 2 && acts.length === kids.length && !td.textContent.replace(acts.map((a) => a.textContent).join(""), "").trim()) {
          const menu = mk("div", "actmenu"); acts.forEach((a) => menu.appendChild(a));
          const tg = mk("button", "actbtn", "Actions ▾"); tg.type = "button"; tg.setAttribute("aria-expanded", "false"); tg.setAttribute("aria-haspopup", "true");
          menu._btn = tg; menu._home = holder; menu.addEventListener("click", (e) => { if (e.target.closest("button,a")) setTimeout(() => closeMenu(menu), 0); }); tg.addEventListener("click", (e) => { e.stopPropagation(); if (menu.classList.contains("open")) closeMenu(menu); else openMenu(menu); });
          holder.append(tg, menu); td.classList.add("actcell");
        } else { while (td.firstChild) holder.appendChild(td.firstChild); }
        td.appendChild(holder); td.dataset.wrapped = "1";
      }));
      if (!t.querySelector("tbody#rows")) t.classList.add("cardtbl");
      if (t.querySelector("td.actcell")) { const l = t.querySelector("thead th:last-child"); if (l) l.classList.add("actth"); }
    });
  }
  document.addEventListener("click", (e) => { if (e.target.closest(".actmenu,.actbtn")) return; closeAll(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  new MutationObserver(() => { try { addClose(); } catch (e) {} }).observe(document.body, { childList: true });
  const shut = () => { if (!phone()) closeAll(); };
  window.addEventListener("scroll", shut, true); window.addEventListener("resize", shut);
  let pend = false;
  const run = () => { pend = false; try { addClose(); cardify(); } catch (e) {} };
  new MutationObserver(() => { if (!pend) { pend = true; setTimeout(run, 120); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  run();
})();
