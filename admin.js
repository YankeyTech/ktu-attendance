const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (i) => document.getElementById(i);
const say = (id, t, k) => { $(id).textContent = t; $(id).className = "msg " + (k || ""); };
let trashedPeople = [], people = [], classes = [], courses = [], nameReqs = [], counts = {}, sort = { lect: ["email", 1], cls: ["created_at", -1] };
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
  for (const t of ["over", "lect", "cls", "roll", "ana", "act", "sus", "rep", "trash", "set"]) $("t-" + t).hidden = t !== b.dataset.t;
  if (b.dataset.t === "roll") loadRolls(); if (b.dataset.t === "ana") loadAnalytics(); if (b.dataset.t === "act") loadActivity(); if (b.dataset.t === "sus") loadSus(); if (b.dataset.t === "set") renderSettings(); if (b.dataset.t === "trash") loadTrash(); if (b.dataset.t === "rep") loadReports();
}));

async function load() {
  const [p, c, a, cr, rq] = await Promise.all([sb.from("profiles").select("*"), fetchAllRows(sb, "sessions", "*", "created_at", false), fetchAllRows(sb, "attendance", "session_id", "id"), sb.from("courses").select("owner,name").order("name"), sb.from("name_requests").select("*").eq("status", "pending").order("created_at")]);
  nameReqs = rq.data || [];
  courses = cr.data || [];
  const allPeople = p.data || []; people = allPeople.filter((x) => !x.deleted_at); trashedPeople = allPeople.filter((x) => x.deleted_at); classes = c.data || []; counts = {};
  for (const r of a.data || []) counts[r.session_id] = (counts[r.session_id] || 0) + 1;
  const byId = Object.fromEntries(allPeople.map((x) => [x.id, x]));
  const nameCount = {}; for (const p of people) if (p.full_name) nameCount[p.full_name.toLowerCase()] = (nameCount[p.full_name.toLowerCase()] || 0) + 1;
  for (const s of classes) { const o = byId[s.owner] || {}; s._owner = o.full_name ? (nameCount[o.full_name.toLowerCase()] > 1 ? o.full_name + " (" + o.email + ")" : o.full_name) : o.email || "-"; if (o.deleted_at) s._owner += " (deleted)"; s._n = counts[s.id] || 0; }
  for (const x of people) { x._classes = classes.filter((s) => s.owner === x.id).length; x._courseText = courses.filter((k) => k.owner === x.id).map((k) => k.name).join(", "); }
  $("stats").innerHTML = "";
  for (const [n, l] of [[people.length, "Staff accounts"], [people.filter((x) => x.role === "lecturer" && x.active).length, "Active lecturers"], [people.filter((x) => x.role === "assistant" && x.active).length, "Teaching assistants"], [nameReqs.length, "Name requests"], [classes.length, "Classes"], [(a.data || []).length, "Check-ins"]]) {
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = 0; countUp(b, n); d.append(b, l); $("stats").appendChild(d);
  }
  fillFilters(); drawL(); drawC(); drawReq(); loadStatus(); loadReports(true); trashCount(); drawAttn();
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
      const mk = (t, f) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.className = "abtn " + (/^(Disable|Delete)/.test(t) ? "bad" : /^Enable/.test(t) ? "ok" : ""); b.addEventListener("click", f); td.appendChild(b); };
      mk("Send reset link", async () => { if (!confirm("Email a password reset link to " + x.email + "?")) return; if (await call({ action: "reset", id: x.id }, "Reset link sent to " + x.email + ".")) load(); });
      mk(x.active ? "Disable" : "Enable", async () => { const r = await sb.functions.invoke("staff-access", { body: { action: "active", id: x.id, active: !x.active } }); fail(r) || load(); });
      mk(x.role === "assistant" ? "Make lecturer" : "Make TA", async () => { const r = await sb.rpc("set_staff_role", { p_email: x.email, p_role: x.role === "assistant" ? "lecturer" : "assistant" }); if (r.error) say("msg", r.error.message, "bad"); else load(); });
      mk("Delete account", async () => {
        if (!confirm("Delete the account of " + x.email + "?\n\nThey can no longer sign in. Their " + x._classes + " class(es), attendance records, courses and rolls are kept. The account goes to the Trash tab for 3 months, where you can restore it or delete it for good.")) return;
        if (await call({ action: "delete", id: x.id }, "Account moved to the Trash: " + x.email + ".")) load();
      });
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
      abtn("Delete", "bad", async () => { if (confirm("Delete this class and all its attendance?\n\nIt goes to the Trash tab and is kept for 3 months, so you can restore it.")) { const x = await sb.from("sessions").delete().eq("id", s.id); if (x.error) say("msg", "Could not delete: " + x.error.message, "bad"); load(); } }));
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
onCatalog(() => { refillSelect($("rlProg"), fillProgSel); refillSelect($("rlLevel"), (s) => fillLevels(s, false)); if ($("t-set") && !$("t-set").hidden) renderSettings(); });
loadCatalog(sb);
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
  const mine = courses.filter((c) => c.owner === id);
  for (const k of mine) add(k.name, k.name);
  if (id) add("__new__", mine.length ? "+ Add a new course…" : "No courses yet: + Add a new course…");
  sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
}
$("rlLect").addEventListener("change", drawRollCourses);
$("rlCourse").addEventListener("change", async () => {
  if ($("rlCourse").value !== "__new__") return;
  const owner = $("rlLect").value, n = (prompt("Name of the new course for " + staffName(owner) + ":") || "").trim().replace(/\s+/g, " ");
  if (n.length < 2) return drawRollCourses();
  const r = await sb.rpc("admin_add_course", { p_owner: owner, p_name: n });
  if (r.error) { drawRollCourses(); return say("rlMsg", "Could not add the course: " + r.error.message, "bad"); }
  if (!courses.some((c) => c.owner === owner && c.name.toLowerCase() === n.toLowerCase())) courses.push({ owner, name: n });
  drawRollCourses(); $("rlCourse").value = (courses.find((c) => c.owner === owner && c.name.toLowerCase() === n.toLowerCase()) || {}).name || "";
  say("rlMsg", "Course added: " + n + ". Now choose the programme, level and file.", "ok");
});
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
    td.appendChild(abtn("Print sheet", "", () => printRollSheet(r)));
    td.appendChild(abtn("Delete", "bad", async () => {
      if (!confirm("Delete the roll for " + r.course + " (" + (r.programme || "no programme") + ", " + (r.level || "level not set") + "), " + r.n + " students, belonging to " + r._who + "?\n\nAttendance records are not affected. The roll goes to the Trash tab for 3 months, so you can restore it.")) return;
      const x = await deleteRollIds(sb, r.ids);
      if (x.error) return say("rlMsg", "Could not delete: " + x.error.message, "bad");
      say("rlMsg", "Roll deleted (" + x.n + " students). It is in the Trash for 3 months.", "ok"); loadRolls();
    }));
    tr.appendChild(td); body.appendChild(tr);
  }
}
$("rlQ").addEventListener("input", drawRolls);
$("rlUp").addEventListener("click", async () => {
  const owner = $("rlLect").value, course = $("rlCourse").value, prog = $("rlProg").value, lvl = $("rlLevel").value, f = $("rlFile").files[0];
  if (!owner) return say("rlMsg", "Choose the lecturer first.", "warn");
  if (!course || course === "__new__") return say("rlMsg", "Choose the course, or pick Add a new course if the lecturer has none.", "warn");
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
  loadBreakdown(); loadAtRisk(); loadLecAct();
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


// ---- Printable course sheet for a saved roll (programme and level) ----
async function printRollSheet(r) {
  say("rlMsg", "Preparing the sheet...");
  const mine = classes.filter((c) => c.owner === r.owner && c.course === r.course && classMatchesGroup(c, r.programme, r.level));
  const [atts, rl] = await Promise.all([mine.length ? fetchAttendance(sb, mine.map((c) => c.id)) : [], sb.from("rolls").select("*").eq("owner", r.owner).eq("course", r.course)]);
  say("rlMsg", "");
  openCourseSheet({ course: r.course, programme: r.programme, level: r.level, lecturer: r._who, classes: mine, atts, roll: rl.data || [] });
}

// ---- Analytics: by programme and level, by course, at-risk, lecturer activity ----
const anArgs = () => ({ p_year: $("anYear").value || null, p_sem: $("anSem").value || null, p_archived: $("anArch").checked });
const emptyRow = (body, cols, txt) => { const r = el("tr"), td = el("td"); td.colSpan = cols; td.textContent = txt; r.appendChild(td); body.appendChild(r); };
const fillRow = (body, vals) => { const r = el("tr"); for (const v of vals) { const td = el("td"); td.textContent = v; r.appendChild(td); } body.appendChild(r); };
let pgRows = [], arRows = [], laRows = [];
async function loadBreakdown() {
  const { data, error } = await sb.rpc("admin_breakdown", anArgs());
  const pg = $("pgB"), co = $("coB"); pg.textContent = ""; co.textContent = "";
  if (error) { emptyRow(pg, 8, "Run upgrade19.sql in Supabase to see this."); emptyRow(co, 7, "Run upgrade19.sql in Supabase to see this."); return; }
  pgRows = (data.groups || []).map((g) => [g.programme, g.level, g.classes, g.checkins, g.students, g.classes ? Math.round((g.checkins / g.classes) * 10) / 10 : 0, pct(g.inr, g.checkins), pct(g.late, g.checkins)]);
  for (const r of pgRows) fillRow(pg, [r[0], r[1], r[2], r[3], r[4], r[5], r[6] + "%", r[7] + "%"]);
  if (!pgRows.length) emptyRow(pg, 8, "No check-ins in this selection.");
  for (const c of data.courses || []) fillRow(co, [c.course, c.full_name || c.email || "-", c.classes, c.checkins, c.students, c.classes ? Math.round((c.checkins / c.classes) * 10) / 10 : 0, pct(c.inr, c.checkins) + "%"]);
  if (!(data.courses || []).length) emptyRow(co, 7, "No classes in this selection.");
}
$("pgX").addEventListener("click", () => downloadXlsx("Attendance by programme and level", [{ name: "By programme and level", rows: [["Programme", "Level", "Classes", "Check-ins", "Students", "Avg per class", "In area %", "Late %"]].concat(pgRows) }]));
async function loadAtRisk() {
  const b = $("arB"); b.textContent = "";
  const { data, error } = await sb.rpc("admin_at_risk", Object.assign({ p_threshold: Number($("arThr").value) || 75, p_min: Number($("arMin").value) || 3 }, anArgs()));
  if (error) return emptyRow(b, 8, "Run upgrade19.sql in Supabase to see this.");
  arRows = (data || []).map((x) => [x.name || "-", x.index_number, x.programme || "-", x.level || "-", x.course, x.lecturer || x.email || "-", x.attended + " of " + x.held, x.pct + "%"]);
  for (const r of arRows) fillRow(b, r);
  if (!arRows.length) emptyRow(b, 8, "No students below the limit. Try a higher percentage.");
  else if (arRows.length >= 1000) emptyRow(b, 8, "Showing the 1,000 lowest. Raise the minimum classes or lower the percentage to narrow it.");
}
$("arGo").addEventListener("click", loadAtRisk);
$("arX").addEventListener("click", () => downloadXlsx("At-risk students", [{ name: "At risk", rows: [["Name", "Index number", "Programme", "Level", "Course", "Lecturer", "Attended", "Rate"]].concat(arRows) }]));
async function loadLecAct() {
  const b = $("laB"); b.textContent = "";
  const { data, error } = await sb.rpc("admin_lecturer_activity");
  if (error) return emptyRow(b, 8, "Run upgrade19.sql in Supabase to see this.");
  const day = (iso) => (iso ? fmt(iso) : "Never");
  laRows = (data || []).map((x) => [x.full_name ? x.full_name + " (" + x.email + ")" : x.email, roleLabel(x.role) + (x.active ? "" : " (disabled)"), day(x.last_sign_in), x.last_class ? fmt(x.last_class) : "-", x.classes_30d, x.checkins_30d, pct(x.inr_30d, x.checkins_30d) + "%", x.classes_total]);
  for (const r of laRows) fillRow(b, r);
  if (!laRows.length) emptyRow(b, 8, "No staff yet.");
}
$("laX").addEventListener("click", () => downloadXlsx("Lecturer activity", [{ name: "Activity", rows: [["Lecturer", "Role", "Last sign-in", "Last class", "Classes (30 days)", "Check-ins (30 days)", "In area %", "Total classes"]].concat(laRows) }]));

// ---- Suspicious activity ----
let susRows = [];
async function loadSus() {
  const cls = Object.fromEntries(classes.map((c) => [c.id, c]));
  const b = $("susB"), g = $("gpsB"); b.textContent = ""; g.textContent = "";
  const { data, error } = await fetchAllRows(sb, "blocked_attempts", "*", "at", false);
  if (error) { emptyRow(b, 7, "Run upgrade19.sql in Supabase to see this."); }
  else {
    susRows = (data || []).map((x) => { const c = cls[x.session_id] || {}; return { x, c, text: [x.student_name, x.index_number, x.device_name, x.device_index, c.course, c._owner].join(" ").toLowerCase() }; });
    $("susN").hidden = true; const pend = susRows.filter((r) => r.x.status === "pending").length; $("susN").textContent = pend; $("susN").hidden = !pend;
    drawSus();
  }
  const r2 = await sb.from("attendance").select("session_id,index_number,student_name,gps_flag,distance_m,checked_in_at").not("gps_flag", "is", null).order("checked_in_at", { ascending: false }).limit(300);
  for (const a of r2.data || []) { const c = cls[a.session_id] || {}; fillRow(g, [fmt(a.checked_in_at), c._owner || "-", c.course || "-", (a.student_name || "-") + " (" + a.index_number + ")", a.gps_flag, Math.round(a.distance_m || 0) + " m"]); }
  if (!(r2.data || []).length) emptyRow(g, 6, "No GPS warnings.");
}
const STATUS = { pending: "Waiting for the lecturer", allowed: "Allowed", rejected: "Rejected" };
function drawSus() {
  const q = $("susQ").value.trim().toLowerCase(), f = $("susFilter").value, b = $("susB"); b.textContent = "";
  const rows = susRows.filter((r) => (!f || r.x.status === f) && (!q || r.text.includes(q)));
  for (const { x, c } of rows) fillRow(b, [fmt(x.at), c._owner || "-", c.course || "-", (x.student_name || "-") + " (" + x.index_number + ")", (x.device_name || "-") + " (" + (x.device_index || "-") + ")", x.distance_m != null ? Math.round(x.distance_m) + " m" : "-", STATUS[x.status] || x.status]);
  if (!rows.length) emptyRow(b, 7, "No same-phone attempts yet.");
}
$("susQ").addEventListener("input", drawSus); $("susFilter").addEventListener("change", drawSus);
$("susX").addEventListener("click", () => downloadXlsx("Same-phone attempts", [{ name: "Attempts", rows: [["When", "Lecturer", "Course", "Student", "Index number", "Phone used by", "Their index number", "Distance (m)", "Decision"]].concat(susRows.map(({ x, c }) => [fmt(x.at), c._owner || "", c.course || "", x.student_name || "", x.index_number, x.device_name || "", x.device_index || "", Math.round(x.distance_m || 0), STATUS[x.status] || x.status])) }]));

// ---- Bulk invite from a spreadsheet ----
$("bulkGo").addEventListener("click", async () => {
  const out = $("bulkOut"), f = $("bulkFile").files[0];
  if (!f) { out.textContent = "Choose a CSV or Excel file first."; return; }
  if (!window.XLSX) { out.textContent = "The Excel library did not load. Check your internet."; return; }
  let rows;
  try { const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }); } catch (e) { out.textContent = "Could not read that file."; return; }
  if (rows.length < 2) { out.textContent = "The file has no rows."; return; }
  const head = rows[0].map((h) => String(h).toLowerCase());
  const col = (re, fb) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fb; };
  const ce = col(/mail/, 0), cn = col(/name/, 1), cr = col(/role|type|position/, -1);
  const have = new Set(people.map((p) => String(p.email || "").toLowerCase())), seen = new Set(), todo = []; let skipped = 0, bad = 0;
  for (const r of rows.slice(1)) {
    const email = String(r[ce] || "").trim().toLowerCase(); if (!email) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad++; continue; }
    if (have.has(email) || seen.has(email)) { skipped++; continue; }
    seen.add(email);
    const name = String(r[cn] || "").trim().replace(/\s+/g, " ").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    todo.push({ email, name: name.length >= 3 ? name : "", role: cr >= 0 && /ta\b|assistant/i.test(String(r[cr])) ? "assistant" : "lecturer" });
  }
  if (!todo.length) { out.textContent = "Nothing to send. " + skipped + " already have accounts, " + bad + " invalid emails."; return; }
  if (todo.length > 100) { out.textContent = "That is " + todo.length + " people. Send at most 100 at a time."; return; }
  if (!confirm("Send " + todo.length + " invite email(s)? " + skipped + " existing account(s) and " + bad + " invalid row(s) will be skipped.")) return;
  $("bulkGo").disabled = true; const failed = []; let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    out.textContent = "Sending " + (i + 1) + " of " + todo.length + "…";
    const r = await sb.functions.invoke("staff-access", { body: { action: "invite", email: todo[i].email, name: todo[i].name, role: todo[i].role } });
    const msg = r.error ? r.error.message : r.data && r.data.error;
    if (msg) { failed.push(todo[i].email + ": " + msg); if (/limit/i.test(msg)) { for (const t of todo.slice(i + 1)) failed.push(t.email + ": not sent (email limit reached)"); break; } } else ok++;
    await new Promise((res) => setTimeout(res, 800));
  }
  $("bulkGo").disabled = false; $("bulkFile").value = "";
  out.textContent = ok + " invite(s) sent." + (failed.length ? " " + failed.length + " not sent: " + failed.join(" | ") : "");
  load();
});


// ---- Settings: programmes and levels ----
const lcn = (x) => String(x).trim().toLowerCase();
async function catChange(promise, okText) {
  const { error } = await promise;
  if (error) return say("setMsg", /catalog/.test(error.message) ? "Run upgrade21.sql in Supabase first." : "Could not save: " + error.message, "bad");
  await loadCatalog(sb); say("setMsg", okText, "ok");
}
async function catRemove(kind, name) {
  const base = catalogBase(), isBase = (kind === "programme" ? base.programmes : base.levels).some((n) => lcn(n) === lcn(name));
  if (!confirm("Hide " + name + " from the lists? Old records keep it, and you can bring it back under Hidden items.")) return;
  await catChange(isBase ? sb.from("catalog").upsert({ kind, name, removed: true }, { onConflict: "kind,name" }) : sb.from("catalog").delete().eq("kind", kind).eq("name", name), name + " hidden.");
}
async function catRestore(kind, name) { await catChange(sb.from("catalog").delete().eq("kind", kind).eq("name", name), name + " restored."); }
async function catAdd(kind, raw, grp) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return say("setMsg", "Type the name first.", "warn");
  const base = catalogBase(), list = kind === "programme" ? base.programmes : base.levels, hit = list.find((n) => lcn(n) === lcn(name));
  const hidden = catalogNow[kind === "programme" ? "programmes" : "levels"].find((x) => lcn(x.name) === lcn(name));
  const active = (kind === "programme" ? PROGRAMMES.flatMap((g) => g.items || []) : ROLL_LEVELS).some((n) => lcn(n) === lcn(name));
  if (active) return say("setMsg", name + " is already in the list.", "warn");
  if (hit || (hidden && hidden.removed)) return catChange(sb.from("catalog").delete().eq("kind", kind).eq("name", hit || hidden.name), (hit || hidden.name) + " is back in the list.");
  await catChange(sb.from("catalog").insert({ kind, name, grp: kind === "programme" ? grp || null : null, removed: false }), name + " added.");
}
function renderSettings() {
  const lv = $("lvList"); lv.textContent = "";
  for (const n of ROLL_LEVELS) { const r = el("div", "setrow"), s = el("span"); s.textContent = n; r.append(s, abtn("Hide", "bad", () => catRemove("level", n))); lv.appendChild(r); }
  const q = lcn($("pgSearch").value), pg = $("pgList"); pg.textContent = "";
  for (const g of PROGRAMMES) {
    const items = (g.items || []).filter((n) => !q || lcn(n).includes(q)); if (!items.length) continue;
    const t = el("div", "setgrp"); t.textContent = g.group; pg.appendChild(t);
    for (const n of items) { const r = el("div", "setrow"), s = el("span"); s.textContent = n; r.append(s, abtn("Hide", "bad", () => catRemove("programme", n))); pg.appendChild(r); }
  }
  const gs = $("pgGrp"), keep = gs.value; gs.textContent = "";
  for (const n of [...new Set(PROGRAMMES.map((g) => g.group).concat(["Added by the admin"]))]) { const o = el("option"); o.value = n; o.textContent = n; gs.appendChild(o); }
  gs.value = Array.from(gs.options).some((o) => o.value === keep) ? keep : "Added by the admin";
  const rm = $("rmList"); rm.textContent = "";
  const hidden = catalogNow.programmes.filter((x) => x.removed).map((x) => ["programme", x.name]).concat(catalogNow.levels.filter((x) => x.removed).map((x) => ["level", x.name]));
  for (const [k, n] of hidden) { const r = el("div", "setrow"), s = el("span"); s.textContent = n + " (" + k + ")"; r.append(s, abtn("Restore", "", () => catRestore(k, n))); rm.appendChild(r); }
  if (!hidden.length) rm.textContent = "Nothing is hidden.";
  const ys = $("roYear"), ky = ys.value; ys.textContent = "";
  const o0 = el("option"); o0.value = ""; o0.textContent = "Choose the year"; ys.appendChild(o0);
  for (const y of [...new Set(classes.map((s) => s.academic_year).filter(Boolean))].sort().reverse()) { const o = el("option"); o.value = y; o.textContent = y; ys.appendChild(o); }
  ys.value = Array.from(ys.options).some((o) => o.value === ky) ? ky : "";
}
$("pgSearch").addEventListener("input", renderSettings);
$("lvAdd").addEventListener("click", async () => { await catAdd("level", $("lvNew").value); $("lvNew").value = ""; });
$("pgAdd").addEventListener("click", async () => { await catAdd("programme", $("pgNew").value, $("pgGrp").value); $("pgNew").value = ""; });

// ---- Semester rollover ----
$("roGo").addEventListener("click", async () => {
  const y = $("roYear").value, sem = $("roSem").value;
  if (!y) return say("roMsg", "Choose the academic year first.", "warn");
  const ids = classes.filter((c) => !c.archived && c.academic_year === y && (!sem || c.semester === sem)).map((c) => c.id);
  if (!ids.length) return say("roMsg", "No active classes found for that term.", "warn");
  if (!confirm("Archive " + ids.length + " class(es) of " + y + (sem ? ", " + sem : "") + "? Nothing is deleted, and you can restore them later.")) return;
  const { data, error } = await sb.rpc("archive_sessions", { p_ids: ids, p_archived: true });
  if (error) return say("roMsg", "Could not archive: " + error.message, "bad");
  say("roMsg", data + " class(es) archived.", "ok"); load();
});

// ---- Backup ----
$("bkGo").addEventListener("click", async () => {
  const out = (t, k) => say("bkMsg", t, k); $("bkGo").disabled = true; out("Collecting the data. This can take a minute for a large database…");
  try {
    const get = async (table, cols, order) => { const r = await fetchAllRows(sb, table, cols, order, true); if (r.error) throw new Error(table + ": " + r.error.message); return r.data || []; };
    const [ses, att, rolls, courses, staff] = await Promise.all([
      get("sessions", "id,created_at,course,programme,level,combined,class_groups,academic_year,semester,code,archived,notes,owner", "created_at"),
      get("attendance", "session_id,index_number,student_name,programme,level,in_range,distance_m,late,manual,note,checked_in_at", "checked_in_at"),
      get("rolls", "owner,course,index_number,student_name,programme,level", "created_at"),
      get("courses", "owner,name", "created_at"),
      get("profiles", "id,email,full_name,role,active,created_at", "created_at")]);
    const who = (id) => staffName(id), cls = Object.fromEntries(ses.map((s) => [s.id, s]));
    const day = new Date().toISOString().slice(0, 10);
    downloadXlsx("KTU attendance backup " + day, [
      { name: "Classes", rows: [["Date", "Course", "Lecturer", "Programme", "Level", "Combined groups", "Academic year", "Semester", "Code", "Archived", "Notes"]].concat(ses.map((s) => [fmt(s.created_at), s.course, who(s.owner), s.programme || "", s.level || "", s.combined ? (s.class_groups || []).map((g) => g.programme + " (" + g.level + ")").join("; ") : "", s.academic_year || "", s.semester || "", s.code, s.archived ? "Yes" : "", s.notes || ""])) },
      { name: "Check-ins", rows: [["Date", "Course", "Lecturer", "Index number", "Name", "Programme", "Level", "In class area", "Distance (m)", "Late", "Added by hand", "Note"]].concat(att.map((a) => { const s = cls[a.session_id] || {}; return [fmt(a.checked_in_at), s.course || "", s.owner ? who(s.owner) : "", a.index_number, a.student_name || "", a.programme || "", a.level || "", a.in_range ? "Yes" : "No", Math.round(a.distance_m || 0), a.late ? "Yes" : "", a.manual ? "Yes" : "", a.note || ""]; })) },
      { name: "Class rolls", rows: [["Lecturer", "Course", "Programme", "Level", "Index number", "Name"]].concat(rolls.map((r) => [who(r.owner), r.course, r.programme || "", r.level || "", r.index_number, r.student_name || ""])) },
      { name: "Courses", rows: [["Lecturer", "Course"]].concat(courses.map((k) => [who(k.owner), k.name])) },
      { name: "Staff", rows: [["Email", "Name", "Role", "Active", "Added"]].concat(staff.map((p) => [p.email || "", p.full_name || "", p.role, p.active ? "Yes" : "No", fmt(p.created_at)])) }]);
    out("Backup downloaded: " + ses.length + " classes, " + att.length + " check-ins, " + rolls.length + " roll entries.", "ok");
  } catch (e) { out("Could not make the backup: " + e.message, "bad"); }
  $("bkGo").disabled = false;
});

// ---- "Needs your attention" chips on the Overview tab ----
function drawAttn() {
  const box = $("attn"); if (!box) return; box.textContent = "";
  const items = [["lect", "Name change requests", nameReqs.length], ["sus", "Phone alerts to review", +($("susN").textContent || 0) * (!$("susN").hidden)], ["rep", "Open problem reports", +($("repN").textContent || 0) * (!$("repN").hidden)], ["trash", "Items in the Trash", +($("trN").textContent || 0) * (!$("trN").hidden)]].filter((x) => x[2] > 0);
  if (!items.length) { const c = document.createElement("span"); c.className = "calm"; c.textContent = "\u2713 All clear. Nothing is waiting for you."; box.appendChild(c); return; }
  for (const [tab, label, n] of items) {
    const b = document.createElement("button"), c = document.createElement("b"); b.type = "button"; c.textContent = n; b.append(c, label);
    b.addEventListener("click", () => document.querySelector('.tabs [data-t="' + tab + '"]').click()); box.appendChild(b);
  }
}
for (const id of ["susN", "repN", "trN"]) new MutationObserver(drawAttn).observe($(id), { attributes: true, childList: true, characterData: true, subtree: true });
setTimeout(drawAttn, 1500);

// ---- Trash: everything deleted is kept 3 months; restore it or delete it for good ----
let trashRows = [];
const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 86400000));
async function trashCount() {
  const r = await sb.rpc("admin_trash_list");
  const n = (r.data || []).length + trashedPeople.length;
  $("trN").hidden = !n; $("trN").textContent = n;
}
async function loadTrash() {
  say("trMsg", "Loading…");
  sb.functions.invoke("staff-access", { body: { action: "purge_expired" } }).catch(() => {});
  const r = await sb.rpc("admin_trash_list");
  if (r.error) return say("trMsg", /function|exist/i.test(r.error.message) ? "Run upgrade22.sql in Supabase first." : r.error.message, "bad");
  const rows = (r.data || []).map((t) => ({ id: t.id, kind: t.kind, label: t.label, detail: t.detail, who: t.owner_name, by: t.deleted_by_name, at: t.deleted_at, exp: t.expires_at }));
  for (const p of trashedPeople) rows.push({ id: p.id, kind: "account", label: p.email, detail: roleLabel(p.role) + (p.full_name ? ": " + p.full_name : ""), who: p.full_name ? p.full_name + " (" + p.email + ")" : p.email, by: "Admin", at: p.deleted_at, exp: new Date(new Date(p.deleted_at).getTime() + 90 * 86400000).toISOString() });
  trashRows = rows.sort((a, b) => new Date(b.at) - new Date(a.at)); say("trMsg", ""); drawTrash();
}
const KIND = { class: "Class", roll: "Class roll", checkins: "Check-ins", course: "Course", venue: "Venue", account: "Account" };
function drawTrash() {
  const q = $("trQ").value.trim().toLowerCase(), k = $("trKind").value, body = $("trB"); body.textContent = "";
  const rows = trashRows.filter((t) => (!k || t.kind === k) && (t.label + " " + (t.detail || "") + " " + t.who).toLowerCase().includes(q));
  if (!rows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 7; td.textContent = "The Trash is empty."; tr.appendChild(td); body.appendChild(tr); return; }
  for (const t of rows) {
    const tr = document.createElement("tr");
    const c = (node) => { const td = document.createElement("td"); td.append(node); tr.appendChild(td); return td; };
    c(fmt(t.at));
    const tag = document.createElement("span"); tag.className = "kindtag" + (t.kind === "account" ? " acct" : ""); tag.textContent = KIND[t.kind]; c(tag);
    const it = document.createElement("div"); const b = document.createElement("b"); b.textContent = t.label; it.append(b);
    if (t.detail) { const d = document.createElement("div"); d.className = "note"; d.textContent = t.detail; it.append(d); } c(it);
    c(t.who); c(t.by);
    const dl = daysLeft(t.exp), sp = document.createElement("span"); sp.textContent = dl + " day" + (dl === 1 ? "" : "s"); if (dl <= 7) sp.className = "expsoon"; c(sp);
    const td = document.createElement("td");
    td.append(abtn("Restore", "ok", () => trashRestore(t)), abtn("Delete forever", "bad", () => trashPurge(t)));
    tr.appendChild(td); body.appendChild(tr);
  }
}
async function trashRestore(t) {
  if (t.kind === "account") { if (await call({ action: "restore_account", id: t.id }, "Account restored: " + t.label + ". They can sign in again.")) { await load(); loadTrash(); } return; }
  const r = await sb.rpc("restore_trash", { p_id: t.id });
  if (r.error) return say("trMsg", r.error.message, "bad");
  if (!r.data.ok) return say("trMsg", r.data.error, "bad");
  say("trMsg", "Restored: " + t.label, "ok"); await load(); loadTrash();
}
async function trashPurge(t) {
  if (!confirm("Delete this for good?\n\n" + t.label + (t.kind === "account" ? "\n\nThe account and ALL its classes, attendance, courses and rolls will be erased. This cannot be undone." : "\n\nThis cannot be undone."))) return;
  if (t.kind === "account") { if (await call({ action: "purge_account", id: t.id }, "Account deleted for good: " + t.label + ".")) { await load(); loadTrash(); } return; }
  const r = await sb.rpc("purge_trash", { p_ids: [t.id] });
  if (r.error) return say("trMsg", r.error.message, "bad");
  say("trMsg", "Deleted for good.", "ok"); loadTrash(); trashCount();
}
$("trEmpty").addEventListener("click", async () => {
  if (!trashRows.length) return;
  if (!confirm("Empty the Trash? Everything in it (" + trashRows.length + " item(s), including deleted accounts) is erased for good.")) return;
  for (const t of trashRows.filter((x) => x.kind === "account")) await sb.functions.invoke("staff-access", { body: { action: "purge_account", id: t.id } });
  const r = await sb.rpc("purge_trash", { p_ids: null });
  if (r.error) return say("trMsg", r.error.message, "bad");
  say("trMsg", "Trash emptied.", "ok"); await load(); loadTrash();
});
$("trQ").addEventListener("input", drawTrash); $("trKind").addEventListener("change", drawTrash);
