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

  function posMenu(menu, tg) {
    if (matchMedia("(max-width:700px)").matches) return;
    const r = tg.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(r.right - 190, innerWidth - 206)) + "px"; menu.style.top = "0px";
    const h = menu.offsetHeight; menu.style.top = (r.bottom + h + 12 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + "px";
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
          tg.addEventListener("click", (e) => { e.stopPropagation(); const was = menu.classList.contains("open"); document.querySelectorAll(".actmenu.open").forEach((m) => { m.classList.remove("open"); const b = m.parentNode.querySelector(".actbtn"); if (b) { b.textContent = "Actions ▾"; b.setAttribute("aria-expanded", "false"); } }); if (!was) { menu.classList.add("open"); posMenu(menu, tg); tg.textContent = "Actions ▴"; tg.setAttribute("aria-expanded", "true"); } });
          holder.append(tg, menu); td.classList.add("actcell");
        } else { while (td.firstChild) holder.appendChild(td.firstChild); }
        td.appendChild(holder); td.dataset.wrapped = "1";
      }));
      if (!t.querySelector("tbody#rows")) t.classList.add("cardtbl");
      if (t.querySelector("td.actcell")) { const l = t.querySelector("thead th:last-child"); if (l) l.classList.add("actth"); }
    });
  }
  document.addEventListener("click", (e) => { if (e.target.closest(".actmenu,.actbtn")) return; document.querySelectorAll(".actmenu.open").forEach((m) => { m.classList.remove("open"); const b = m.parentNode.querySelector(".actbtn"); if (b) { b.textContent = "Actions ▾"; b.setAttribute("aria-expanded", "false"); } }); });

  new MutationObserver(() => { try { addClose(); } catch (e) {} }).observe(document.body, { childList: true });
  const shut = () => { if (matchMedia("(max-width:700px)").matches) return; document.querySelectorAll(".actmenu.open").forEach((m) => { m.classList.remove("open"); const b = m.parentNode.querySelector(".actbtn"); if (b) { b.textContent = b.textContent.replace(/.$/, "\u25BE"); b.setAttribute("aria-expanded", "false"); } }); };
  window.addEventListener("scroll", shut, true); window.addEventListener("resize", shut);
  let pend = false;
  const run = () => { pend = false; try { addClose(); cardify(); } catch (e) {} };
  new MutationObserver(() => { if (!pend) { pend = true; setTimeout(run, 120); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  run();
})();
