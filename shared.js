// Shared helpers: Excel export, QR code, count-up and confetti.
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
// ---- Class rolls: level options and matching ----
const ROLL_LEVELS = ["Level 100", "Level 200", "Level 300", "Level 400", "Postgraduate"];
const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
// "Level 100", "100" and "level100" all count as the same level.
const levelKey = (x) => { const t = String(x || "").trim().toLowerCase(), m = t.match(/\d{3}/); return m ? m[0] : t; };
// Does this roll row belong to this class? Rolls saved before programme or level existed still count.
function rollMatchesClass(r, c) {
  const rp = String(r.programme || "").trim(), rl = String(r.level || "").trim();
  if (!rp) return true;
  const levelOk = (cl) => !rl || !String(cl || "").trim() || String(cl).trim().toLowerCase() === "all levels" || levelKey(cl) === levelKey(rl);
  const groups = c.combined ? (c.class_groups || []) : [{ programme: c.programme, level: c.level }];
  return groups.some((g) => sameText(g.programme, rp) && levelOk(g.level));
}
function fillLevelSel(sel, placeholder) {
  sel.textContent = "";
  for (const t of [""].concat(ROLL_LEVELS)) { const o = document.createElement("option"); o.value = t; o.textContent = t || placeholder || "Select the level"; sel.appendChild(o); }
}
async function deleteRollIds(sb, ids) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from("rolls").delete().in("id", ids.slice(i, i + 100)).select("id");
    if (error) return { error, n };
    n += (data || []).length;
  }
  return { n };
}
// Forgot password: the server only sends an email when the address belongs to an active account.
async function sendResetLink(sb, email) {
  const r = await sb.functions.invoke("staff-access", { body: { action: "forgot", email } });
  if (r.error) return { ok: false, error: "Could not reach the server. Check your internet and try again." };
  return r.data && r.data.error ? { ok: false, error: r.data.error } : { ok: true };
}
function wireForgot(sb, loginId) {
  const login = document.getElementById(loginId), box = document.getElementById("forgotBox");
  if (!login || !box) return;
  const msg = document.getElementById("forgotMsg"), em = document.getElementById("forgotEmail"), go = document.getElementById("forgotGo");
  const say = (t, k) => { msg.textContent = t; msg.className = "msg " + (k || ""); };
  document.getElementById("forgot").addEventListener("click", (e) => { e.preventDefault(); em.value = document.getElementById("email").value.trim(); say(""); login.hidden = true; box.hidden = false; em.focus(); });
  document.getElementById("forgotBack").addEventListener("click", (e) => { e.preventDefault(); box.hidden = true; login.hidden = false; });
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = em.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Enter a valid email address.", "bad");
    go.disabled = true; say("Checking…");
    const r = await sendResetLink(sb, email);
    if (!r.ok) { go.disabled = false; return say(r.error, "bad"); }
    say("If that email belongs to an active account, a reset link has been sent. Check your inbox and spam folder. The link works once.", "ok");
    setTimeout(() => { go.disabled = false; }, 60000);
  });
}

const safeName = (s) => (String(s || "").replace(/[^\w\- ]+/g, "").trim() || "attendance");

// Supabase returns at most 1000 rows per request, so read page by page.
async function fetchAllRows(sb, table, cols, order, asc) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).order(order, { ascending: asc !== false }).order("id").range(from, from + 999);
    if (error) return { data: out, error };
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return { data: out };
}
async function fetchAttendance(sb, ids) {
  let out = [];
  for (let i = 0; i < ids.length; i += 40) {
    let from = 0;
    for (;;) {
      const { data } = await sb.from("attendance").select("*").in("session_id", ids.slice(i, i + 40)).order("id").range(from, from + 999);
      const d = data || []; out = out.concat(d);
      if (d.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

const progLabel = (c) => (c.combined ? "Combined: " + (c.class_groups || []).map((g) => g.programme + " (" + g.level + ")").join("; ") : c.programme || "");
function buildSheets(classes, atts, absent) {
  const d = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const dev = {};
  for (const a of atts) if (a.device_id) (dev[a.session_id + "|" + a.device_id] = dev[a.session_id + "|" + a.device_id] || new Set()).add(String(a.index_number).toUpperCase());
  const shared = (a) => !!(a.device_id && dev[a.session_id + "|" + a.device_id].size > 1);
  const grp = (a, b) => String(a.programme || "").localeCompare(String(b.programme || "")) || String(a.level || "").localeCompare(String(b.level || ""));
  const sorted = [...atts].sort((a, b) => (byId[a.session_id].created_at < byId[b.session_id].created_at ? 1 : -1) || (byId[a.session_id].combined ? grp(a, b) : 0) || (a.checked_in_at > b.checked_in_at ? 1 : -1));
  const ci = [["Date", "Course", "Academic year", "Semester", "Programme", "Level", "Lecturer", "Name", "Index number", "Time", "Distance (m)", "In class area", "Shared phone", "Manual", "Late", "End check", "GPS warning"]];
  for (const a of sorted) {
    const c = byId[a.session_id];
    ci.push([d(c.created_at), c.course, c.academic_year || "", c.semester || "", a.programme || c.programme || "", a.level || (c.combined ? "" : c.level) || "", c._owner || "", a.student_name || "", a.index_number, t(a.checked_in_at), Math.round(a.distance_m || 0), a.in_range ? "Yes" : "No", shared(a) ? "Yes" : "No", a.manual ? "Yes" : "No", a.late ? "Yes" : "No", a.end_at ? t(a.end_at) : "", a.gps_flag || ""]);
  }
  const cl = [["Date", "Course", "Academic year", "Semester", "Programme", "Level", "Lecturer", "Checked in", "In class area", "Outside", "Code"]];
  for (const c of classes) {
    const r = atts.filter((a) => a.session_id === c.id), n = r.filter((a) => a.in_range).length;
    cl.push([d(c.created_at), c.course, c.academic_year || "", c.semester || "", progLabel(c), c.combined ? "Various" : c.level || "", c._owner || "", r.length, n, r.length - n, c.code]);
  }
  const st = {};
  for (const a of atts) {
    const k = String(a.index_number).toUpperCase();
    const s = (st[k] = st[k] || { name: a.student_name || "", prog: a.programme || "", level: a.level || "", seen: 0, ok: 0 });
    s.seen++; if (a.in_range) s.ok++;
  }
  const sm = [["Name", "Index number", "Programme", "Level", "Classes attended", "Total classes", "Attendance %"]];
  for (const [k, s] of Object.entries(st).sort((a, b) => a[0] < b[0] ? -1 : 1)) sm.push([s.name, k, s.prog, s.level, s.ok, classes.length, classes.length ? Math.round((s.ok / classes.length) * 100) : 0]);
  const out = [{ name: "Check-ins", rows: ci }, { name: "Students", rows: sm }, { name: "Classes", rows: cl }];
  if (absent && absent.length) out.push({ name: "Absent", rows: [["Name", "Index number", "Programme", "Level"]].concat(absent) });
  return out;
}

function downloadXlsx(name, sheets) {
  if (!window.XLSX) { alert("The Excel library did not load. Check your internet and try again."); return; }
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const sample = s.rows.slice(0, 200);
    ws["!cols"] = s.rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(10, ...sample.map((r) => String(r[i] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, safeName(name) + ".xlsx");
}

function drawQR(canvas, text, size) {
  if (!window.qrcode) return false;
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), m = 2, cell = Math.max(2, Math.floor(size / (n + 2 * m))), px = cell * (n + 2 * m);
  canvas.width = canvas.height = px;
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, px, px); c.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + m) * cell, (r + m) * cell, cell, cell);
  return true;
}

function countUp(el, to) {
  if (reduceMotion || to < 2) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / 700); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function confetti() {
  if (reduceMotion) return;
  const colors = ["#1f9d55", "#004c84", "#f5a623", "#e94f64", "#6c5ce7"];
  const box = document.createElement("div"); box.className = "confetti"; document.body.appendChild(box);
  for (let i = 0; i < 44; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%"; p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + "s"; p.style.animationDuration = 1.6 + Math.random() * 1.2 + "s";
    p.style.transform = "rotate(" + Math.random() * 360 + "deg)"; box.appendChild(p);
  }
  setTimeout(() => box.remove(), 3500);
}

// Show/hide button on every password box.
const EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.8 10.8 0 0 1 12 19C5.5 19 1.5 12 1.5 12a19 19 0 0 1 4.6-5.4M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10.5 7 10.5 7a19 19 0 0 1-2.2 3.2M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function addPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach((inp) => {
    if (inp.dataset.pw) return;
    inp.dataset.pw = "1";
    const wrap = document.createElement("div"); wrap.className = "pwwrap";
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const b = document.createElement("button"); b.type = "button"; b.className = "pweye";
    b.setAttribute("aria-label", "Show password"); b.setAttribute("aria-pressed", "false"); b.innerHTML = EYE;
    b.addEventListener("click", () => {
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      b.innerHTML = show ? EYE_OFF : EYE; inp.focus();
    });
    wrap.appendChild(b);
  });
}
addPasswordToggles();


// ---- Toasts ----
function toast(msg, opt) {
  opt = opt || {};
  let box = document.getElementById("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const t = document.createElement("div"); t.className = "toast";
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  if (opt.action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = opt.action;
    b.addEventListener("click", () => { t.remove(); if (opt.onAction) opt.onAction(); }); t.appendChild(b);
  }
  box.appendChild(t); setTimeout(() => t.remove(), opt.ms || 6500);
}

// ---- Display options: larger text and high contrast (remembered on this device) ----
function addDisplayOptions() {
  const get = (k) => { try { return localStorage.getItem("ktu_" + k) === "1"; } catch (e) { return false; } };
  const set = (k, v) => { try { localStorage.setItem("ktu_" + k, v ? "1" : "0"); } catch (e) {} };
  const apply = () => { document.documentElement.classList.toggle("big", get("big")); document.documentElement.classList.toggle("hc", get("hc")); for (const k of ["calm", "roomy", "easy"]) document.documentElement.classList.toggle(k, get(k)); };
  apply();
  const getTheme = () => { try { return localStorage.getItem("ktu_theme") || "auto"; } catch (e) { return "auto"; } };
  const applyTheme = (t) => { if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); };
  applyTheme(getTheme());
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "a11y"; btn.textContent = "Aa";
  btn.setAttribute("aria-label", "Display options"); btn.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div"); menu.className = "a11ymenu"; menu.hidden = true;
  for (const [label, key] of [["Larger text", "big"], ["High contrast", "hc"], ["Easy-read font", "easy"], ["More spacing", "roomy"], ["Reduce motion", "calm"]]) {
    const l = document.createElement("label"); const c = document.createElement("input"); c.type = "checkbox"; c.checked = get(key);
    c.addEventListener("change", () => { set(key, c.checked); apply(); }); l.append(c, " " + label); menu.appendChild(l);
  }
  const tl = document.createElement("label"), ts = document.createElement("select"); ts.setAttribute("aria-label", "Theme");
  for (const [v, t] of [["auto", "Match my phone"], ["light", "Light"], ["dark", "Dark"]]) { const o = document.createElement("option"); o.value = v; o.textContent = t; ts.appendChild(o); }
  ts.value = getTheme(); ts.addEventListener("change", () => { try { localStorage.setItem("ktu_theme", ts.value); } catch (e) {} applyTheme(ts.value); });
  tl.append("Theme ", ts); menu.appendChild(tl);
  const rb = document.createElement("button"); rb.type = "button"; rb.className = "rptbtn"; rb.textContent = "Report a problem";
  rb.addEventListener("click", () => { menu.hidden = true; openReport(); }); menu.appendChild(rb);
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  document.body.append(btn, menu);
}
addDisplayOptions();


// ---- Report a problem (works for students too) ----
const _errs = [];
window.addEventListener("error", (e) => { _errs.push((e.message || "error") + " (" + String(e.filename || "").split("/").pop() + ":" + e.lineno + ")"); if (_errs.length > 5) _errs.shift(); });
window.addEventListener("unhandledrejection", (e) => { _errs.push("promise: " + ((e.reason && e.reason.message) || e.reason)); if (_errs.length > 5) _errs.shift(); });
function openReport() {
  if (document.getElementById("rpt")) return;
  const box = document.createElement("div"); box.id = "rpt"; box.className = "rpt";
  box.innerHTML = '<div class="rptc" role="dialog" aria-modal="true" aria-label="Report a problem"><h3>Report a problem</h3><p class="note">Tell us what went wrong. The page and your phone type are sent with it. Please do not include passwords.</p><label for="rptMsg">What happened?</label><textarea id="rptMsg" rows="4" maxlength="1000"></textarea><label for="rptContact">Your phone number or email (optional)</label><input id="rptContact" maxlength="100"><div class="row"><button id="rptSend" class="btn" type="button">Send report</button><button id="rptCancel" class="btn quiet" type="button">Cancel</button></div><p id="rptOut" class="msg" aria-live="polite"></p></div>';
  document.body.appendChild(box);
  const out = (t, k) => { document.getElementById("rptOut").textContent = t; document.getElementById("rptOut").className = "msg " + (k || ""); };
  document.getElementById("rptCancel").addEventListener("click", () => box.remove());
  document.getElementById("rptSend").addEventListener("click", async () => {
    const msg = document.getElementById("rptMsg").value.trim();
    if (msg.length < 3) return out("Please describe the problem.", "warn");
    if (typeof sb === "undefined") return out("Could not send from this page.", "bad");
    const details = navigator.userAgent + " | screen " + screen.width + "x" + screen.height + " | " + new Date().toISOString() + " | errors: " + (_errs.join(" ; ") || "none");
    document.getElementById("rptSend").disabled = true; out("Sending...");
    const { data, error } = await sb.rpc("report_problem", { p_page: location.pathname, p_message: msg, p_contact: document.getElementById("rptContact").value.trim() || null, p_details: details });
    document.getElementById("rptSend").disabled = false;
    if (error || !data) return out("Could not send. Check your internet and try again.", "bad");
    if (!data.ok) return out(data.error, "bad");
    box.remove(); toast("Thank you. Your report was sent.");
  });
  document.getElementById("rptMsg").focus();
}

// ---- Printable attendance sheet (use the browser's Save as PDF) ----
function openAttendanceSheet(c, atts, roll, lecturer) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = new Date(c.created_at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const present = [...atts].sort((a, b) => (c.combined ? String(a.programme || "").localeCompare(String(b.programme || "")) || String(a.level || "").localeCompare(String(b.level || "")) : 0) || ((a.student_name || a.index_number) < (b.student_name || b.index_number) ? -1 : 1));
  const here = new Set(present.map((a) => String(a.index_number).toUpperCase()));
  const absent = (roll || []).filter((r) => !here.has(r.index_number));
  const rows = present.map((a) => [a.student_name || "", a.index_number, a.programme || "", a.level || "", t(a.checked_in_at), a.late ? "Late" : a.in_range ? "Present" : "Present (outside area)"])
    .concat(absent.map((r) => [r.student_name || "", r.index_number, r.programme || c.programme || "", r.level || "", "", "Absent"]));
  const body = rows.map((r, i) => "<tr><td>" + (i + 1) + "</td>" + r.map((x) => "<td>" + esc(x) + "</td>").join("") + '<td class="sig"></td></tr>').join("");
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Attendance sheet</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;margin:0}h1{font-size:19px;margin:0}h2{font-size:14px;margin:2px 0 10px;font-weight:normal}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;margin:10px 0 12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:6px 7px;text-align:left;vertical-align:middle}th{background:#e8e8e8}td.sig{width:120px;height:26px}.foot{display:flex;justify-content:space-between;margin-top:34px;gap:30px}.foot div{flex:1;border-top:1px solid #000;padding-top:4px}.noprint{margin:0 0 14px;padding:10px;background:#fff8d6;border:1px solid #e0c200}@media print{.noprint{display:none}}</style></head><body>'
    + '<div class="noprint">Choose <b>Save as PDF</b> as the printer to keep a PDF copy. <button onclick="window.print()">Print</button></div>'
    + "<h1>Koforidua Technical University</h1><h2>Class attendance sheet</h2>"
    + '<div class="meta"><div><b>Course:</b> ' + esc(c.course) + "</div><div><b>Date:</b> " + esc(day) + "</div><div><b>Programme and level:</b> " + esc(progLabel(c)) + (c.combined ? "" : " " + esc(c.level || "")) + "</div><div><b>Term:</b> " + esc([c.academic_year, c.semester].filter(Boolean).join(", ")) + "</div><div><b>Lecturer:</b> " + esc(lecturer || "") + "</div><div><b>Present:</b> " + present.length + (absent.length ? " | <b>Absent (from roll):</b> " + absent.length : "") + "</div>" + (c.notes ? "<div style='grid-column:1/3'><b>Notes:</b> " + esc(c.notes) + "</div>" : "") + "</div>"
    + "<table><thead><tr><th>No.</th><th>Name</th><th>Index number</th><th>Programme</th><th>Level</th><th>Time in</th><th>Status</th><th>Signature</th></tr></thead><tbody>" + body + "</tbody></table>"
    + '<div class="foot"><div>Lecturer signature</div><div>Date</div></div>'
    + '<p style="color:#555;margin-top:14px">Printed ' + esc(new Date().toLocaleString()) + "</p>"
    + "<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>";
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups for this site, then try again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}


// ---- Programme and level lists: built in, plus what the admin adds or hides ----
let _baseP = null, catalogNow = { programmes: [], levels: [] };
const _baseL = ROLL_LEVELS.slice(), catalogHooks = [];
function onCatalog(fn) { catalogHooks.push(fn); }
function catalogBase() {
  if (!_baseP) _baseP = (typeof PROGRAMMES !== "undefined" && Array.isArray(PROGRAMMES)) ? JSON.parse(JSON.stringify(PROGRAMMES)) : [];
  return { groups: _baseP, programmes: _baseP.flatMap((g) => g.items || []), levels: _baseL };
}
function applyCatalog(cat) {
  catalogNow = { programmes: (cat && cat.programmes) || [], levels: (cat && cat.levels) || [] };
  const base = catalogBase(), lc = (x) => String(x).toLowerCase();
  const hideP = new Set(catalogNow.programmes.filter((x) => x.removed).map((x) => lc(x.name)));
  const hideL = new Set(catalogNow.levels.filter((x) => x.removed).map((x) => lc(x.name)));
  const out = base.groups.map((g) => ({ group: g.group, items: (g.items || []).filter((n) => !hideP.has(lc(n))) }));
  for (const x of catalogNow.programmes.filter((y) => !y.removed)) {
    const gn = x.grp || "Added by the admin"; let g = out.find((y) => y.group === gn);
    if (!g) { g = { group: gn, items: [] }; out.push(g); }
    if (!out.some((y) => y.items.some((n) => lc(n) === lc(x.name)))) g.items.push(x.name);
  }
  if (typeof PROGRAMMES !== "undefined") PROGRAMMES.splice(0, PROGRAMMES.length, ...out.filter((g) => g.items.length));
  const lv = base.levels.filter((n) => !hideL.has(lc(n))).concat(catalogNow.levels.filter((x) => !x.removed && !base.levels.some((b) => lc(b) === lc(x.name))).map((x) => x.name));
  ROLL_LEVELS.splice(0, ROLL_LEVELS.length, ...lv);
  for (const fn of catalogHooks) { try { fn(); } catch (e) { console.warn(e); } }
}
async function loadCatalog(sb) {
  try { const c = localStorage.getItem("ktu_catalog"); if (c) applyCatalog(JSON.parse(c)); } catch (e) {}
  try { const { data } = await sb.rpc("get_catalog"); if (data) { applyCatalog(data); try { localStorage.setItem("ktu_catalog", JSON.stringify(data)); } catch (e) {} } } catch (e) {}
}
// Refill a dropdown but keep the first (placeholder) option and whatever is selected.
function refillSelect(sel, fill) {
  const v = sel.value, ph = sel.options.length && sel.options[0].value === "" ? sel.options[0] : null;
  sel.textContent = ""; if (ph) sel.appendChild(ph);
  fill(sel);
  if (v && !Array.from(sel.options).some((o) => o.value === v)) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
  sel.value = v;
}
function fillLevels(sel, withAll) {
  for (const n of (withAll ? ["All levels"] : []).concat(ROLL_LEVELS)) { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); }
}

// ---- Course attendance sheet for one programme and level: every class of the course in one grid ----
function classMatchesGroup(c, prog, lvl) {
  const eq = (a) => !prog || sameText(a, prog);
  const lk = (x) => !lvl || String(x || "").trim().toLowerCase() === "all levels" || levelKey(x) === levelKey(lvl);
  return c.combined ? (c.class_groups || []).some((g) => eq(g.programme) && lk(g.level)) : eq(c.programme) && (!lvl || levelKey(c.level) === levelKey(lvl));
}
function studentMatches(x, prog, lvl, lenient) {
  return (!prog || sameText(x.programme, prog)) && (!lvl || (lenient && !String(x.level || "").trim()) || levelKey(x.level) === levelKey(lvl));
}
function openCourseSheet(o) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const classes = [...o.classes].sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  if (!classes.length) { toast("No classes found for that course, programme and level yet."); return; }
  const people = new Map();
  for (const r of o.roll || []) if (studentMatches(r, o.programme, o.level, true)) people.set(String(r.index_number).toUpperCase(), { name: r.student_name || "" });
  const rec = new Map(), ids = new Set(classes.map((c) => c.id));
  for (const a of o.atts || []) {
    if (!ids.has(a.session_id) || !studentMatches(a, o.programme, o.level, false)) continue;
    const k = String(a.index_number).toUpperCase();
    if (!people.has(k)) people.set(k, { name: a.student_name || "" }); else if (!people.get(k).name) people.get(k).name = a.student_name || "";
    rec.set(a.session_id + "|" + k, a);
  }
  const list = Array.from(people, ([k, v]) => ({ k, name: v.name })).sort((a, b) => (a.name || a.k).localeCompare(b.name || b.k));
  const dt = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
  const head = classes.map((c) => "<th class='d'>" + esc(dt(c.created_at)) + "</th>").join("");
  const body = list.map((p, i) => {
    let n = 0;
    const cells = classes.map((c) => { const a = rec.get(c.id + "|" + p.k); if (a && a.in_range) { n++; return "<td class='c'>&#10003;</td>"; } return a ? "<td class='c'>O</td>" : "<td class='c'></td>"; }).join("");
    return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.name) + "</td><td>" + esc(p.k) + "</td>" + cells + "<td class='c'>" + n + "</td><td class='c'>" + Math.round((n / classes.length) * 100) + "%</td></tr>";
  }).join("");
  const term = [...new Set(classes.map((c) => [c.academic_year, c.semester].filter(Boolean).join(" ")).filter(Boolean))].join("; ");
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Course attendance sheet</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;margin:0}h1{font-size:18px;margin:0}h2{font-size:13px;margin:2px 0 8px;font-weight:normal}.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 20px;margin:8px 0 10px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:3px 5px;text-align:left}th{background:#e8e8e8}th.d{font-size:9px;text-align:center;padding:3px 2px}td.c{text-align:center}.noprint{margin:0 0 12px;padding:10px;background:#fff8d6;border:1px solid #e0c200}@media print{.noprint{display:none}}</style></head><body>'
    + '<div class="noprint">Choose <b>Save as PDF</b> as the printer to keep a PDF copy. <button onclick="window.print()">Print</button></div>'
    + "<h1>Koforidua Technical University</h1><h2>Course attendance sheet</h2>"
    + '<div class="meta"><div><b>Course:</b> ' + esc(o.course) + "</div><div><b>Programme:</b> " + esc(o.programme || "All") + "</div><div><b>Level:</b> " + esc(o.level || "All") + "</div><div><b>Lecturer:</b> " + esc(o.lecturer || "") + "</div><div><b>Classes held:</b> " + classes.length + "</div><div><b>Term:</b> " + esc(term) + "</div></div>"
    + "<table><thead><tr><th>No.</th><th>Name</th><th>Index number</th>" + head + "<th>Total</th><th>Rate</th></tr></thead><tbody>" + body + "</tbody></table>"
    + '<p style="margin-top:8px;color:#333">&#10003; = present in the class area. O = checked in outside the class area. Blank = absent.</p>'
    + '<p style="color:#555">Printed ' + esc(new Date().toLocaleString()) + "</p>"
    + "<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>";
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups for this site, then try again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ---- Copy to clipboard (with a fallback for older phones) ----
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;opacity:0;top:0";
      document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok;
    } catch (e2) { return false; }
  }
}


// ---- Student lookup: one student's attendance across classes (lecturer: own classes, admin: all) ----
// allClasses is the list of classes the viewer can see. Returns null when the student has no check-ins.
async function lookupStudent(sb, idx, allClasses) {
  idx = String(idx || "").trim().toUpperCase();
  const { data, error } = await sb.from("attendance").select("*").eq("index_number", idx).order("checked_in_at", { ascending: false }).limit(1000);
  if (error) throw error;
  const byId = new Map(allClasses.map((c) => [c.id, c]));
  const rows = (data || []).filter((a) => byId.has(a.session_id)).map((a) => Object.assign({ _c: byId.get(a.session_id) }, a));
  if (!rows.length) return null;
  const last = rows[0], per = new Map();
  for (const a of rows) { const k = (a._c.owner || "") + "\u0001" + a._c.course; const e = per.get(k) || { course: a._c.course, owner: a._c.owner, attended: 0 }; e.attended++; per.set(k, e); }
  for (const e of per.values()) {
    e.held = allClasses.filter((c) => c.course === e.course && (c.owner || "") === (e.owner || "") && classMatchesGroup(c, last.programme, last.level)).length;
    e.held = Math.max(e.held, e.attended); e.pct = Math.round((e.attended / e.held) * 100);
  }
  return { index: idx, name: (rows.find((a) => a.student_name) || {}).student_name || "", programme: last.programme, level: last.level, rows, courses: Array.from(per.values()).sort((a, b) => a.pct - b.pct) };
}
function renderLookup(box, res, ownerName, idx) {
  box.textContent = "";
  const mk = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  if (!res) { box.appendChild(mk("p", "note", "No check-ins found for " + idx + ". Check the number, or the student may not have come to any of these classes.")); return; }
  const head = mk("div", "lkhead"); head.append(mk("b", "", res.name || res.index), mk("span", "", res.index + (res.programme ? "  |  " + res.programme : "") + (res.level ? "  |  " + res.level : ""))); box.appendChild(head);
  const tbl = (cols, rows) => {
    const w = mk("div", "table-wrap"), t = mk("table"), th = mk("thead"), tr = mk("tr"), tb = mk("tbody");
    for (const c of cols) tr.appendChild(mk("th", "", c)); th.appendChild(tr);
    for (const r of rows) { const x = mk("tr"); for (const v of r) { const td = mk("td"); if (v instanceof Node) td.appendChild(v); else td.textContent = v; x.appendChild(td); } tb.appendChild(x); }
    t.append(th, tb); w.appendChild(t); return w;
  };
  box.appendChild(mk("h4", "ch3", "By course"));
  box.appendChild(tbl(ownerName ? ["Course", "Lecturer", "Attended", "Rate"] : ["Course", "Attended", "Rate"], res.courses.map((e) => {
    const pill = mk("span", "kindtag" + (e.pct < 75 ? " acct" : ""), e.pct + "%"); const att = e.attended + " of " + e.held;
    return ownerName ? [e.course, ownerName(e.owner), att, pill] : [e.course, att, pill];
  })));
  box.appendChild(mk("h4", "ch3", "Every check-in"));
  const day = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  box.appendChild(tbl(["When", "Course", "Result", "Notes"], res.rows.map((a) => [day(a.checked_in_at), a._c.course, a.in_range ? "In class area" : "Outside area", [a.late ? "Late" : "", a.manual ? "Added by lecturer" : "", a.gps_flag || ""].filter(Boolean).join(", ")])));
  const x = mk("button", "btn quiet", "Download (Excel)"); x.type = "button"; x.style.marginTop = "10px";
  x.addEventListener("click", () => downloadXlsx("Attendance " + res.index, [
    { name: "By course", rows: [["Course", "Lecturer", "Attended", "Classes held", "Rate %"]].concat(res.courses.map((e) => [e.course, ownerName ? ownerName(e.owner) : "", e.attended, e.held, e.pct])) },
    { name: "Check-ins", rows: [["When", "Course", "Result", "Late", "Added by lecturer", "Warning"]].concat(res.rows.map((a) => [day(a.checked_in_at), a._c.course, a.in_range ? "In class area" : "Outside area", a.late ? "Yes" : "", a.manual ? "Yes" : "", a.gps_flag || ""])) }]));
  box.appendChild(x);
}

// ---- Announcements from the admin (shown on the lecturer Home tab) ----
async function showAnnouncements(sb, box) {
  box.textContent = "";
  let data = null; try { ({ data } = await sb.from("announcements").select("*").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(5)); } catch (e) {}
  let seen = []; try { seen = JSON.parse(localStorage.getItem("ktu_seen_ann") || "[]"); } catch (e) {}
  for (const a of data || []) {
    if (seen.includes(a.id)) continue;
    const d = document.createElement("div"); d.className = "announce " + a.kind; d.setAttribute("role", "status");
    const t = document.createElement("div"); const b = document.createElement("b"); b.textContent = a.target ? "Private message from the admin" : a.kind === "warn" ? "Important notice" : "Notice from the admin"; const p = document.createElement("span"); p.textContent = a.message; t.append(b, p);
    const x = document.createElement("button"); x.type = "button"; x.className = "abtn"; x.textContent = "Dismiss";
    x.addEventListener("click", () => { seen.push(a.id); try { localStorage.setItem("ktu_seen_ann", JSON.stringify(seen.slice(-30))); } catch (e) {} d.remove(); });
    d.append(t, x); box.appendChild(d);
  }
}


// ---- Accessibility helpers: skip link, dialogs (Escape, focus kept inside), arrow keys in tab bars ----
(function a11yHelpers() {
  const main = document.querySelector("main"); if (main) { main.id = main.id || "main"; main.setAttribute("tabindex", "-1"); }
  if (main && !document.querySelector(".skip")) { const a = document.createElement("a"); a.className = "skip"; a.href = "#" + main.id; a.textContent = "Skip to main content"; a.addEventListener("click", (e) => { e.preventDefault(); main.focus(); }); document.body.prepend(a); }
  const FOC = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  let lastFocus = null;
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1 || !n.classList.contains("rpt")) continue;
      const c = n.querySelector(".rptc"); if (c) { c.setAttribute("role", "dialog"); c.setAttribute("aria-modal", "true"); const h = c.querySelector("h2,h3"); if (h) { h.id = h.id || "dlg" + Date.now(); c.setAttribute("aria-labelledby", h.id); } }
      lastFocus = document.activeElement; setTimeout(() => { const f = n.querySelector("input,textarea,select,button"); if (f) f.focus(); }, 30);
    }
    for (const m of muts) for (const n of m.removedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains("rpt") && lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) {} lastFocus = null; }
  }).observe(document.body, { childList: true });
  document.addEventListener("keydown", (e) => {
    const dlg = document.querySelector(".rpt:last-of-type") || document.querySelector(".rpt");
    if (dlg && e.key === "Escape") { e.preventDefault(); dlg.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
    if (dlg && e.key === "Tab") { const f = Array.from(dlg.querySelectorAll(FOC)).filter((x) => x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    const bar = e.target.closest && e.target.closest(".ttabs,.tabs"); if (!bar || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const items = Array.from(bar.querySelectorAll("button,a.btn")).filter((x) => x.offsetParent !== null), i = items.indexOf(e.target); if (i < 0) return;
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    e.preventDefault(); items[next].focus();
  });
})();
