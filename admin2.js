// Update 45: Insights, quick controls, defaults, messages, health, backups, bulk venues, phone navigation.
// Runs after admin.js and uses its shared variables (people, classes, attRows, abtn, el, $, say, fmt).
const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAYN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? (p.full_name || p.email || "-") : "-"; };

function bars(items, fmtv) {
  const max = Math.max(1, ...items.map((i) => i.v));
  if (!items.length) return '<p class="note">Nothing to show yet.</p>';
  return '<div class="hbars">' + items.map((i) => '<div class="hb"><span class="hl2" title="' + esc2(i.l) + '">' + esc2(i.l) + '</span><div class="ht"><i style="width:' + Math.max(3, Math.round(i.v / max * 100)) + '%"></i></div><b>' + (fmtv ? fmtv(i.v) : i.v) + "</b></div>").join("") + "</div>";
}
function colChart(vals, labels, h) {
  const max = Math.max(1, ...vals), w = 100 / vals.length;
  let s = '<svg class="col" viewBox="0 0 100 ' + h + '" preserveAspectRatio="none" role="img" aria-label="Bar chart">';
  vals.forEach((v, i) => { const bh = v / max * (h - 4); s += '<rect x="' + (i * w + w * 0.15) + '" y="' + (h - bh) + '" width="' + w * 0.7 + '" height="' + bh + '" rx="0.8"><title>' + esc2(labels[i]) + ": " + v + "</title></rect>"; });
  return s + "</svg>";
}

function drawInsights() {
  const now = Date.now(), H = 3600e3, D = 24 * H;
  const cls = Object.fromEntries(classes.map((c) => [c.id, c]));
  const rows = attRows.map((a) => ({ t: new Date(a.checked_in_at), s: a.session_id, ok: a.in_range !== false }));
  const total = rows.length, outside = rows.filter((r) => !r.ok).length;
  const closed = classes.filter((c) => new Date(c.closes_at) < now), empty = closed.filter((c) => !(c._n > 0));
  const lec30 = new Set(classes.filter((c) => now - new Date(c.created_at) < 30 * D).map((c) => c.owner));
  const withN = classes.filter((c) => c._n > 0), avg = withN.length ? withN.reduce((n, c) => n + c._n, 0) / withN.length : 0;
  $("insKpi").innerHTML = [[total, "Check-ins"], [classes.length, "Classes"], [avg.toFixed(1), "Avg per class"], [total ? Math.round(outside / total * 100) + "%" : "0%", "Outside area"], [closed.length ? Math.round(empty.length / closed.length * 100) + "%" : "0%", "Empty classes"], [lec30.size, "Lecturers active (30d)"]].map(([n, l]) => "<div><b>" + n + "</b>" + l + "</div>").join("");
  // pulse
  const hr = rows.filter((r) => now - r.t < H).length, d1 = rows.filter((r) => now - r.t < D).length, d7 = rows.filter((r) => now - r.t < 7 * D).length;
  const live = classes.filter((c) => new Date(c.opens_at) <= now && new Date(c.closes_at) > now && !c.archived).length;
  const hourly = Array.from({ length: 24 }, (_, i) => rows.filter((r) => { const a = now - r.t; return a >= (23 - i) * H && a < (24 - i) * H; }).length);
  $("insPulse").innerHTML = '<div class="pulse"><div><b>' + live + "</b>open now</div><div><b>" + hr + "</b>last hour</div><div><b>" + d1 + "</b>24 hours</div><div><b>" + d7 + "</b>7 days</div></div>" + colChart(hourly, hourly.map((_, i) => (23 - i) + "h ago"), 30) + '<p class="note">Hourly check-ins, last 24 hours</p>';
  // donut
  const pct = total ? Math.round((total - outside) / total * 100) : 0;
  $("insDonut").innerHTML = '<div class="donut" style="--p:' + pct + '"><b>' + pct + '%</b></div><p class="note">' + (total - outside) + " inside, " + outside + " outside the class area.</p>";
  // trend 30d
  const day = Array.from({ length: 30 }, () => 0), dl = [];
  for (let i = 0; i < 30; i++) dl.push(new Date(now - (29 - i) * D).toLocaleDateString([], { day: "numeric", month: "short" }));
  for (const r of rows) { const a = Math.floor((now - r.t) / D); if (a >= 0 && a < 30) day[29 - a]++; }
  $("insTrend").innerHTML = colChart(day, dl, 40) + '<div class="axis"><span>' + dl[0] + "</span><span>" + dl[29] + "</span></div>";
  // heatmap
  const hm = Array.from({ length: 7 }, () => Array(24).fill(0)); let hmax = 1;
  for (const r of rows) { const wd = (r.t.getDay() + 6) % 7, h = r.t.getHours(); hm[wd][h]++; hmax = Math.max(hmax, hm[wd][h]); }
  let g = '<div class="heat"><span></span>' + Array.from({ length: 24 }, (_, h) => '<i class="hh">' + (h % 3 === 0 ? h : "") + "</i>").join("");
  hm.forEach((r, d) => { g += '<span class="hd">' + DAYN[d] + "</span>" + r.map((v, h) => '<i class="hc" style="--a:' + (v / hmax).toFixed(2) + '" title="' + DAYN[d] + " " + h + ":00 - " + v + ' check-ins"></i>').join(""); });
  $("insHeat").innerHTML = g + "</div>";
  // leaders
  const r30 = rows.filter((r) => now - r.t < 30 * D), byL = {}, byC = {};
  for (const r of r30) { const c = cls[r.s]; if (!c) continue; byL[c.owner] = (byL[c.owner] || 0) + 1; byC[c.course] = (byC[c.course] || 0) + 1; }
  $("insLect").innerHTML = bars(Object.entries(byL).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ l: nameOf(k), v })));
  $("insCourse").innerHTML = bars(Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ l: k, v })));
  // histogram
  const B = [["0", 0, 0], ["1-9", 1, 9], ["10-19", 10, 19], ["20-39", 20, 39], ["40-79", 40, 79], ["80+", 80, 1e9]];
  $("insHist").innerHTML = bars(B.map(([l, a, b]) => ({ l: l + " students", v: classes.filter((c) => (c._n || 0) >= a && (c._n || 0) <= b).length })), (v) => v + " classes");
  // completeness
  const noName = people.filter((p) => !String(p.full_name || "").trim()), idle = people.filter((p) => p.role !== "admin" && !classes.some((c) => c.owner === p.id)), off = people.filter((p) => p.active === false);
  const chip = (n, l, cls2) => '<div class="chip2 ' + (n ? cls2 : "good") + '"><b>' + n + "</b>" + l + "</div>";
  $("insComplete").innerHTML = '<div class="chips">' + chip(noName.length, "accounts without a name", "warn") + chip(idle.length, "never started a class", "warn") + chip(off.length, "switched off", "warn") + chip(people.filter((p) => p.role === "assistant").length, "assistants", "good") + "</div>";
  // odd hours
  const odd = classes.filter((c) => now - new Date(c.created_at) < 30 * D).filter((c) => { const h = new Date(c.created_at).getHours(); return h >= 22 || h < 5; }).slice(0, 12);
  $("insOdd").innerHTML = odd.length ? "<ul class='oddl'>" + odd.map((c) => "<li><b>" + esc2(c.course) + "</b> <span>" + esc2(nameOf(c.owner)) + "</span><small>" + esc2(fmt(c.created_at)) + "</small></li>").join("") + "</ul>" : '<p class="note">None. Every class was started between 05:00 and 22:00.</p>';
}
window.drawInsights = drawInsights;
$("insRefresh").addEventListener("click", async () => { $("insRefresh").disabled = true; await load(); drawInsights(); $("insRefresh").disabled = false; });

// ---- Tools: quick controls ----
const q45 = (m, k) => say("u45QMsg", m, k);
async function rpc45(fn, args, msgId, okText) {
  const r = await sb.rpc(fn, args || {});
  if (r.error) { say(msgId, /function|exist|schema cache/i.test(r.error.message) ? "Run upgrade41.sql in Supabase first." : r.error.message, "bad"); return null; }
  if (r.data && r.data.ok === false) { say(msgId, r.data.error, "bad"); return null; }
  if (okText) say(msgId, typeof okText === "function" ? okText(r.data) : okText, "ok");
  return r;
}
$("u45Close").addEventListener("click", async () => {
  if (!confirm("Close EVERY class that is open right now? Students will not be able to check in to them.")) return;
  const r = await rpc45("admin_close_all_open", {}, "u45QMsg", (n) => n + " open class(es) closed."); if (r) load();
});
$("u45ExtBtn").addEventListener("click", async () => {
  const m = Number($("u45Ext").value); if (!confirm("Give every open class " + m + " more minutes?")) return;
  const r = await rpc45("admin_extend_all_open", { p_minutes: m }, "u45QMsg", (n) => n + " open class(es) extended by " + m + " minutes."); if (r) load();
});
$("u45OldBtn").addEventListener("click", async () => {
  const d = Number($("u45Old").value), c = await rpc45("admin_archive_old", { p_days: d, p_dry: true }, "u45QMsg"); if (!c) return;
  if (!c.data) return q45("No classes are older than " + d + " days.", "ok");
  if (!confirm(c.data + " finished class(es) older than " + d + " days will be archived. Archived classes stay safe and can still be seen in the term report. Continue?")) return;
  const r = await rpc45("admin_archive_old", { p_days: d }, "u45QMsg", (n) => n + " class(es) archived."); if (r) load();
});

// ---- Defaults and messages ----
async function loadU45() {
  const { data } = await sb.rpc("get_public_settings"); if (!data) return;
  if (data.defaults) { $("u45DefMin").value = data.defaults.minutes; $("u45DefRad").value = data.defaults.radius; }
  if (data.texts) { $("u45Welcome").value = data.texts.welcome || ""; $("u45Notice").value = data.texts.student || ""; }
}
window.loadU45 = loadU45;
$("u45DefBtn").addEventListener("click", () => rpc45("admin_set_defaults", { p_minutes: Number($("u45DefMin").value) || 0, p_radius: Number($("u45DefRad").value) || 0 }, "u45DefMsg", "Saved. New classes start with these values."));
$("u45TxtBtn").addEventListener("click", async () => {
  const a = await rpc45("admin_set_text", { p_key: "welcome_msg", p_value: $("u45Welcome").value }, "u45TxtMsg"); if (!a) return;
  rpc45("admin_set_text", { p_key: "student_notice", p_value: $("u45Notice").value }, "u45TxtMsg", "Saved. People see the new messages the next time they open the page.");
});

// ---- Health ----
$("u45HealthBtn").addEventListener("click", async () => {
  const r = await sb.rpc("admin_health"); const box = $("u45Health");
  if (r.error) { box.textContent = /function|exist/i.test(r.error.message) ? "Run upgrade41.sql in Supabase first." : r.error.message; return; }
  const h = r.data, ago = h.last_checkin ? Math.round((Date.now() - new Date(h.last_checkin)) / 3600e3) : null, warn = [];
  if (h.no_name) warn.push(h.no_name + " account(s) have no name");
  if (h.db_mb > 400) warn.push("Database is " + h.db_mb + " MB. The free plan holds 500 MB. Export and archive old data.");
  if (ago !== null && ago > 24 * 14) warn.push("No check-in for " + Math.round(ago / 24) + " days");
  const cell = (n, l) => "<div><b>" + n + "</b>" + l + "</div>";
  box.innerHTML = '<div class="stats">' + cell(h.db_mb + " MB", "Database") + cell(h.staff, "Staff") + cell(h.classes, "Classes") + cell(h.open_now, "Open now") + cell(h.attendance, "Check-ins") + cell(h.today, "Today") + cell(h.trash, "In Trash") + cell(h.blocked, "Blocked") + "</div>" +
    "<p class='note'>Last check-in: " + (h.last_checkin ? esc2(fmt(h.last_checkin)) : "none") + ". Activity log entries: " + h.audit + ".</p>" +
    (warn.length ? '<ul class="warnl">' + warn.map((w) => "<li>" + esc2(w) + "</li>").join("") + "</ul>" : '<p class="msg ok">Everything looks healthy.</p>');
});

// ---- Downloads ----
const ex = (m, k) => say("u45ExMsg", m, k);
$("u45ExStaff").addEventListener("click", () => {
  downloadXlsx("KTU-staff-" + new Date().toISOString().slice(0, 10) + "", [{ name: "Staff", rows: [["Name", "Email", "Role", "Active", "Classes"], ...people.map((p) => [p.full_name || "", p.email || "", p.role, p.active === false ? "No" : "Yes", p._classes || 0])] }]); ex("Staff list downloaded.", "ok");
});
$("u45ExBlocked").addEventListener("click", async () => {
  const r = await sb.rpc("admin_list_blocked"); if (r.error) return ex(r.error.message, "bad");
  const d = r.data || []; if (!d.length) return ex("Nothing is blocked right now.", "ok");
  const cols = Object.keys(d[0]); downloadXlsx("KTU-blocked", [{ name: "Blocked", rows: [cols, ...d.map((x) => cols.map((c) => x[c]))] }]); ex(d.length + " blocked entries downloaded.", "ok");
});
$("u45ExAct").addEventListener("click", async () => {
  ex("Loading…"); const r = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(5000); if (r.error) return ex(r.error.message, "bad");
  const d = r.data || [], cols = d.length ? Object.keys(d[0]) : ["at", "action"]; downloadXlsx("KTU-activity", [{ name: "Activity", rows: [cols, ...d.map((x) => cols.map((c) => (x[c] && typeof x[c] === "object" ? JSON.stringify(x[c]) : x[c])))] }]); ex(d.length + " log entries downloaded.", "ok");
});
$("u45ExAll").addEventListener("click", () => {
  const sheets = [
    { name: "Staff", rows: [["Name", "Email", "Role", "Active"], ...people.map((p) => [p.full_name || "", p.email || "", p.role, p.active === false ? "No" : "Yes"])] },
    { name: "Classes", rows: [["Course", "Lecturer", "Started", "Closes", "Check-ins", "Archived"], ...classes.map((c) => [c.course, c._owner || "", fmt(c.created_at), fmt(c.closes_at), c._n || 0, c.archived ? "Yes" : "No"])] },
    { name: "Courses", rows: [["Lecturer", "Course"], ...courses.map((k) => [nameOf(k.owner), k.name])] }];
  downloadXlsx("KTU-full-backup-" + new Date().toISOString().slice(0, 10), sheets); ex("Backup downloaded (staff, classes, courses).", "ok");
});

// ---- Venues import ----
$("u45VenBtn").addEventListener("click", async () => {
  const lines = $("u45Venues").value.split("\n").map((s) => s.trim()).filter(Boolean), out = [], bad = [];
  for (const ln of lines) {
    const p = ln.split(",").map((s) => s.trim()); let name = p[0], rad = null, lat, lng;
    if (p.length >= 4) { rad = Number(p[1]) || null; lat = Number(p[2]); lng = Number(p[3]); } else if (p.length === 3) { lat = Number(p[1]); lng = Number(p[2]); } else { bad.push(ln); continue; }
    if (!name || name.length < 2 || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (rad && (rad < 20 || rad > 2000))) { bad.push(ln); continue; }
    out.push({ name: name.slice(0, 80), lat, lng, radius_m: rad });
  }
  if (!out.length) return say("u45VenMsg", "No valid lines. Use: Name, radius, latitude, longitude", "bad");
  const r = await sb.from("shared_venues").insert(out); if (r.error) return say("u45VenMsg", r.error.message, "bad");
  say("u45VenMsg", out.length + " venue(s) added." + (bad.length ? " Skipped " + bad.length + " bad line(s): " + bad.slice(0, 3).join(" | ") : ""), bad.length ? "" : "ok");
  if (!bad.length) $("u45Venues").value = ""; if (window.loadVenuesAdmin) loadVenuesAdmin();
});

// ---- Phone: bottom navigation, More sheet, tables as cards ----
(function phone() {
  const tabs = document.querySelector(".tabs"); if (!tabs) return;
  const nav = el("nav", "anav"); nav.setAttribute("aria-label", "Admin sections");
  const mk = (t, label, svg) => { const b = el("button"); b.type = "button"; b.dataset.go = t; b.innerHTML = svg + "<span>" + label + "</span>"; return b; };
  const I = (d) => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  const main = [["over", "Home", "M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"], ["inb", "Inbox", "M4 4h16v12h-5l-2 3h-2l-2-3H4z"], ["cls", "Classes", "M4 5h16v14H4zM4 10h16"], ["ins", "Insights", "M4 20V10M10 20V4M16 20v-8M22 20H2"]];
  for (const [t, l, d] of main) nav.appendChild(mk(t, l, I(d)));
  const more = mk("more", "More", I("M5 12h.01M12 12h.01M19 12h.01")); nav.appendChild(more);
  document.body.appendChild(nav);
  const go = (t) => { const b = tabs.querySelector('[data-t="' + t + '"]'); if (b) { b.click(); window.scrollTo({ top: 0, behavior: "smooth" }); } };
  const sheet = el("div", "asheet"); sheet.hidden = true; sheet.innerHTML = '<div class="asheet-b" role="dialog" aria-label="All sections"><div class="asheet-h"><b>All sections</b><button type="button" class="abtn quiet" data-close>Close</button></div><div class="asheet-g"></div><div class="asheet-f"><button type="button" class="btn quiet" data-search>Search</button><button type="button" class="btn quiet" data-out>Sign out</button></div></div>';
  document.body.appendChild(sheet);
  const grid = sheet.querySelector(".asheet-g");
  const fill = () => { grid.textContent = ""; tabs.querySelectorAll("[data-t]").forEach((b) => { const t = el("button"); t.type = "button"; t.className = b.classList.contains("on") ? "on" : ""; t.innerHTML = (b.querySelector("svg") ? b.querySelector("svg").outerHTML : "") + "<span>" + esc2(b.childNodes.length ? b.firstElementChild && b.firstElementChild.tagName === "svg" ? b.textContent.trim() : b.textContent.trim() : "") + "</span>"; t.addEventListener("click", () => { sheet.hidden = true; go(b.dataset.t); }); grid.appendChild(t); }); };
  more.addEventListener("click", () => { fill(); sheet.hidden = false; });
  sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.hasAttribute("data-close")) sheet.hidden = true; });
  sheet.querySelector("[data-search]").addEventListener("click", () => { sheet.hidden = true; if (window.openPalette) openPalette(); });
  sheet.querySelector("[data-out]").addEventListener("click", () => { sheet.hidden = true; $("out").click(); });
  nav.addEventListener("click", (e) => { const b = e.target.closest("button[data-go]"); if (b && b.dataset.go !== "more") go(b.dataset.go); });
  const sync = () => { const on = tabs.querySelector("[data-t].on"), t = on && on.dataset.t; nav.querySelectorAll("[data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === t || (b.dataset.go === "more" && t && !main.some((m) => m[0] === t)))); };
  new MutationObserver(sync).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class"] }); sync();
  const apply = () => { const on = !$("app").hidden; nav.hidden = !on; };
  new MutationObserver(apply).observe($("app"), { attributes: true, attributeFilter: ["hidden"] }); apply();
  // header search button
  const top = document.querySelector("header.top"); if (top) { const s = el("button", "hsearch"); s.type = "button"; s.setAttribute("aria-label", "Search the admin page"); s.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>'; s.addEventListener("click", () => window.openPalette && openPalette()); top.appendChild(s); }
  // tables as cards: copy header text onto each cell
  const label = (t) => { const hs = Array.from(t.querySelectorAll("thead th")).map((h) => h.textContent.trim()); if (!hs.length) return; t.querySelectorAll("tbody tr").forEach((r) => Array.from(r.children).forEach((c, i) => { if (c.tagName === "TD" && !c.dataset.label && hs[i]) c.dataset.label = hs[i]; })); t.classList.add("cardtbl"); };
  let pend = false; const run = () => { pend = false; document.querySelectorAll("#app table").forEach(label); };
  new MutationObserver(() => { if (!pend) { pend = true; setTimeout(run, 80); } }).observe($("app"), { childList: true, subtree: true }); run();
})();


// ---- Add-student panel: used right inside a class the admin just started, and in Manage class ----
function addStudentPanel(sid, onAdded) {
  const box = el("div", "dkpanel"), h = el("h4", "ch3"); h.textContent = "Add a student by hand"; box.appendChild(h);
  const n = el("p", "note"); n.textContent = "For students who cannot check in themselves. They are marked as added by admin and counted as present."; box.appendChild(n);
  const g = el("div", "fgrid"); box.appendChild(g);
  const fld = (label, node, full) => { const d = el("div", full ? "full" : ""), l = el("label"); l.textContent = label; d.append(l, node); g.appendChild(d); return node; };
  const nm = fld("Full name", Object.assign(el("input"), { maxLength: 100, autocomplete: "off" }), true);
  const ix = fld("Index number", Object.assign(el("input"), { maxLength: 30, autocomplete: "off" })); ix.autocapitalize = "characters";
  const pr = fld("Programme (optional)", el("select")); opt2(pr, "", "Use the class's programme"); fillProgSel(pr);
  const lv = fld("Level (optional)", el("select")); opt2(lv, "", "Use the class's level"); fillLevelSel(lv);
  const b = el("button", "btn"); b.type = "button"; b.textContent = "Add student";
  const msg = el("p", "msg"); msg.setAttribute("role", "status"); const list = el("div", "dkadded"); let added = [];
  b.addEventListener("click", async () => {
    const name = nm.value.trim(), idx = ix.value.trim().toUpperCase(); b.disabled = true;
    const r = await sb.rpc("admin_add_student", { p_session: sid, p_index: idx, p_name: name, p_programme: pr.value, p_level: lv.value }); b.disabled = false;
    if (r.error) { msg.className = "msg bad"; msg.textContent = /function|exist|schema cache/i.test(r.error.message) ? "Run upgrade42.sql in Supabase first." : r.error.message; return; }
    if (!r.data.ok) { msg.className = "msg bad"; msg.textContent = r.data.error; return; }
    msg.className = "msg ok"; msg.textContent = name + " (" + idx + ") added."; added.unshift(name + " · " + idx);
    list.textContent = ""; const hh = el("b"); hh.textContent = "Added just now (" + added.length + ")"; const ul = el("ul"); for (const x of added.slice(0, 10)) { const li = el("li"); li.textContent = x; ul.appendChild(li); } list.append(hh, ul);
    nm.value = ""; ix.value = ""; nm.focus(); if (onAdded) onAdded();
  });
  box.append(b, msg, list); return box;
}
window.addStudentPanel = addStudentPanel;

// ---- Class desk: start a class for a lecturer, add students, transfer one class ----
let dkVenues = [], dkInit = false, dkAddedList = [];
const opt2 = (sel, v, t) => { const o = el("option"); o.value = v; o.textContent = t == null ? v : t; sel.appendChild(o); return o; };
const staff2 = () => people.filter((p) => p.role !== "admin" && p.active !== false).sort((a, b) => staffName(a.id).localeCompare(staffName(b.id)));
function fillStaff(sel, skip) { const keep = sel.value; sel.textContent = ""; opt2(sel, "", "Choose a lecturer…"); for (const p of staff2()) if (p.id !== skip) opt2(sel, p.id, staffName(p.id)); if (keep && Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep; }
function classLabel(c) { const open = new Date(c.opens_at) <= Date.now() && new Date(c.closes_at) > Date.now(); return (open ? "OPEN · " : "") + c.course + " · " + (c._owner || staffName(c.owner)) + " · " + new Date(c.created_at).toLocaleDateString([], { day: "numeric", month: "short" }); }
function fillClasses(sel) { const keep = sel.value; sel.textContent = ""; opt2(sel, "", "Choose a class…"); for (const c of classes.filter((x) => !x.archived).slice(0, 300)) opt2(sel, c.id, classLabel(c)); if (keep && Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep; }
async function initDesk() {
  fillStaff($("dkLec")); fillClasses($("dkCls")); fillClasses($("dkMvCls")); fillStaff($("dkMvTo"));
  if (!dkInit) {
    dkInit = true;
    for (const [s, blank] of [[$("dkProg"), "Programme (optional)"], [$("dkSProg"), "Use the class's programme"]]) { opt2(s, "", blank); fillProgSel(s); }
    for (const [s, blank] of [[$("dkLevel"), "Level (optional)"], [$("dkSLevel"), "Use the class's level"]]) { opt2(s, "", blank); fillLevelSel(s); }
    const st = await sb.rpc("get_public_settings"); if (st.data) { $("dkYear").value = st.data.year || ""; if (st.data.semester) $("dkSem").value = st.data.semester; }
    const v = await sb.from("shared_venues").select("*").order("name"); dkVenues = v.data || [];
    const vs = $("dkVenue"); vs.textContent = ""; opt2(vs, "", "Choose a saved venue…");
    for (const x of dkVenues) opt2(vs, x.id, x.name + (x.radius_m ? " (" + x.radius_m + " m)" : ""));
    opt2(vs, "__pos", "Enter a position / use my position");
    vs.addEventListener("change", () => { const x = dkVenues.find((q) => q.id === vs.value); $("dkPosBox").hidden = vs.value !== "__pos"; if (x && x.radius_m) $("dkRad").value = x.radius_m; });
  }
}
window.initDesk = initDesk;
document.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-seg]").forEach((x) => x.classList.toggle("on", x === b));
  for (const k of ["start", "add", "move"]) $("dk-" + k).hidden = k !== b.dataset.seg;
}));
$("dkLec").addEventListener("change", () => { const dl = $("dkCourses"); dl.textContent = ""; for (const c of [...new Set(courses.filter((k) => k.owner === $("dkLec").value).map((k) => k.name))]) { const o = el("option"); o.value = c; dl.appendChild(o); } });
$("dkGps").addEventListener("click", () => { if (!navigator.geolocation) return say("dkStartMsg", "This device cannot share its position.", "bad"); say("dkStartMsg", "Finding your position…"); navigator.geolocation.getCurrentPosition((p) => { $("dkLat").value = p.coords.latitude.toFixed(6); $("dkLng").value = p.coords.longitude.toFixed(6); say("dkStartMsg", "Position filled in.", "ok"); }, () => say("dkStartMsg", "Could not get your position. Allow location, or type the numbers.", "bad"), { enableHighAccuracy: true, timeout: 15000 }); });
$("dkStart").addEventListener("click", async () => {
  const v = dkVenues.find((x) => x.id === $("dkVenue").value); let lat, lng;
  if (v) { lat = v.lat; lng = v.lng; } else if ($("dkVenue").value === "__pos") { lat = Number($("dkLat").value); lng = Number($("dkLng").value); } else return say("dkStartMsg", "Choose where the class is.", "bad");
  if (!$("dkLec").value) return say("dkStartMsg", "Choose the lecturer.", "bad");
  $("dkStart").disabled = true; say("dkStartMsg", "Starting…");
  const r = await sb.rpc("admin_start_class", { p_owner: $("dkLec").value, p_course: $("dkCourse").value, p_programme: $("dkProg").value, p_level: $("dkLevel").value, p_year: $("dkYear").value, p_sem: $("dkSem").value, p_lat: lat, p_lng: lng, p_radius: Number($("dkRad").value), p_minutes: Number($("dkMins").value) });
  $("dkStart").disabled = false;
  if (r.error) return say("dkStartMsg", /function|exist|schema cache/i.test(r.error.message) ? "Run upgrade42.sql in Supabase first." : r.error.message, "bad");
  if (!r.data.ok) return say("dkStartMsg", r.data.error, "bad");
  say("dkStartMsg", "");
  const d = $("dkDone"); d.hidden = false; d.textContent = "";
  const t = el("div"); t.innerHTML = "<b>Class started</b><br>Share this code with the students:"; const c = el("div", "dkcode"); c.textContent = r.data.code; d.append(t, c);
  const live = el("a", "btn"); live.href = "teacher.html?open=" + encodeURIComponent(r.data.id); live.target = "_blank"; live.rel = "noopener"; live.textContent = "Open the live class screen (code, QR, extend, close)"; live.style.cssText = "display:block;text-align:center;text-decoration:none;margin:6px 0 4px"; d.appendChild(live);
  d.appendChild(addStudentPanel(r.data.id));
  await load(); initDesk();
});
$("dkAdd").addEventListener("click", async () => {
  if (!$("dkCls").value) return say("dkAddMsg", "Choose the class first.", "bad");
  const name = $("dkName").value.trim(), idx = $("dkIdx").value.trim().toUpperCase();
  const r = await sb.rpc("admin_add_student", { p_session: $("dkCls").value, p_index: idx, p_name: name, p_programme: $("dkSProg").value, p_level: $("dkSLevel").value });
  if (r.error) return say("dkAddMsg", /function|exist|schema cache/i.test(r.error.message) ? "Run upgrade42.sql in Supabase first." : r.error.message, "bad");
  if (!r.data.ok) return say("dkAddMsg", r.data.error, "bad");
  say("dkAddMsg", name + " (" + idx + ") added.", "ok"); dkAddedList.unshift(name + " · " + idx);
  $("dkAdded").textContent = ""; const ul = el("ul"); for (const x of dkAddedList.slice(0, 12)) { const li = el("li"); li.textContent = x; ul.appendChild(li); } const hh = el("b"); hh.textContent = "Added just now (" + dkAddedList.length + ")"; $("dkAdded").append(hh, ul);
  $("dkName").value = ""; $("dkIdx").value = ""; $("dkName").focus();
});
$("dkMvCls").addEventListener("change", () => { const c = classes.find((x) => x.id === $("dkMvCls").value); $("dkMvOwner").textContent = c ? "Currently with " + (c._owner || staffName(c.owner)) + ". " + (c._n || 0) + " check-in(s) stay with the class." : ""; fillStaff($("dkMvTo"), c && c.owner); });
$("dkMove").addEventListener("click", async () => {
  const c = classes.find((x) => x.id === $("dkMvCls").value); if (!c) return say("dkMvMsg", "Choose the class.", "bad"); if (!$("dkMvTo").value) return say("dkMvMsg", "Choose the new lecturer.", "bad");
  if (!confirm("Transfer \"" + c.course + "\" to " + staffName($("dkMvTo").value) + "?")) return;
  const r = await sb.rpc("admin_transfer_class", { p_id: c.id, p_to: $("dkMvTo").value, p_copy_roll: $("dkMvRoll").checked });
  if (r.error) return say("dkMvMsg", /function|exist|schema cache/i.test(r.error.message) ? "Run upgrade42.sql in Supabase first." : r.error.message, "bad");
  if (!r.data.ok) return say("dkMvMsg", r.data.error, "bad");
  say("dkMvMsg", "Done. The class now belongs to " + r.data.to + (r.data.roll_copied ? ". " + r.data.roll_copied + " roll entries copied." : "."), "ok");
  await load(); initDesk();
});

// ---- Tools tab: tidy accordion with a finder ----
(function toolsTidy() {
  const t = $("t-tools"); if (!t) return;
  const boxes = Array.from(t.querySelectorAll(":scope > .reqbox")); if (!boxes.length) return;
  const find = el("input"); find.type = "search"; find.placeholder = "Find a tool (e.g. pause, export, lock)"; find.setAttribute("aria-label", "Find a tool"); find.className = "toolfind";
  const bar = el("div", "toolbar"); const all = el("button", "btn quiet"); all.type = "button"; all.textContent = "Open all"; const none = el("button", "btn quiet"); none.type = "button"; none.textContent = "Close all"; bar.append(find, all, none);
  t.querySelector("h2").after(bar);
  for (const b of boxes) {
    const h = b.querySelector("h3"); if (!h) continue; b.classList.add("fold", "collapsed"); h.tabIndex = 0; h.setAttribute("role", "button"); h.setAttribute("aria-expanded", "false");
    const tg = () => { const c = b.classList.toggle("collapsed"); h.setAttribute("aria-expanded", String(!c)); };
    h.addEventListener("click", tg); h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tg(); } });
  }
  const setAll = (c) => boxes.forEach((b) => { b.classList.toggle("collapsed", c); const h = b.querySelector("h3"); if (h) h.setAttribute("aria-expanded", String(!c)); });
  all.addEventListener("click", () => setAll(false)); none.addEventListener("click", () => setAll(true));
  find.addEventListener("input", () => { const q = find.value.trim().toLowerCase(); boxes.forEach((b) => { const hit = !q || b.textContent.toLowerCase().includes(q); b.hidden = !hit; if (q && hit) { b.classList.remove("collapsed"); } }); });
})();
