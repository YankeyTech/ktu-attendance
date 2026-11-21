// Update 49 for the lecturer portal: tidier start form, quick chips, share, keep-awake, notepad, exports, shortcuts, density, remembered tab.
(function () {
  const mk = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // 1+2. Quick chips for minutes and distance
  function chips(inputId, values, unit) {
    const inp = $(inputId); if (!inp || inp.dataset.chips) return; inp.dataset.chips = "1";
    const row = mk("div", "qchips"); row.setAttribute("role", "group");
    for (const v of values) { const b = mk("button", "qchip", v + unit); b.type = "button"; b.addEventListener("click", () => { inp.value = v; inp.dispatchEvent(new Event("input")); sync(); }); row.appendChild(b); }
    const sync = () => row.querySelectorAll(".qchip").forEach((b, i) => b.classList.toggle("on", Number(inp.value) === values[i]));
    inp.addEventListener("input", sync); inp.parentNode.appendChild(row); sync();
  }
  chips("mins", [30, 45, 60, 90, 120], " min"); chips("radius", [30, 50, 100, 200], " m");

  // 3. Section headings in the start form
  (function sections() {
    const f = $("start"); if (!f) return;
    const before = (el, text, n) => { if (!el || f.querySelector('[data-sec="' + n + '"]')) return; const h = mk("h3", "fsec"); h.dataset.sec = n; h.innerHTML = '<i>' + n + "</i>" + text; el.parentNode.insertBefore(h, el); };
    before(f.querySelector('label[for="coursePick"]'), "Which class?", 1);
    before($("mins").closest(".row"), "When and how far?", 2);
    before(f.querySelector('label[for="venue"]'), "Where?", 3);
  })();

  // 4. WhatsApp share of the live class
  (function wa() {
    const s = $("shareBtn"); if (!s || $("waBtn")) return;
    const b = mk("button", "btn quiet", "Send on WhatsApp"); b.id = "waBtn"; b.type = "button";
    b.addEventListener("click", () => { if (!current) return; const txt = (typeof classMessage === "function" ? classMessage() : "Attendance: " + current.course + " " + studentLink(current.code)); window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener"); });
    s.after(b);
  })();

  // 5. Keep the screen awake while a class is live
  (function awake() {
    const live = $("live"); if (!live || !("wakeLock" in navigator)) return;
    const lab = mk("label", "chk mini"), cb = mk("input"); cb.type = "checkbox"; cb.id = "awakeCb"; cb.checked = LS.get("ktu_awake", "1") === "1"; lab.append(cb, document.createTextNode(" Keep screen on"));
    const head = live.querySelector(".livehead"); if (head) head.appendChild(lab);
    let lock = null;
    const need = () => cb.checked && !live.hidden && document.visibilityState === "visible";
    const apply = async () => { try { if (need() && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } else if (!need() && lock) { await lock.release(); lock = null; } } catch (e) {} };
    cb.addEventListener("change", () => { LS.set("ktu_awake", cb.checked ? "1" : "0"); apply(); });
    document.addEventListener("visibilitychange", apply);
    new MutationObserver(apply).observe(live, { attributes: true, attributeFilter: ["hidden"] });
  })();

  // 6. Personal notepad on Home
  (function pad() {
    const home = $("p-home"); if (!home || $("padBox")) return;
    const d = mk("details", "pad"); d.id = "padBox"; const s = mk("summary", "", "My notepad"); const t = mk("textarea"); t.rows = 4; t.maxLength = 2000; t.placeholder = "Private notes, kept on this phone only.";
    const key = () => "ktu_pad_" + (window.myId || "x"); const note = mk("small", "note", "Saved on this device only.");
    d.append(s, t, note); home.appendChild(d);
    d.addEventListener("toggle", () => { if (d.open) t.value = LS.get(key(), ""); });
    t.addEventListener("input", () => LS.set(key(), t.value));
  })();

  // 7. Export my classes (Excel)
  (function exp() {
    const host = $("p-classes"); if (!host || $("myClsX")) return;
    const b = mk("button", "btn quiet", "Download all my classes (Excel)"); b.id = "myClsX"; b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true; try {
        const rows = await fetchAllRows(sb, "attendance", "session_id,in_range", "id", false), n = {}, out = {};
        for (const r of rows) { n[r.session_id] = (n[r.session_id] || 0) + 1; if (!r.in_range) out[r.session_id] = (out[r.session_id] || 0) + 1; }
        const list = (typeof mySessions !== "undefined" ? mySessions : []);
        downloadXlsx("My classes " + new Date().toLocaleDateString("en-CA"), [{ name: "Classes", rows: [["Course", "Programme", "Level", "Year", "Semester", "Started", "Check-ins", "Outside area"], ...list.map((s) => [s.course, s.programme || "", s.level || "", s.academic_year || "", s.semester || "", new Date(s.created_at).toLocaleString(), n[s.id] || 0, out[s.id] || 0])] }]);
      } catch (e) { toast("Could not build the file."); } b.disabled = false;
    });
    const h = host.querySelector("h2"); (h || host.firstElementChild).after(b);
  })();

  // 8. Copy the present list as plain text
  (function copyList() {
    const c = $("csv"); if (!c || $("copyPresent")) return;
    const b = mk("button", "btn quiet", "Copy names and index numbers"); b.id = "copyPresent"; b.type = "button";
    b.addEventListener("click", async () => {
      if (!current) return; const r = await sb.from("attendance").select("student_name,index_number,in_range").eq("session_id", current.id).order("student_name");
      const ok = await copyText((r.data || []).map((x, i) => (i + 1) + ". " + (x.student_name || "") + " - " + x.index_number + (x.in_range ? "" : " (outside)")).join("\n"));
      toast(ok ? "List copied." : "Copy failed.");
    });
    c.before(b);
  })();

  // 9. Keyboard shortcuts and help
  function help() {
    if (document.querySelector(".kbhelp")) return;
    const ov = mk("div", "rpt kbhelp"), box = mk("div", "rptc"); ov.appendChild(box);
    box.append(mk("h3", "", "Shortcuts"));
    const ul = mk("ul"); for (const t of ["H  Home", "A  Alerts", "R  Rolls", "C  Classes", "U  Account", "S  Start a class (go to the form)", "?  This help"]) ul.appendChild(mk("li", "", t));
    const x = mk("button", "btn", "Close"); x.type = "button"; x.addEventListener("click", () => ov.remove()); box.append(ul, x);
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) return;
    const k = e.key.toLowerCase(), map = { h: "home", a: "alerts", r: "rolls", c: "classes", u: "account" };
    if (map[k] && typeof showTab === "function") showTab(map[k]);
    else if (k === "s" && typeof showTab === "function") { showTab("home"); const f = $("start"); if (f) f.scrollIntoView({ behavior: "smooth" }); }
    else if (e.key === "?") help();
  });

  // 10. Compact lists
  (function dens() {
    document.body.classList.toggle("compact", LS.get("ktu_compact", "0") === "1");
    const acc = $("p-account"); if (!acc || $("compactCb")) return;
    const lab = mk("label", "chk"), cb = mk("input"); cb.type = "checkbox"; cb.id = "compactCb"; cb.checked = document.body.classList.contains("compact");
    lab.append(cb, document.createTextNode(" Compact lists (fit more on the screen)")); cb.addEventListener("change", () => { document.body.classList.toggle("compact", cb.checked); LS.set("ktu_compact", cb.checked ? "1" : "0"); });
    const h = acc.querySelector("h2, h3"); (h || acc).after(lab);
  })();

  // 11. Remember the last section
  (function remember() {
    if (typeof showTab !== "function") return;
    const orig = window.showTab; if (orig.__w) return;
    const w = function (name, keep) { LS.set("ktu_tab", name); return orig(name, keep); }; w.__w = 1; window.showTab = w;
    document.querySelectorAll("#tabs [data-p]").forEach((b) => b.addEventListener("click", () => LS.set("ktu_tab", b.dataset.p)));
    const last = LS.get("ktu_tab", "home");
    const tryShow = () => { if (!$("app").hidden && ["home", "alerts", "rolls", "classes", "account"].includes(last) && !location.search.includes("open=")) { showTab(last, true); return true; } return false; };
    if (!tryShow()) new MutationObserver((m, o) => { if (tryShow()) o.disconnect(); }).observe($("app"), { attributes: true, attributeFilter: ["hidden"] });
  })();

  // 12. Tables as cards on phones
  (function cards() {
    const label = (t) => { const hs = Array.from(t.querySelectorAll("thead th")).map((h) => h.textContent.replace(/[⇅]/g, "").trim()); if (!hs.length) return; t.querySelectorAll("tbody tr").forEach((r) => Array.from(r.children).forEach((c, i) => { if (c.tagName === "TD" && !c.dataset.label && hs[i]) c.dataset.label = hs[i]; })); t.classList.add("cardtbl"); };
    let pend = false; const run = () => { pend = false; document.querySelectorAll("#app table").forEach(label); };
    new MutationObserver(() => { if (!pend) { pend = true; setTimeout(run, 80); } }).observe($("app"), { childList: true, subtree: true }); run();
  })();
})();
