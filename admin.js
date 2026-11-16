const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (i) => document.getElementById(i);
const say = (id, t, k) => { $(id).textContent = t; $(id).className = "msg " + (k || ""); };
let people = [], classes = [], courses = [], nameReqs = [], counts = {}, sort = { lect: ["email", 1], cls: ["created_at", -1] };
const fmt = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  $("login").hidden = !!session; $("app").hidden = true;
  if (!session) return;
  const { data: me } = await sb.from("profiles").select("role").eq("id", session.user.id).single();
  if (!me || me.role !== "admin" || session.user.email.toLowerCase() !== "ygpedri@gmail.com") { await sb.auth.signOut(); $("login").hidden = false; return say("loginMsg", "This page is for the admin only.", "bad"); }
  $("app").hidden = false; $("who").textContent = session.user.email; load();
}
$("login").addEventListener("submit", async (e) => {
  e.preventDefault(); say("loginMsg", "Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value });
  if (error) return say("loginMsg", "Wrong email or password.", "bad");
  $("pw").value = ""; say("loginMsg", ""); start();
});
wireForgot(sb, "login");
$("out").addEventListener("click", async () => { await sb.auth.signOut(); start(); });
document.querySelectorAll(".tabs [data-t]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs [data-t]").forEach((x) => x.classList.toggle("on", x === b));
  for (const t of ["over", "lect", "cls", "roll", "ana", "act", "rep"]) $("t-" + t).hidden = t !== b.dataset.t;
  if (b.dataset.t === "roll") loadRolls(); if (b.dataset.t === "ana") loadAnalytics(); if (b.dataset.t === "act") loadActivity(); if (b.dataset.t === "rep") loadReports();
}));

async function load() {
  const [p, c, a, cr, rq] = await Promise.all([sb.from("profiles").select("*"), fetchAllRows(sb, "sessions", "*", "created_at", false), fetchAllRows(sb, "attendance", "session_id", "id"), sb.from("courses").select("owner,name").order("name"), sb.from("name_requests").select("*").eq("status", "pending").order("created_at")]);
  nameReqs = rq.data || [];
  courses = cr.data || [];
  people = p.data || []; classes = c.data || []; counts = {};
  for (const r of a.data || []) counts[r.session_id] = (counts[r.session_id] || 0) + 1;
  const byId = Object.fromEntries(people.map((x) => [x.id, x]));
  const nameCount = {}; for (const p of people) if (p.full_name) nameCount[p.full_name.toLowerCase()] = (nameCount[p.full_name.toLowerCase()] || 0) + 1;
  for (const s of classes) { const o = byId[s.owner] || {}; s._owner = o.full_name ? (nameCount[o.full_name.toLowerCase()] > 1 ? o.full_name + " (" + o.email + ")" : o.full_name) : o.email || "-"; s._n = counts[s.id] || 0; }
  for (const x of people) { x._classes = classes.filter((s) => s.owner === x.id).length; x._courseText = courses.filter((k) => k.owner === x.id).map((k) => k.name).join(", "); }
  $("stats").innerHTML = "";
  for (const [n, l] of [[people.length, "Staff accounts"], [people.filter((x) => x.role === "lecturer" && x.active).length, "Active lecturers"], [people.filter((x) => x.role === "assistant" && x.active).length, "Teaching assistants"], [nameReqs.length, "Name requests"], [classes.length, "Classes"], [(a.data || []).length, "Check-ins"]]) {
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = 0; countUp(b, n); d.append(b, l); $("stats").appendChild(d);
  }
  fillFilters(); drawL(); drawC(); drawReq(); loadStatus(); loadReports(true);
}

function grid(head, body, cols, rows, key) {
  head.textContent = ""; const tr = document.createElement("tr");
  for (const [k, label] of cols) { const th = document.createElement("th"); if (k) { th.dataset.k = k; th.textContent = label + (sort[key][0] === k ? (sort[key][1] > 0 ? " \u25B2" : " \u25BC") : ""); th.addEventListener("click", () => { sort[key] = [k, sort[key][0] === k ? -sort[key][1] : 1]; key === "lect" ? drawL() : drawC(); }); } else th.textContent = label; tr.appendChild(th); }
  head.appendChild(tr);
  const [k, d] = sort[key];
  rows.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * d);
  body.textContent = "";
  return rows;
}
function drawL() {
  const q = $("lq").value.trim().toLowerCase();
  const rows = grid($("lh"), $("lb"), [["email", "Email"], ["full_name", "Name"], ["role", "Role"], ["_courseText", "Courses"], ["active", "Status"], ["_classes", "Classes"], ["created_at", "Added"], [null, "Actions"]], people.filter((x) => (x.email + " " + (x.full_name || "")).toLowerCase().includes(q)), "lect");
  for (const x of rows) {
    const tr = document.createElement("tr");
    for (const v of [x.email, x.full_name || "-", roleLabel(x.role), x._courseText || "-", x.active ? "Active" : "Disabled", x._classes, fmt(x.created_at)]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    if (x.role !== "admin") {
      const mk = (t, f) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.className = "abtn " + (/^Disable/.test(t) ? "bad" : /^Enable/.test(t) ? "ok" : ""); b.addEventListener("click", f); td.appendChild(b); };
      mk("Send reset link", async () => { if (!confirm("Email a password reset link to " + x.email + "?")) return; if (await call({ action: "reset", id: x.id }, "Reset link sent to " + x.email + ".")) load(); });
      mk(x.active ? "Disable" : "Enable", async () => { const r = await sb.functions.invoke("staff-access", { body: { action: "active", id: x.id, active: !x.active } }); fail(r) || load(); });
      mk(x.role === "assistant" ? "Make lecturer" : "Make TA", async () => { const r = await sb.rpc("set_staff_role", { p_email: x.email, p_role: x.role === "assistant" ? "lecturer" : "assistant" }); if (r.error) say("msg", r.error.message, "bad"); else load(); });
      mk("Edit name", async () => { const n = (prompt("Full name for " + x.email + ":", x.full_name || "") || "").trim(); if (n.length < 3) return; const r = await sb.rpc("admin_set_name", { p_email: x.email, p_name: n }); if (r.error) say("msg", r.error.message, "bad"); else load(); });
      mk("Add course", async () => { const n = (prompt("Course name for " + x.email + ":") || "").trim(); if (n.length < 2) return; const r = await sb.rpc("admin_add_course", { p_owner: x.id, p_name: n }); if (r.error) say("msg", r.error.message, "bad"); else load(); });
    }
    tr.appendChild(td); $("lb").appendChild(tr);
  }
}
function drawC() {
  const q = $("cq").value.trim().toLowerCase();
  const rows = grid($("ch"), $("cb"), [["created_at", "Date"], ["course", "Course"], ["academic_year", "Year"], ["semester", "Semester"], ["programme", "Programme"], ["level", "Level"], ["_owner", "Lecturer"], ["_n", "Check-ins"], [null, "Actions"]], filteredClasses(), "cls");
  for (const s of rows) {
    const tr = document.createElement("tr");
    for (const v of [fmt(s.created_at), s.course, s.academic_year || "-", s.semester || "-", s.combined ? "Combined: " + (s.class_groups || []).map((g) => g.programme + " (" + g.level + ")").join("; ") : s.programme || "-", s.combined ? "Various" : s.level || "-", s._owner, s._n]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    td.append(abtn("Copy link", "", () => copyClassLink(s)), abtn("Sheet", "", () => adminSheet(s)), abtn(s.archived ? "Restore" : "Archive", "", () => archiveSome([s], !s.archived)),
      abtn("Delete", "bad", async () => { if (confirm("Delete this class and all its attendance?")) { const x = await sb.from("sessions").delete().eq("id", s.id); if (x.error) say("msg", "Could not delete: " + x.error.message, "bad"); load(); } }));
    tr.appendChild(td); $("cb").appendChild(tr);
  }
}
$("lq").addEventListener("input", drawL);

// ---- Class rolls: the admin can add, replace and delete a roll for any lecturer ----
function fillProgSel(sel) {
  const list = (typeof PROGRAMMES !== "undefined" && Array.isArray(PROGRAMMES)) ? PROGRAMMES : [];
  const addOpt = (parent, name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; parent.appendChild(o); };
  for (const g of list) {
    if (typeof g === "string") { addOpt(sel, g); continue; }
    const items = (g && (g.items || g.programmes || g.options || g.list)) || [];
    if (!Array.isArray(items) || !items.length) continue;
    const og = document.createElement("optgroup"); og.label = g.group || g.label || g.name || "Programmes";
    for (const name of items) addOpt(og, name);
    sel.appendChild(og);
  }
}
fillProgSel($("rlProg")); fillLevelSel($("rlLevel"));
const staffName = (id) => { const x = people.find((p) => p.id === id); return x ? (x.full_name ? x.full_name + " (" + x.email + ")" : x.email) : "-"; };
function drawRollForm() {
  const keep = $("rlLect").value, sel = $("rlLect"); sel.textContent = "";
  const add = (s, v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); };
  add(sel, "", "Select the lecturer");
  for (const x of people.filter((p) => p.role !== "admin").sort((a, b) => staffName(a.id).localeCompare(staffName(b.id)))) add(sel, x.id, staffName(x.id));
  sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
  drawRollCourses();
}
function drawRollCourses() {
  const id = $("rlLect").value, sel = $("rlCourse"), keep = sel.value; sel.textContent = "";
  const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
  add("", id ? "Select the course" : "Choose the lecturer first");
  for (const k of courses.filter((c) => c.owner === id)) add(k.name, k.name);
  sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
}
$("rlLect").addEventListener("change", drawRollCourses);
async function loadRolls() {
  drawRollForm();
  const { data, error } = await fetchAllRows(sb, "rolls", "id,owner,course,programme,level", "created_at");
  if (error) return say("rlMsg", "Could not load the rolls: " + error.message, "bad");
  const by = new Map();
  for (const r of data) { const k = [r.owner, r.course, (r.programme || "").trim(), (r.level || "").trim()].join("\u0001"); const e = by.get(k) || { owner: r.owner, course: r.course, programme: (r.programme || "").trim(), level: (r.level || "").trim(), ids: [], n: 0 }; e.n++; e.ids.push(r.id); by.set(k, e); }
  rollList = Array.from(by.values()); drawRolls();
}
let rollList = [];
function drawRolls() {
  const q = $("rlQ").value.trim().toLowerCase(), body = $("rlB"); body.textContent = "";
  const rows = rollList.map((r) => Object.assign({ _who: staffName(r.owner) }, r)).filter((r) => (r._who + " " + r.course + " " + r.programme + " " + r.level).toLowerCase().includes(q))
    .sort((a, b) => a._who.localeCompare(b._who) || a.course.localeCompare(b.course) || a.programme.localeCompare(b.programme) || a.level.localeCompare(b.level));
  if (!rows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 6; td.textContent = "No saved rolls."; tr.appendChild(td); body.appendChild(tr); return; }
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const v of [r._who, r.course, r.programme || "No programme (older upload)", r.level || "Level not set", r.n]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    td.appendChild(abtn("Delete", "bad", async () => {
      if (!confirm("Delete the roll for " + r.course + " (" + (r.programme || "no programme") + ", " + (r.level || "level not set") + "), " + r.n + " students, belonging to " + r._who + "? Attendance records are not affected.")) return;
      const x = await deleteRollIds(sb, r.ids);
      if (x.error) return say("rlMsg", "Could not delete: " + x.error.message, "bad");
      say("rlMsg", "Roll deleted (" + x.n + " students).", "ok"); loadRolls();
    }));
    tr.appendChild(td); body.appendChild(tr);
  }
}
$("rlQ").addEventListener("input", drawRolls);
$("rlUp").addEventListener("click", async () => {
  const owner = $("rlLect").value, course = $("rlCourse").value, prog = $("rlProg").value, lvl = $("rlLevel").value, f = $("rlFile").files[0];
  if (!owner) return say("rlMsg", "Choose the lecturer first.", "warn");
  if (!course) return say("rlMsg", "Choose the course. If the list is empty, use Add course on the Lecturers tab first.", "warn");
  if (!prog) return say("rlMsg", "Choose the programme this roll is for.", "warn");
  if (!lvl) return say("rlMsg", "Choose the level this roll is for.", "warn");
  if (!f) return say("rlMsg", "Choose a CSV or Excel file first.", "warn");
  if (!window.XLSX) return say("rlMsg", "The Excel library did not load. Check your internet.", "bad");
  say("rlMsg", "Reading the file...");
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    if (rows.length < 2) return say("rlMsg", "The file has no student rows.", "bad");
    const head = rows[0].map((h) => String(h).toLowerCase());
    const find = (re, fb) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fb; };
    const ci = find(/index|student\s*(id|no)|reg|^id$/, 0), cn = find(/^(full |student )?name/, 1);
    const map = new Map(); let skipped = 0;
    for (const r of rows.slice(1)) {
      const idx = String(r[ci] || "").trim().toUpperCase();
      if (!/^[A-Z0-9\/\-]{4,30}$/.test(idx)) { if (idx || r.some((x) => String(x).trim())) skipped++; continue; }
      map.set(idx, { owner, course, index_number: idx, student_name: String(r[cn] || "").trim().slice(0, 100) || null, programme: prog, level: lvl });
    }
    if (!map.size) return say("rlMsg", "No valid index numbers found. Check the column headings.", "bad");
    const list = Array.from(map.values());
    const have = []; 
    for (let from = 0; ; from += 1000) {
      const { data: ex, error: ee } = await sb.from("rolls").select("id,programme,level").eq("owner", owner).eq("course", course).order("id").range(from, from + 999);
      if (ee) return say("rlMsg", "Could not read the old roll: " + ee.message, "bad");
      have.push(...(ex || [])); if (!ex || ex.length < 1000) break;
    }
    const d1 = await deleteRollIds(sb, have.filter((x) => sameText(x.programme, prog) && levelKey(x.level) === levelKey(lvl)).map((x) => x.id));
    if (d1.error) return say("rlMsg", "Could not replace the old roll: " + d1.error.message, "bad");
    for (let i = 0; i < list.length; i += 200) {
      const d2 = await sb.from("rolls").delete().eq("owner", owner).eq("course", course).in("index_number", list.slice(i, i + 200).map((x) => x.index_number));
      if (d2.error) return say("rlMsg", "Could not replace the old roll: " + d2.error.message, "bad");
    }
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await sb.from("rolls").insert(list.slice(i, i + 200));
      if (error) return say("rlMsg", "Upload failed: " + error.message, "bad");
    }
    say("rlMsg", "Roll saved for " + staffName(owner) + ", " + course + " (" + prog + ", " + lvl + "): " + list.length + " students" + (skipped ? ", " + skipped + " rows skipped (invalid index number)." : "."), "ok");
    $("rlFile").value = ""; loadRolls();
  } catch (e) { say("rlMsg", "Could not read that file.", "bad"); }
});
for (const id of ["cq", "fc", "fp", "fl", "fo", "ft", "fa", "fy", "fs", "fd1", "fd2"]) $(id).addEventListener(id === "cq" ? "input" : "change", drawC);
const roleLabel = (r) => (r === "assistant" ? "Teaching assistant" : r === "admin" ? "Admin" : "Lecturer");
function filteredClasses() {
  const q = $("cq").value.trim().toLowerCase(), fc = $("fc").value, fp = $("fp").value, fl = $("fl").value, fo = $("fo").value, ft = $("ft").value, fa = $("fa").value, fy = $("fy").value, fs = $("fs").value, d1 = $("fd1").value, d2 = $("fd2").value;
  return classes.filter((s) => {
    if ((fa === "active" && s.archived) || (fa === "archived" && !s.archived)) return false;
    if (fc && s.course !== fc) return false; if (fy && s.academic_year !== fy) return false; if (fs && s.semester !== fs) return false; if ((ft === "combined" && !s.combined) || (ft === "single" && s.combined)) return false;
    const gs = s.combined ? (s.class_groups || []) : [{ programme: s.programme, level: s.level }];
    if (fp && !gs.some((g) => g.programme === fp)) return false;
    if (fl && !gs.some((g) => g.level === fl || g.level === "All levels")) return false; if (fo && s._owner !== fo) return false;
    const day = new Date(s.created_at).toLocaleDateString("en-CA");
    if (d1 && day < d1) return false; if (d2 && day > d2) return false;
    return ((s.course || "") + " " + (s.programme || "") + " " + s._owner).toLowerCase().includes(q);
  });
}
function fillFilters() {
  for (const [id, key] of [["fc", "course"], ["fy", "academic_year"], ["fs", "semester"], ["fp", "programme"], ["fl", "level"], ["fo", "_owner"]]) {
    const sel = $(id), keep = sel.value, first = sel.options[0];
    sel.textContent = ""; sel.appendChild(first);
    for (const v of [...new Set(classes.flatMap((s) => (s.combined && (key === "programme" || key === "level") ? (s.class_groups || []).map((g) => g[key]) : [s[key]])).filter((v) => v && v !== "-" && v !== "Combined" && v !== "Various" && v !== "All levels"))].sort()) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
    sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
  }
}
$("cx").addEventListener("click", async () => {
  const list = filteredClasses(); if (!list.length) return say("msg", "No classes match the filters.", "warn");
  say("msg", "Preparing the spreadsheet...");
  const atts = await fetchAttendance(sb, list.map((s) => s.id));
  downloadXlsx("KTU attendance " + new Date().toLocaleDateString("en-CA"), buildSheets(list, atts)); say("msg", "Downloaded.", "ok");
});

function fail(r) { const m = r.error ? (r.data && r.data.error) || r.error.message : r.data && r.data.error; if (m) { say("msg", m, "bad"); return true; } return false; }
async function call(body, okText) {
  say("msg", "Working…"); const r = await sb.functions.invoke("staff-access", { body });
  if (fail(r)) return false;
  say("msg", okText || "Done.", "ok"); return true;
}
$("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("aemail").value.trim(), role = $("arole").value, nm = $("aname").value.trim().replace(/\s+/g, " ").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const btn = $("add").querySelector("button"); btn.disabled = true;
  const ok = await call({ action: "invite", email, name: nm, role }, "Invite sent to " + email + ". They click the link in the email, then choose their own password.");
  btn.disabled = false;
  if (!ok) return;
  $("aemail").value = ""; $("aname").value = ""; load();
});
start();

// ---- Name change requests ----
const abtn = (t, cls, f) => { const b = document.createElement("button"); b.type = "button"; b.className = "abtn " + cls; b.textContent = t; b.addEventListener("click", f); return b; };
function drawReq() {
  const box = $("reqBox"), L = $("reqList"); L.textContent = ""; box.hidden = !nameReqs.length; $("reqN").textContent = nameReqs.length;
  for (const r of nameReqs) {
    const row = document.createElement("div"); row.className = "reqrow";
    const t = document.createElement("div"); t.className = "reqtxt";
    const b = document.createElement("b"); b.textContent = r.email || "Lecturer";
    const sp = document.createElement("span"); sp.textContent = (r.current_name || "(no name)") + "  \u2192  " + r.requested_name;
    t.append(b, sp);
    const acts = document.createElement("div"); acts.className = "acts";
    acts.append(abtn("Approve", "ok", () => decide(r.id, true)), abtn("Decline", "bad", () => decide(r.id, false)));
    row.append(t, acts); L.appendChild(row);
  }
}
async function decide(id, ok) {
  const r = await sb.rpc("decide_name_request", { p_id: id, p_approve: ok });
  if (r.error) say("msg", r.error.message, "bad"); else { say("msg", ok ? "Name updated." : "Request declined.", "ok"); load(); }
}

// ---- Privacy clean-up ----
$("purge").addEventListener("click", async () => {
  const m = Number($("purgeMonths").value);
  if (!confirm("Delete location and phone details from check-ins older than " + m + " months? This cannot be undone.")) return;
  const r = await sb.rpc("purge_locations", { p_months: m });
  if (r.error) say("msg", r.error.message, "bad"); else say("msg", "Cleaned " + r.data + " check-in(s).", "ok");
});

// ================= Batch C =================
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };

// ---- Archive and printable sheet ----
async function archiveSome(list, arch) {
  if (!list.length) return say("msg", "No matching classes.", "warn");
  if (list.length > 1 && !confirm((arch ? "Archive " : "Restore ") + list.length + " classes? " + (arch ? "They are hidden from the default lists but kept, and you can restore them." : ""))) return;
  const r = await sb.rpc("archive_sessions", { p_ids: list.map((s) => s.id), p_archived: arch });
  if (r.error) say("msg", r.error.message, "bad"); else { say("msg", (arch ? "Archived " : "Restored ") + r.data + " class(es).", "ok"); load(); }
}
$("arcBulk").addEventListener("click", () => archiveSome(filteredClasses().filter((s) => !s.archived), true));
$("resBulk").addEventListener("click", () => archiveSome(filteredClasses().filter((s) => s.archived), false));
async function adminSheet(s) {
  say("msg", "Preparing the sheet...");
  const [atts, { data: roll }] = await Promise.all([fetchAttendance(sb, [s.id]), sb.from("rolls").select("*").eq("owner", s.owner).eq("course", s.course)]);
  say("msg", ""); openAttendanceSheet(s, atts, (roll || []).filter((r) => rollMatchesClass(r, s)), s._owner);
}

// ---- Analytics ----
async function loadAnalytics() {
  const ys = $("anYear"), keep = ys.value; ys.textContent = "";
  const o0 = el("option"); o0.value = ""; o0.textContent = "All years"; ys.appendChild(o0);
  for (const y of [...new Set(classes.map((s) => s.academic_year).filter(Boolean))].sort().reverse()) { const o = el("option"); o.value = y; o.textContent = y; ys.appendChild(o); }
  ys.value = Array.from(ys.options).some((o) => o.value === keep) ? keep : "";
  const { data, error } = await sb.rpc("admin_stats", { p_year: $("anYear").value || null, p_sem: $("anSem").value || null, p_archived: $("anArch").checked });
  if (error) return say("msg", "Could not load analytics: " + error.message, "bad");
  say("msg", "");
  const t = data.totals, box = $("anTotals"); box.textContent = "";
  for (const [v, l, isPct] of [[t.classes, "Classes"], [t.checkins, "Check-ins"], [pct(t.in_range, t.checkins), "In the class area", 1], [pct(t.late, t.checkins), "Late", 1], [pct(t.flagged, t.checkins), "Flagged", 1]]) {
    const d = el("div"), b = el("b"); if (isPct) b.textContent = v + "%"; else { b.textContent = 0; countUp(b, v); } d.append(b, l); box.appendChild(d);
  }
  drawWeekly(data.weekly); drawProgs(data.programmes); drawHeat(data.heat); drawScore(data.lecturers);
}
$("anGo").addEventListener("click", loadAnalytics);
for (const id of ["anYear", "anSem", "anArch"]) $(id).addEventListener("change", loadAnalytics);
function drawWeekly(w) {
  const box = $("chWeek"); box.textContent = "";
  const map = Object.fromEntries(w.map((x) => [x.week, x]));
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const rows = [];
  for (let i = 11; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i * 7); const k = x.toLocaleDateString("en-CA"); rows.push({ x, n: (map[k] || {}).n || 0, inr: (map[k] || {}).inr || 0 }); }
  const max = Math.max(1, ...rows.map((r) => r.n));
  for (const r of rows) {
    const col = el("div", "vcol"), num = el("span", "vnum"), track = el("div", "vtrack"), bar = el("div", "vbar"), inn = el("div", "vin"), lab = el("span", "vlab");
    num.textContent = r.n; bar.style.height = (r.n ? Math.max(4, (r.n / max) * 100) : 0) + "%"; inn.style.height = (r.n ? (r.inr / r.n) * 100 : 0) + "%";
    lab.textContent = r.x.toLocaleDateString([], { day: "numeric", month: "short" }); col.title = r.n + " check-in(s), " + r.inr + " in the class area";
    bar.appendChild(inn); track.appendChild(bar); col.append(num, track, lab); box.appendChild(col);
  }
}
function drawProgs(p) {
  const box = $("chProg"); box.textContent = "";
  if (!p.length) { box.textContent = "No data yet."; return; }
  const max = Math.max(...p.map((x) => x.n));
  for (const x of p) {
    const row = el("div", "hrow"), l = el("span", "hl"), tr = el("div", "htrack"), b = el("div", "hbar"), v = el("span", "hv");
    l.textContent = x.programme || "-"; b.style.width = (x.n / max) * 100 + "%"; v.textContent = x.n + " (" + pct(x.inr, x.n) + "% in area)";
    tr.appendChild(b); row.append(l, tr, v); box.appendChild(row);
  }
}
function drawHeat(h) {
  const box = $("chHeat"); box.textContent = "";
  const map = {}; let max = 1; for (const x of h) { map[x.dow + "-" + x.hr] = x.n; max = Math.max(max, x.n); }
  const order = [1, 2, 3, 4, 5, 6, 0], names = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 0: "Sun" }, hours = Array.from({ length: 15 }, (_, i) => i + 6);
  const head = el("div", "hrowh"); head.appendChild(el("span", "hd")); for (const hr of hours) { const c = el("span", "hc"); c.textContent = hr; head.appendChild(c); } box.appendChild(head);
  for (const dw of order) {
    const row = el("div", "hrowh"), n = el("span", "hd"); n.textContent = names[dw]; row.appendChild(n);
    for (const hr of hours) { const v = map[dw + "-" + hr] || 0, c = el("span", "hcell"); if (v) c.style.background = "rgba(0,76,132," + (0.15 + (0.85 * v) / max) + ")"; c.title = names[dw] + " " + hr + ":00, " + v + " check-in(s)"; row.appendChild(c); }
    box.appendChild(row);
  }
}
let scoreRows = [];
function drawScore(l) {
  scoreRows = l.map((x) => ({ name: x.full_name || x.email || "-", classes: x.classes, checkins: x.checkins, avg: x.classes ? Math.round((x.checkins / x.classes) * 10) / 10 : 0, inr: pct(x.inr, x.checkins), late: pct(x.late, x.checkins), flagged: pct(x.flagged, x.checkins) })).sort((a, b) => b.checkins - a.checkins);
  const H = $("scH"), B = $("scB"); H.textContent = ""; B.textContent = "";
  const tr = el("tr"); for (const h of ["Lecturer", "Classes", "Check-ins", "Avg per class", "In area %", "Late %", "Flagged %"]) { const th = el("th"); th.textContent = h; tr.appendChild(th); } H.appendChild(tr);
  for (const x of scoreRows) { const r = el("tr"); for (const v of [x.name, x.classes, x.checkins, x.avg, x.inr + "%", x.late + "%", x.flagged + "%"]) { const td = el("td"); td.textContent = v; r.appendChild(td); } B.appendChild(r); }
  if (!scoreRows.length) { const r = el("tr"), td = el("td"); td.colSpan = 7; td.textContent = "No classes in this selection."; r.appendChild(td); B.appendChild(r); }
}
$("scX").addEventListener("click", () => downloadXlsx("Lecturer scorecard", [{ name: "Scorecard", rows: [["Lecturer", "Classes", "Check-ins", "Avg per class", "In area %", "Late %", "Flagged %"]].concat(scoreRows.map((x) => [x.name, x.classes, x.checkins, x.avg, x.inr, x.late, x.flagged])) }]));

// ---- Activity log ----
const ACT = { account_created: "Account created", role_changed: "Role changed", account_enabled: "Account enabled", account_disabled: "Account disabled", name_changed: "Name changed", checkin_removed: "Check-in removed", manual_checkin_added: "Check-in added by hand", class_reopened: "Class reopened", class_archived: "Class archived", class_restored: "Class restored", class_deleted: "Class deleted", name_request_approved: "Name request approved", name_request_declined: "Name request declined" };
let actRows = [];
async function loadActivity() {
  const { data, error } = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
  if (error) return say("msg", "Could not load the activity log: " + error.message, "bad");
  actRows = data || [];
  const sel = $("actFilter"), keep = sel.value; sel.textContent = ""; const o0 = el("option"); o0.value = ""; o0.textContent = "All actions"; sel.appendChild(o0);
  for (const k of [...new Set(actRows.map((r) => r.action))]) { const o = el("option"); o.value = k; o.textContent = ACT[k] || k; sel.appendChild(o); }
  sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : ""; drawActivity();
}
function drawActivity() {
  const f = $("actFilter").value, q = $("actQ").value.trim().toLowerCase(), B = $("actB"); B.textContent = "";
  for (const r of actRows) {
    if (f && r.action !== f) continue;
    if (q && !((r.actor_email || "") + " " + (r.target || "") + " " + (r.detail || "")).toLowerCase().includes(q)) continue;
    const tr = el("tr"); for (const v of [fmt(r.at), r.actor_email || "System", ACT[r.action] || r.action, r.target || "", r.detail || ""]) { const td = el("td"); td.textContent = v; tr.appendChild(td); } B.appendChild(tr);
  }
  if (!B.children.length) { const tr = el("tr"), td = el("td"); td.colSpan = 5; td.textContent = "Nothing to show yet."; tr.appendChild(td); B.appendChild(tr); }
}
$("actFilter").addEventListener("change", drawActivity); $("actQ").addEventListener("input", drawActivity);

// ---- Problem reports ----
let repRows = [];
async function loadReports(quiet) {
  const { data, error } = await sb.from("problem_reports").select("*").order("at", { ascending: false }).limit(200);
  if (error) { if (!quiet) say("msg", "Could not load reports: " + error.message, "bad"); return; }
  repRows = data || [];
  const open = repRows.filter((r) => r.status === "open").length; $("repN").hidden = !open; $("repN").textContent = open;
  drawReports();
}
function drawReports() {
  const f = $("repFilter").value, L = $("repList"); L.textContent = "";
  for (const r of repRows) {
    if (f && r.status !== f) continue;
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = r.message; sp.textContent = fmt(r.at) + "  |  " + (r.page || "") + (r.contact ? "  |  Contact: " + r.contact : "");
    const det = el("details"), sm = el("summary"), pre = el("pre"); sm.textContent = "Technical details"; pre.textContent = r.details || ""; pre.style.whiteSpace = "pre-wrap"; det.append(sm, pre);
    t.append(b, sp, det);
    const acts = el("div", "acts"); acts.appendChild(abtn(r.status === "open" ? "Mark resolved" : "Reopen", r.status === "open" ? "ok" : "", async () => { const x = await sb.rpc("resolve_report", { p_id: r.id, p_resolved: r.status === "open" }); if (x.error) say("msg", x.error.message, "bad"); else loadReports(); }));
    row.append(t, acts); L.appendChild(row);
  }
  if (!L.children.length) L.textContent = "No reports here.";
}
$("repFilter").addEventListener("change", drawReports);

// ---- System status and backup ----
async function loadStatus() {
  const t0 = performance.now(), { data, error } = await sb.rpc("admin_status"), box = $("statusBody"); box.textContent = "";
  if (error) { box.textContent = "Could not read the status: " + error.message; return; }
  const ms = Math.round(performance.now() - t0);
  for (const [k, v] of [["Database", "Responding (" + ms + " ms)"], ["Last check-in", data.last_checkin ? ago(data.last_checkin) : "none yet"], ["Check-ins in the last 24 hours", data.checkins_24h], ["Classes open right now", data.open_classes], ["Open problem reports", data.open_reports]]) {
    const row = el("div", "absrow"), a = el("span"), b = el("b"); a.textContent = k; b.textContent = v; row.append(a, b); box.appendChild(row);
  }
}
$("backup").addEventListener("click", async () => {
  say("msg", "Preparing the backup. This can take a moment...");
  const sheets = [];
  for (const [name, tbl, ord] of [["Staff", "profiles", "created_at"], ["Classes", "sessions", "created_at"], ["Check-ins", "attendance", "id"], ["Courses", "courses", "id"], ["Rolls", "rolls", "id"], ["Venues", "venues", "id"]]) {
    const { data } = await fetchAllRows(sb, tbl, "*", ord);
    const rows = data || []; if (!rows.length) continue;
    if (tbl === "sessions") rows.forEach((r) => { delete r.secret; });
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    sheets.push({ name, rows: [keys].concat(rows.map((r) => keys.map((k) => { const v = r[k]; return v && typeof v === "object" ? JSON.stringify(v) : v == null ? "" : v; }))) });
  }
  if (!sheets.length) return say("msg", "Nothing to back up yet.", "warn");
  downloadXlsx("KTU backup " + new Date().toLocaleDateString("en-CA"), sheets); say("msg", "Backup downloaded.", "ok");
});

// ---- Copy a class link to paste in a class group ----
async function copyClassLink(s) {
  const link = new URL("index.html?s=" + s.code, location.href).href;
  const ok = await copyText(link), open = new Date(s.closes_at) > new Date();
  toast(ok ? (open ? "Link copied. Paste it in the class group." : "Link copied, but this class has ended.") + (s.rotating ? " Rotating code is on: students also need the screen code." : "") : "Copy failed.", { ms: 8000 });
}
