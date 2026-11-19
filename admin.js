const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (i) => document.getElementById(i);
const say = (id, t, k) => { $(id).textContent = t; $(id).className = "msg " + (k || ""); };
let attRows = [], trashedPeople = [], people = [], classes = [], courses = [], nameReqs = [], counts = {}, sort = { lect: ["email", 1], cls: ["created_at", -1] };
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
  for (const t of ["over", "inb", "lect", "cls", "roll", "stu", "ana", "term", "act", "sus", "rep", "trash", "tools", "set"]) $("t-" + t).hidden = t !== b.dataset.t;
  if (b.dataset.t === "roll") loadRolls(); if (b.dataset.t === "ana") loadAnalytics(); if (b.dataset.t === "term") initTerm(); if (b.dataset.t === "act") loadActivity(); if (b.dataset.t === "sus") { loadSus(); loadShared(); } if (b.dataset.t === "set") { renderSettings(); loadVenuesAdmin(); } if (b.dataset.t === "trash") loadTrash(); if (b.dataset.t === "stu") $("stIdx").focus(); if (b.dataset.t === "tools") { loadTools(); loadSystem(); } if (b.dataset.t === "inb") loadInbox(); if (b.dataset.t === "rep") loadReports();
}));

async function load() {
  const [p, c, a, cr, rq] = await Promise.all([sb.from("profiles").select("*"), fetchAllRows(sb, "sessions", "*", "created_at", false), fetchAllRows(sb, "attendance", "session_id,checked_in_at,in_range", "id"), sb.from("courses").select("owner,name").order("name"), sb.from("name_requests").select("*").eq("status", "pending").order("created_at")]);
  nameReqs = rq.data || [];
  courses = cr.data || [];
  const allPeople = p.data || []; people = allPeople.filter((x) => !x.deleted_at); trashedPeople = allPeople.filter((x) => x.deleted_at); classes = c.data || []; attRows = a.data || []; counts = {};
  for (const r of a.data || []) counts[r.session_id] = (counts[r.session_id] || 0) + 1;
  const byId = Object.fromEntries(allPeople.map((x) => [x.id, x]));
  const nameCount = {}; for (const p of people) if (p.full_name) nameCount[p.full_name.toLowerCase()] = (nameCount[p.full_name.toLowerCase()] || 0) + 1;
  for (const s of classes) { const o = byId[s.owner] || {}; s._owner = o.full_name ? (nameCount[o.full_name.toLowerCase()] > 1 ? o.full_name + " (" + o.email + ")" : o.full_name) : o.email || "-"; if (o.deleted_at) s._owner += " (deleted)"; s._n = counts[s.id] || 0; }
  for (const x of people) { x._classes = classes.filter((s) => s.owner === x.id).length; x._courseText = courses.filter((k) => k.owner === x.id).map((k) => k.name).join(", "); }
  $("stats").innerHTML = "";
  for (const [n, l] of [[people.length, "Staff accounts"], [people.filter((x) => x.role === "lecturer" && x.active).length, "Active lecturers"], [people.filter((x) => x.role === "assistant" && x.active).length, "Teaching assistants"], [nameReqs.length, "Name requests"], [classes.length, "Classes"], [(a.data || []).length, "Check-ins"]]) {
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = 0; countUp(b, n); d.append(b, l); $("stats").appendChild(d);
  }
  fillFilters(); drawL(); drawC(); drawReq(); loadStatus(); loadReports(true); trashCount(); drawAttn(); loadAnnouncements(); drawOverviewExtras(); drawHours(); startChat(); loadSus().then(loadMsgsAdmin).then(updateInboxBadge).catch(() => {});
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
      mk("Profile", () => openProfile(x));
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
    td.append(abtn("Copy link", "", () => copyClassLink(s)), abtn("Sheet", "", () => adminSheet(s)), abtn("Manage", "", () => manageClass(s)), abtn(s.archived ? "Restore" : "Archive", "", () => archiveSome([s], !s.archived)),
      ...(new Date(s.closes_at) > new Date() ? [abtn("Close now", "ok", async () => { if (!confirm("Close check-in for " + s.course + " now?")) return; const x = await sb.from("sessions").update({ closes_at: new Date().toISOString() }).eq("id", s.id); if (x.error) say("msg", "Could not close: " + x.error.message, "bad"); else { say("msg", "Check-in closed for " + s.course + ".", "ok"); load(); } })] : []),
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
    try { localStorage.setItem("ktu_last_backup", String(Date.now())); } catch (e) {}
    out("Backup downloaded: " + ses.length + " classes, " + att.length + " check-ins, " + rolls.length + " roll entries.", "ok");
  } catch (e) { out("Could not make the backup: " + e.message, "bad"); }
  $("bkGo").disabled = false;
});

// ---- "Needs your attention" chips on the Overview tab ----
function drawAttn() {
  const box = $("attn"); if (!box) return; box.textContent = "";
  let lastBk = 0; try { lastBk = Number(localStorage.getItem("ktu_last_backup") || 0); } catch (e) {}
  const items = [["set", "Time to download a backup (none in the last 14 days)", Date.now() - lastBk > 14 * 86400000 ? 1 : 0], ["lect", "Name change requests", nameReqs.length], ["sus", "Phone alerts to review", +($("susN").textContent || 0) * (!$("susN").hidden)], ["inb", "Alerts and messages waiting for you", +($("inN").textContent || 0) * (!$("inN").hidden)], ["rep", "Open problem reports", +($("repN").textContent || 0) * (!$("repN").hidden)], ["trash", "Items in the Trash", +($("trN").textContent || 0) * (!$("trN").hidden)]].filter((x) => x[2] > 0);
  if (!items.length) { const c = document.createElement("span"); c.className = "calm"; c.textContent = "\u2713 All clear. Nothing is waiting for you."; box.appendChild(c); return; }
  for (const [tab, label, n] of items) {
    const b = document.createElement("button"), c = document.createElement("b"); b.type = "button"; c.textContent = n; b.append(c, label);
    b.addEventListener("click", () => document.querySelector('.tabs [data-t="' + tab + '"]').click()); box.appendChild(b);
  }
}
for (const id of ["susN", "repN", "trN", "inN"]) new MutationObserver(drawAttn).observe($(id), { attributes: true, childList: true, characterData: true, subtree: true });
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


// ---- Student lookup (all classes) ----
$("stGo").addEventListener("click", async () => {
  const idx = $("stIdx").value.trim().toUpperCase(); if (idx.length < 4) return $("stOut").textContent = "Enter the student's index number.";
  $("stOut").textContent = "Looking…";
  try { const res = await lookupStudent(sb, idx, classes); renderLookup($("stOut"), res, (id) => staffName(id), idx); lookupTools(idx, res); } catch (e) { $("stOut").textContent = "Could not look up: " + (e.message || e); }
});
$("stIdx").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("stGo").click(); } });

// ---- Announcements ----
async function loadAnnouncements() {
  const box = $("anList"); if (!box) return; box.textContent = "";
  const { data, error } = await sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(10);
  if (error) { box.textContent = /relation|exist|schema/i.test(error.message) ? "Run upgrade24.sql in Supabase to turn announcements on." : error.message; return; }
  for (const a of data || []) {
    const live = new Date(a.expires_at) > new Date(), row = document.createElement("div"); row.className = "reqrow";
    const t = document.createElement("div"); t.className = "reqtxt"; const b = document.createElement("b"); b.textContent = (a.kind === "warn" ? "Important: " : "") + a.message;
    const sp = document.createElement("span"); sp.textContent = live ? "Shown until " + fmt(a.expires_at) : "Expired " + fmt(a.expires_at); t.append(b, sp);
    const acts = document.createElement("div"); acts.className = "acts";
    acts.append(abtn("Remove", "bad", async () => { const r = await sb.from("announcements").delete().eq("id", a.id); if (r.error) say("anMsg", r.error.message, "bad"); else loadAnnouncements(); }));
    row.append(t, acts); box.appendChild(row);
  }
}
$("anPost").addEventListener("click", async () => {
  const m = $("anText").value.trim(); if (m.length < 3) return say("anMsg", "Write the announcement first.", "warn");
  const r = await sb.from("announcements").insert({ message: m, kind: $("anKind").value, expires_at: new Date(Date.now() + Number($("anDays").value) * 86400000).toISOString() });
  if (r.error) return say("anMsg", /relation|exist|schema/i.test(r.error.message) ? "Run upgrade24.sql in Supabase first." : r.error.message, "bad");
  $("anText").value = ""; say("anMsg", "Posted. Lecturers see it on their Home tab.", "ok"); loadAnnouncements();
});

// ---- Activity log to Excel ----
$("actX").addEventListener("click", () => {
  const f = $("actFilter").value, q = $("actQ").value.trim().toLowerCase();
  const rows = actRows.filter((r) => (!f || r.action === f) && (!q || ((r.actor_email || "") + " " + (r.target || "") + " " + (r.detail || "")).toLowerCase().includes(q)));
  downloadXlsx("Activity log", [{ name: "Activity", rows: [["When", "Who", "Action", "About", "Detail"]].concat(rows.map((r) => [fmt(r.at), r.actor_email || "", ACT[r.action] || r.action, r.target || "", r.detail || ""])) }]);
});

// ---- Tools tab: pause check-ins, health check ----
async function loadTools() {
  const r = await sb.rpc("get_public_settings");
  if (r.error) { say("tlMsg", "Run upgrade25.sql in Supabase first.", "bad"); return; }
  drawPause(r.data); drawTerm(r.data); drawFeatures(r.data.features); loadNotify(); loadBlocked(); loadActivityBoard();
  const d = await sb.rpc("admin_diagnostics");
  const box = $("hcList"); box.textContent = "";
  if (d.error) { box.textContent = d.error.message; return; }
  for (const x of d.data || []) {
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = (x.count ? "⚠ " : "✓ ") + x.label; sp.textContent = x.count ? x.count + " found" : "All good"; t.append(b, sp); row.appendChild(t);
    if (x.count && x.fix) { const a = el("div", "acts"); a.append(abtn(x.fix, "ok", async () => { if (!confirm(x.label + "\n\n" + x.fix + " (" + x.count + ")?")) return; const f = await sb.rpc("admin_fix", { p_kind: x.key }); if (f.error) say("tlMsg", f.error.message, "bad"); else { say("tlMsg", "Done: " + f.data + " item(s) fixed.", "ok"); load(); loadTools(); } })); row.appendChild(a); }
    box.appendChild(row);
  }
}
function drawPause(s) {
  $("pauseState").textContent = s.paused ? "Check-in is PAUSED. Students see your message and cannot check in." : "Check-in is running normally.";
  $("pauseState").className = "msg " + (s.paused ? "bad" : "ok");
  $("pauseBtn").textContent = s.paused ? "Resume check-in" : "Pause all check-ins"; $("pauseBtn").dataset.on = s.paused ? "1" : "";
  if (s.paused && s.message) $("pauseMsg").value = s.message;
}
$("pauseBtn").addEventListener("click", async () => {
  const turnOn = !$("pauseBtn").dataset.on;
  if (turnOn && !confirm("Pause check-in for EVERY class? Students will not be able to check in until you resume.")) return;
  const r = await sb.rpc("admin_set_pause", { p_on: turnOn, p_message: $("pauseMsg").value.trim() });
  if (r.error) return say("tlMsg", r.error.message, "bad");
  drawPause(r.data); say("tlMsg", turnOn ? "Check-in paused." : "Check-in resumed.", "ok");
});
$("hcRun").addEventListener("click", loadTools);

// ---- Current term and blocked students ----
function drawTerm(s) { if ($("termYear") && document.activeElement !== $("termYear")) { $("termYear").value = s.year || ""; $("termSem").value = s.semester || ""; } if ($("termMsg") && !$("termMsg").textContent) say("termMsg", termLine(s), s.year || s.semester ? "ok" : "");}
function termLine(s) { return s.year || s.semester ? "Saved: " + [s.year, s.semester].filter(Boolean).join(", ") + ". Lecturers see this when they start a class." : "No current term is set. Lecturers choose their own."; }
async function saveTerm(y, m) {
  const r = await sb.rpc("admin_set_term", { p_year: y, p_sem: m });
  if (r.error) return say("termMsg", /function|exist/i.test(r.error.message) ? "Run upgrade30.sql in Supabase first." : r.error.message, "bad");
  $("termYear").value = r.data.year || ""; $("termSem").value = r.data.semester || ""; say("termMsg", termLine(r.data), "ok");
}
$("termSave").addEventListener("click", () => saveTerm($("termYear").value.trim(), $("termSem").value));
$("termClear").addEventListener("click", () => { if (confirm("Clear the current term? Lecturers will no longer see it filled in.")) saveTerm("", ""); });
async function loadBlocked() {
  const box = $("blkList"); if (!box) return; box.textContent = "";
  const r = await sb.rpc("admin_list_blocked");
  if (r.error) { box.textContent = "Run upgrade30.sql in Supabase first."; return; }
  if (!(r.data || []).length) { box.textContent = "Nobody is blocked."; return; }
  for (const x of r.data) {
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = (x.kind === "index" ? "Index " : "Phone ") + x.value; sp.textContent = (x.reason ? x.reason + " | " : "") + "blocked " + new Date(x.created_at).toLocaleDateString(); t.append(b, sp);
    const a = el("div", "acts"); a.appendChild(abtn("Unblock", "ok", async () => { const u = await sb.rpc("admin_unblock", { p_id: x.id }); if (u.error) say("tlMsg", u.error.message, "bad"); else loadBlocked(); })); row.append(t, a); box.appendChild(row);
  }
}
async function blockStudent(kind, value, why) {
  const r = await sb.rpc("admin_block", { p_kind: kind, p_value: value, p_reason: why || "" });
  if (r.error || !r.data.ok) return alert(r.error ? (/function|exist/i.test(r.error.message) ? "Run upgrade30.sql in Supabase first." : r.error.message) : r.data.error);
  loadBlocked(); return true;
}
$("blkAdd").addEventListener("click", async () => { if (await blockStudent($("blkKind").value, $("blkVal").value, $("blkWhy").value)) { $("blkVal").value = ""; $("blkWhy").value = ""; say("tlMsg", "Blocked.", "ok"); } });

// ---- Manage a class: edit details, move to another lecturer, fix check-ins ----
async function manageClass(s) {
  const ov = el("div", "rpt"), box = el("div", "rptc"); box.style.width = "min(760px,100%)"; ov.appendChild(box); document.body.appendChild(ov);
  const close = () => { ov.remove(); load(); };
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  async function draw() {
    box.textContent = "";
    const h = el("h3"); h.textContent = "Manage: " + s.course; box.appendChild(h);
    const f = el("div"); f.innerHTML = '<label>Course</label><input id="mcCourse" maxlength="120"><div class="row" id="mcPL"><div><label>Programme</label><select id="mcProg"><option value="">-</option></select></div><div><label>Level</label><select id="mcLevel"></select></div></div><div class="row"><div><label>Academic year</label><input id="mcYear" maxlength="20"></div><div><label>Semester</label><select id="mcSem"><option value="">-</option><option>Semester 1</option><option>Semester 2</option><option>Summer / Resit</option></select></div></div><div class="row"><div><label>Radius (metres)</label><input id="mcRad" type="number" min="20" max="2000"></div><div><label>Lecturer</label><select id="mcOwn"></select></div></div>';
    box.appendChild(f);
    const q = (id) => f.querySelector("#" + id);
    q("mcCourse").value = s.course; q("mcYear").value = s.academic_year || ""; q("mcRad").value = s.radius_m; q("mcSem").value = s.semester || "";
    fillProgSel(q("mcProg")); fillLevelSel(q("mcLevel")); if (s.programme && !Array.from(q("mcProg").options).some((o) => o.value === s.programme)) { const o = el("option"); o.value = o.textContent = s.programme; q("mcProg").appendChild(o); }
    q("mcProg").value = s.programme || ""; if (s.level && !Array.from(q("mcLevel").options).some((o) => o.value === s.level)) { const o = el("option"); o.value = o.textContent = s.level; q("mcLevel").appendChild(o); } q("mcLevel").value = s.level || "";
    if (s.combined) q("mcPL").hidden = true;
    for (const x of people.filter((p) => p.role !== "admin").sort((a, b) => staffName(a.id).localeCompare(staffName(b.id)))) { const o = el("option"); o.value = x.id; o.textContent = staffName(x.id); q("mcOwn").appendChild(o); }
    q("mcOwn").value = s.owner;
    const msg = el("p", "msg"); msg.setAttribute("role", "status");
    const save = el("button", "btn"); save.type = "button"; save.textContent = "Save changes";
    save.addEventListener("click", async () => {
      const r = await sb.rpc("admin_edit_class", { p_id: s.id, p_course: q("mcCourse").value, p_programme: q("mcProg").value, p_level: q("mcLevel").value, p_year: q("mcYear").value, p_sem: q("mcSem").value, p_radius: Number(q("mcRad").value), p_owner: q("mcOwn").value });
      if (r.error) { msg.className = "msg bad"; msg.textContent = r.error.message; return; }
      if (!r.data.ok) { msg.className = "msg bad"; msg.textContent = r.data.error; return; }
      Object.assign(s, { course: q("mcCourse").value.trim(), academic_year: q("mcYear").value.trim() || null, semester: q("mcSem").value || null, radius_m: Number(q("mcRad").value), owner: q("mcOwn").value }); if (!s.combined) { s.programme = q("mcProg").value || null; s.level = q("mcLevel").value || null; }
      msg.className = "msg ok"; msg.textContent = "Saved. If you moved the class to another lecturer, their class roll stays with the old lecturer, so upload or copy it for them.";
    });
    box.append(save, msg);
    const h2 = el("h4", "ch3"); h2.textContent = "Check-ins in this class"; box.appendChild(h2);
    const { data } = await sb.from("attendance").select("id,index_number,student_name,in_range,late,manual,checked_in_at").eq("session_id", s.id).order("checked_in_at");
    const list = el("div", "scrollbox"); list.style.maxHeight = "280px";
    for (const a of data || []) {
      const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span"); b.textContent = (a.student_name || "(no name)") + "  " + a.index_number;
      sp.textContent = (a.in_range ? "In class area" : "Outside area") + (a.late ? ", late" : "") + (a.manual ? ", added by hand" : ""); t.append(b, sp);
      const acts = el("div", "acts"); const run = async (act, val) => { const r = await sb.rpc("admin_edit_checkin", { p_id: a.id, p_action: act, p_value: val || null }); if (r.error || !r.data.ok) { msg.className = "msg bad"; msg.textContent = r.error ? r.error.message : r.data.error; } else draw(); };
      acts.append(abtn("Rename", "", () => { const n = prompt("Name for " + a.index_number + ":", a.student_name || ""); if (n && n.trim().length > 1) run("name", n.trim()); }), abtn(a.in_range ? "Mark outside" : "Mark inside", "", () => run("in_range")), abtn(a.late ? "Not late" : "Mark late", "", () => run("late")), abtn("Remove", "bad", () => { if (confirm("Remove " + a.index_number + " from this class? It goes to the Trash for 3 months.")) run("delete"); }));
      row.append(t, acts); list.appendChild(row);
    }
    if (!(data || []).length) list.textContent = "No check-ins yet."; box.appendChild(list);
    const add = el("div", "bar"); add.innerHTML = '<input id="mcIdx" placeholder="Index number" maxlength="30"><input id="mcNm" placeholder="Student name" maxlength="100">';
    const ab = el("button", "btn quiet"); ab.type = "button"; ab.textContent = "Add student"; add.appendChild(ab);
    ab.addEventListener("click", async () => { const r = await sb.rpc("admin_add_checkin", { p_session: s.id, p_index: add.querySelector("#mcIdx").value, p_name: add.querySelector("#mcNm").value, p_programme: s.programme || "", p_level: s.level || "" }); if (r.error || !r.data.ok) { msg.className = "msg bad"; msg.textContent = r.error ? r.error.message : r.data.error; } else { const nm = add.querySelector("#mcNm").value.trim(), ix = add.querySelector("#mcIdx").value.trim().toUpperCase(); alert("Student added\n\nName: " + nm + "\nIndex number: " + ix + "\nClass: " + s.course + (s.programme ? "\nProgramme: " + s.programme : "") + (s.level ? "\nLevel: " + s.level : "") + "\nMarked: present, added by admin"); draw(); } });
    box.appendChild(add);
    // Excused students for this class
    const eh = el("h4", "ch3"); eh.textContent = "Excused students"; box.appendChild(eh);
    const exl = el("div", "scrollbox"); exl.style.maxHeight = "160px";
    const ex = await sb.from("excuses").select("*").eq("session_id", s.id);
    if (ex.error) exl.textContent = "Run upgrade31.sql in Supabase first."; else if (!(ex.data || []).length) exl.textContent = "Nobody is excused.";
    for (const e of ex.data || []) {
      const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span"); b.textContent = (e.student_name || "-") + "  " + e.index_number; sp.textContent = e.reason || "No reason given"; t.append(b, sp);
      const acts = el("div", "acts"); acts.append(abtn("Undo", "", async () => { await sb.from("excuses").delete().eq("id", e.id); draw(); })); row.append(t, acts); exl.appendChild(row);
    }
    box.appendChild(exl);
    const ea = el("div", "bar"); ea.innerHTML = '<input id="exIdx" placeholder="Index number" maxlength="30"><input id="exWhy" placeholder="Reason (optional)" maxlength="200">';
    const eb = el("button", "btn quiet"); eb.type = "button"; eb.textContent = "Excuse student"; ea.appendChild(eb);
    eb.addEventListener("click", async () => { const i = ea.querySelector("#exIdx").value.trim().toUpperCase(); if (!i) return; const r = await sb.from("excuses").upsert({ session_id: s.id, index_number: i, reason: ea.querySelector("#exWhy").value.trim() || null }, { onConflict: "session_id,index_number" }); if (r.error) { msg.className = "msg bad"; msg.textContent = r.error.message; } else draw(); });
    box.appendChild(ea);
    const nc = el("button", "btn quiet"); nc.type = "button"; nc.textContent = "Give this class a new code"; nc.style.marginTop = "14px"; nc.style.marginRight = "8px";
    nc.addEventListener("click", async () => { if (!confirm("Make a new code for this class? The old code and old QR stop working. People who already checked in are not affected.")) return; const r = await sb.rpc("admin_regen_code", { p_id: s.id }); if (r.error || !r.data.ok) { msg.className = "msg bad"; msg.textContent = r.error ? r.error.message : r.data.error; } else { s.code = r.data.code; msg.className = "msg ok"; msg.textContent = "New code: " + r.data.code; } });
    box.appendChild(nc);
    const cl = el("button", "btn quiet"); cl.type = "button"; cl.textContent = "Close"; cl.style.marginTop = "14px"; cl.addEventListener("click", close); box.appendChild(cl);
  }
  draw();
}

// ---- Student lookup: fix index number / change name ----
function lookupTools(idx, res) {
  const bar = el("div", "bar"); bar.style.marginTop = "12px";
  bar.append(abtn("Fix index number", "", async () => {
    const n = (prompt("The correct index number for " + idx + ":") || "").trim(); if (!n) return;
    if (!confirm("Change " + idx + " to " + n.toUpperCase() + " in every check-in, class roll and phone alert?")) return;
    const r = await sb.rpc("admin_fix_index", { p_old: idx, p_new: n });
    if (r.error || !r.data.ok) return alert(r.error ? r.error.message : r.data.error);
    alert("Done. Check-ins changed: " + r.data.checkins + (r.data.checkins_skipped ? " (" + r.data.checkins_skipped + " skipped because the new number was already in that class)" : "") + ". Roll entries changed: " + r.data.rolls + ".");
    $("stIdx").value = n.toUpperCase(); $("stGo").click(); load();
  }), abtn("Change name everywhere", "", async () => {
    const n = (prompt("The correct name for " + idx + ":", res ? res.name : "") || "").trim(); if (n.length < 2) return;
    const r = await sb.rpc("admin_rename_student", { p_index: idx, p_name: n });
    if (r.error || !r.data.ok) return alert(r.error ? r.error.message : r.data.error);
    alert("Name changed on " + r.data.checkins + " check-in(s) and " + r.data.rolls + " roll entr" + (r.data.rolls === 1 ? "y." : "ies.")); $("stGo").click();
  }), abtn("Block from checking in", "bad", async () => {
    const why = prompt("Block " + idx + " from checking in to any class.\nReason (optional):"); if (why === null) return;
    if (await blockStudent("index", idx, why)) alert(idx + " is blocked. You can unblock in the Tools tab.");
  }));
  $("stOut").appendChild(bar);
}

// ---- Overview: today, live classes, last 14 days ----
function drawOverviewExtras() {
  if (!$("liveBox")) return;
  const now = new Date(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const live = classes.filter((s) => new Date(s.closes_at) > now && new Date(s.opens_at) <= now && !s.archived);
  const todayCls = classes.filter((s) => new Date(s.created_at) >= t0).length, todayIn = attRows.filter((a) => new Date(a.checked_in_at) >= t0).length;
  const st = $("todayStats"); st.textContent = "";
  for (const [n, l] of [[live.length, "Live classes now"], [todayCls, "Classes today"], [todayIn, "Check-ins today"], [attRows.length, "Check-ins in total"]]) { const d = el("div"), b = el("b"); b.textContent = n; d.append(b, l); st.appendChild(d); }
  const box = $("liveBox"); box.textContent = "";
  if (!live.length) { const p = el("p", "note"); p.textContent = "No class is open right now."; box.appendChild(p); }
  for (const s of live) {
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span"), left = Math.max(0, Math.round((new Date(s.closes_at) - now) / 60000));
    b.textContent = s.course; sp.textContent = (staffName(s.owner) || "") + " | " + (counts[s.id] || 0) + " checked in | " + left + " min left"; t.append(b, sp);
    const a = el("div", "acts"); a.append(abtn("Sheet", "", () => adminSheet(s)), abtn("Manage", "", () => manageClass(s)), abtn("Close now", "bad", async () => { if (!confirm("Close check-in for " + s.course + " now?")) return; const x = await sb.from("sessions").update({ closes_at: new Date().toISOString() }).eq("id", s.id); if (x.error) alert(x.error.message); else load(); }));
    row.append(t, a); box.appendChild(row);
  }
  const c = $("chDay"); c.textContent = "";
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(t0); d.setDate(d.getDate() - i); days.push({ d, n: 0, inr: 0 }); }
  for (const a of attRows) { const k = Math.floor((new Date(a.checked_in_at) - days[0].d) / 86400000); if (k >= 0 && k < 14) { days[k].n++; if (a.in_range) days[k].inr++; } }
  const max = Math.max(1, ...days.map((x) => x.n));
  for (const r of days) {
    const col = el("div", "vcol"), num = el("span", "vnum"), track = el("div", "vtrack"), bar = el("div", "vbar"), inn = el("div", "vin"), lab = el("span", "vlab");
    num.textContent = r.n; bar.style.height = (r.n ? Math.max(4, (r.n / max) * 100) : 0) + "%"; inn.style.height = (r.n ? (r.inr / r.n) * 100 : 0) + "%";
    lab.textContent = r.d.toLocaleDateString([], { day: "numeric", month: "short" }); col.title = r.n + " check-in(s), " + r.inr + " in the class area";
    bar.appendChild(inn); track.appendChild(bar); col.append(num, track, lab); c.appendChild(col);
  }
}
setInterval(() => { if ($("t-over") && !$("t-over").hidden) drawOverviewExtras(); }, 30000);

// ---- Shared venues (visible to every lecturer) ----
async function loadVenuesAdmin() {
  const box = $("svList"); if (!box) return; box.textContent = "";
  const { data, error } = await sb.from("shared_venues").select("*").order("name");
  if (error) { box.textContent = /relation|exist|schema/i.test(error.message) ? "Run upgrade26.sql in Supabase to turn shared venues on." : error.message; return; }
  if (!(data || []).length) { const p = el("p", "note"); p.textContent = "No shared venues yet."; box.appendChild(p); }
  for (const v of data || []) {
    const r = el("div", "setrow"), s = el("span"); s.textContent = v.name + "  (" + Number(v.lat).toFixed(5) + ", " + Number(v.lng).toFixed(5) + (v.radius_m ? ", " + v.radius_m + " m" : "") + ")";
    r.append(s, abtn("Remove", "bad", async () => { if (!confirm("Remove the venue " + v.name + "? Lecturers will no longer see it. Classes already created are not affected.")) return; const x = await sb.from("shared_venues").delete().eq("id", v.id); if (x.error) say("svMsg", x.error.message, "bad"); else loadVenuesAdmin(); }));
    box.appendChild(r);
  }
}
$("svHere").addEventListener("click", () => {
  if (!navigator.geolocation) return say("svMsg", "This browser cannot give a location.", "warn");
  say("svMsg", "Getting your position… stand in the room and wait a few seconds.");
  navigator.geolocation.getCurrentPosition((p) => { $("svLat").value = p.coords.latitude.toFixed(6); $("svLng").value = p.coords.longitude.toFixed(6); say("svMsg", "Position filled in (accurate to about " + Math.round(p.coords.accuracy) + " m).", "ok"); }, () => say("svMsg", "Could not get your position. Allow location, or type the numbers.", "bad"), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
});
$("svAdd").addEventListener("click", async () => {
  const name = $("svName").value.trim(), lat = Number($("svLat").value), lng = Number($("svLng").value), rad = Number($("svRad").value) || null;
  if (name.length < 2 || !$("svLat").value || !$("svLng").value || !isFinite(lat) || !isFinite(lng)) return say("svMsg", "Enter a name and the position (or use My position).", "warn");
  const r = await sb.from("shared_venues").insert({ name, lat, lng, radius_m: rad });
  if (r.error) return say("svMsg", /relation|exist|schema/i.test(r.error.message) ? "Run upgrade26.sql in Supabase first." : r.error.message, "bad");
  for (const id of ["svName", "svLat", "svLng"]) $(id).value = ""; say("svMsg", "Venue added. Lecturers can pick it on their Home tab.", "ok"); loadVenuesAdmin();
});

// ---- Sidebar icons ----
(function icons() {
  const P = { inb: "M4 4h16v12h-5l-2 3h-2l-2-3H4z", over: "M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z", lect: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0", cls: "M4 5h16v14H4zM4 10h16", roll: "M7 3h10v18H7zM10 8h4M10 12h4", stu: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5", term: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5", ana: "M4 20V10M10 20V4M16 20v-8M22 20H2", act: "M3 12h4l3-8 4 16 3-8h4", sus: "M12 3l9 16H3zM12 10v4M12 17v.5", rep: "M5 21V4h11l-1 4h5v9H9l-1-3H5", trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14", tools: "M14 6l4 4-9 9H5v-4zM13 7l4 4", set: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3" };
  for (const b of document.querySelectorAll(".tabs [data-t]")) {
    const d = P[b.dataset.t]; if (!d || b.querySelector("svg")) continue;
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); s.appendChild(p); b.prepend(s);
  }
})();

// ---- Inbox: decide lecturers' alerts for them ----
let reviewRows = [];
async function loadInbox() {
  say("inMsg", "Loading…");
  const st = await sb.rpc("get_public_settings");
  if (!st.error && st.data) drawPopupState(st.data);
  await loadSus();
  const cls = Object.fromEntries(classes.map((c) => [c.id, c])), live = new Set(classes.filter((c) => !c.archived).map((c) => c.id));
  const r = await sb.from("attendance").select("id,session_id,index_number,student_name,distance_m,gps_flag,checked_in_at,in_range,reviewed").eq("in_range", false).order("checked_in_at", { ascending: false }).limit(400);
  reviewRows = (r.data || []).filter((a) => !a.reviewed && live.has(a.session_id)).map((a) => ({ a, c: cls[a.session_id] || {} }));
  await loadMsgsAdmin(); say("inMsg", ""); drawInbox(); drawMsgThreads(); updateInboxBadge();
}
function pendingPhone() { return susRows.filter((r) => r.x.status === "pending"); }
function updateInboxBadge() { const n = pendingPhone().length + reviewRows.length + unreadMsgs(); const b = $("inN"); b.hidden = !n; b.textContent = n; }
function drawPopupState(s) {
  const on = s.popups !== false; $("popState").textContent = on ? "Popups are ON: lecturers see phone-alert popups on their own page." : "Popups are OFF: lecturers do not see phone-alert popups. You decide them here.";
  $("popState").className = "msg " + (on ? "ok" : "warn"); $("popBtn").textContent = on ? "Turn popups off for everyone" : "Turn popups back on"; $("popBtn").dataset.on = on ? "1" : "";
}
$("popBtn").addEventListener("click", async () => {
  const to = !$("popBtn").dataset.on; if (!to && !confirm("Turn the phone-alert popups OFF on every lecturer page? You will have to decide the alerts here.")) return;
  const r = await sb.rpc("admin_set_popups", { p_on: to }); if (r.error) return say("inMsg", /function|exist/i.test(r.error.message) ? "Run upgrade27.sql in Supabase first." : r.error.message, "bad"); drawPopupState(r.data);
});
function lookIdx(idx) { document.querySelector('.tabs [data-t="stu"]').click(); $("stIdx").value = idx; $("stGo").click(); }
async function decideOne(x, allow) {
  const r = await sb.rpc("resolve_blocked", { p_id: x.id, p_allow: allow });
  if (r.error || (r.data && r.data.error)) return say("inMsg", r.error ? r.error.message : r.data.error, "bad");
  say("inMsg", (allow ? "Allowed: " : "Rejected: ") + (x.student_name || x.index_number), "ok"); await load(); loadInbox();
}
function drawInbox() {
  const box = $("inPhone"); box.textContent = "";
  const byOwner = new Map(); for (const r of pendingPhone()) { const k = r.c.owner || "?"; if (!byOwner.has(k)) byOwner.set(k, []); byOwner.get(k).push(r); }
  if (!byOwner.size) { const p = el("p", "calm"); p.textContent = "✓ No phone alerts are waiting."; box.appendChild(p); }
  for (const [owner, list] of byOwner) {
    const prof = people.find((p) => p.id === owner) || {}, g = el("div", "inbox");
    const hd = el("div", "inhead"), nm = el("b"); nm.textContent = staffName(owner) + "  (" + list.length + ")"; hd.appendChild(nm);
    const ac = el("div", "acts");
    ac.append(abtn("Allow all", "ok", async () => { if (!confirm("Allow all " + list.length + " waiting alerts of " + staffName(owner) + "?")) return; const r = await sb.rpc("admin_decide_all", { p_owner: owner, p_allow: true }); if (r.error) say("inMsg", r.error.message, "bad"); else { say("inMsg", r.data + " alert(s) allowed.", "ok"); await load(); loadInbox(); } }),
      abtn("Reject all", "bad", async () => { if (!confirm("Reject all " + list.length + " waiting alerts of " + staffName(owner) + "?")) return; const r = await sb.rpc("admin_decide_all", { p_owner: owner, p_allow: false }); if (r.error) say("inMsg", r.error.message, "bad"); else { say("inMsg", r.data + " alert(s) rejected.", "ok"); await load(); loadInbox(); } }),
      abtn(prof.alerts_by_admin ? "Hand alerts back" : "Take over alerts", "", async () => { const to = !prof.alerts_by_admin; const r = await sb.rpc("admin_set_alerts_by_admin", { p_id: owner, p_on: to }); if (r.error) return say("inMsg", r.error.message, "bad"); prof.alerts_by_admin = to; say("inMsg", to ? staffName(owner) + " no longer gets alert popups. You decide them." : "Alerts handed back to " + staffName(owner) + ".", "ok"); load().then(drawInbox); }));
    hd.appendChild(ac); g.appendChild(hd);
    if (prof.alerts_by_admin) { const n = el("p", "note"); n.textContent = "You are handling this lecturer's alerts. Their popups are off."; g.appendChild(n); }
    for (const { x, c } of list) {
      const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
      b.textContent = (x.student_name || "-") + "  (" + x.index_number + ")";
      sp.textContent = (c.course || "-") + " | " + fmt(x.at) + " | phone already used by " + (x.device_name || "-") + (x.device_index ? " (" + x.device_index + ")" : "") + " | " + (x.in_range === false ? "OUTSIDE the class area" : "inside the class area") + (x.distance_m != null ? ", " + Math.round(x.distance_m) + " m" : "");
      t.append(b, sp); const a = el("div", "acts");
      a.append(abtn("Allow", "ok", () => decideOne(x, true)), abtn("Reject", "bad", () => decideOne(x, false)), abtn("Look up", "", () => lookIdx(x.index_number)));
      row.append(t, a); g.appendChild(row);
    }
    box.appendChild(g);
  }
  const rv = $("inReview"); rv.textContent = "";
  if (!reviewRows.length) { const p = el("p", "calm"); p.textContent = "✓ No outside-area check-ins are waiting for review."; rv.appendChild(p); }
  const by2 = new Map(); for (const r of reviewRows) { const k = r.c.owner || "?"; if (!by2.has(k)) by2.set(k, []); by2.get(k).push(r); }
  for (const [owner, list] of by2) {
    const g = el("div", "inbox"), hd = el("div", "inhead"), nm = el("b"); nm.textContent = staffName(owner) + "  (" + list.length + ")"; hd.appendChild(nm); g.appendChild(hd);
    for (const { a, c } of list) {
      const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
      b.textContent = (a.student_name || "-") + "  (" + a.index_number + ")"; sp.textContent = (c.course || "-") + " | " + fmt(a.checked_in_at) + " | " + (a.distance_m != null ? Math.round(a.distance_m) + " m away" : "outside the class area") + (a.gps_flag ? " | " + a.gps_flag : "");
      t.append(b, sp); const ac = el("div", "acts");
      const run = async (act, msg) => { const r = await sb.rpc("admin_review_checkin", { p_id: a.id, p_action: act }); if (r.error || !r.data.ok) say("inMsg", r.error ? r.error.message : r.data.error, "bad"); else { say("inMsg", msg + ": " + a.index_number, "ok"); await load(); loadInbox(); } };
      ac.append(abtn("Accept as present", "ok", () => run("accept", "Accepted")), abtn("Keep outside", "", () => run("keep", "Kept outside")), abtn("Remove", "bad", () => { if (confirm("Remove " + a.index_number + " from this class? It goes to the Trash.")) run("remove", "Removed"); }), abtn("Look up", "", () => lookIdx(a.index_number)));
      row.append(t, ac); g.appendChild(row);
    }
    rv.appendChild(g);
  }
  const dn = $("inDone"); dn.textContent = "";
  for (const { x, c } of susRows.filter((r) => r.x.status !== "pending").slice(0, 15)) {
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = (x.student_name || "-") + "  (" + x.index_number + ")"; sp.textContent = (c.course || "-") + " | " + (x.status === "allowed" ? "Allowed" : "Rejected") + (x.decided_at ? " " + fmt(x.decided_at) : ""); t.append(b, sp);
    const a = el("div", "acts"); a.append(abtn("Reopen", "", async () => { const r = await sb.rpc("admin_reopen_blocked", { p_id: x.id }); if (r.error || !r.data.ok) say("inMsg", r.error ? r.error.message : r.data.error, "bad"); else { say("inMsg", "Reopened. It is waiting again.", "ok"); await load(); loadInbox(); } }));
    row.append(t, a); dn.appendChild(row);
  }
  if (!dn.children.length) { const p = el("p", "note"); p.textContent = "No decisions yet."; dn.appendChild(p); }
}

// ---- Lecturer profile: 360 view, permissions, private message ----
async function openProfile(x) {
  const ov = el("div", "rpt"), box = el("div", "rptc"); box.style.width = "min(780px,100%)"; ov.appendChild(box); document.body.appendChild(ov);
  const close = () => { ov.remove(); load(); }; ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const mine = classes.filter((c) => c.owner === x.id), nIn = mine.reduce((n, c) => n + (counts[c.id] || 0), 0), myCourses = courses.filter((c) => c.owner === x.id);
  const perms = x.perms || {}, off = (k) => perms[k] === false || perms[k] === "false";
  const h = el("h3"); h.textContent = (x.full_name || x.email) + (x.role === "assistant" ? "  (Teaching assistant)" : "  (Lecturer)"); box.appendChild(h);
  const sub = el("p", "note"); sub.textContent = x.email + (x.active ? "" : "  |  DISABLED") + (x.alerts_by_admin ? "  |  alerts handled by admin" : ""); box.appendChild(sub);
  const st = el("div", "stats");
  for (const [n, l] of [[mine.length, "Classes"], [nIn, "Check-ins"], [myCourses.length, "Courses"], [mine.length ? fmt(mine[0].created_at).split(",")[0] : "-", "Last class"]]) { const d = el("div"), b = el("b"); b.textContent = n; d.append(b, l); st.appendChild(d); }
  box.appendChild(st);
  const h2 = el("h4", "ch3"); h2.textContent = "What this person is allowed to do"; box.appendChild(h2);
  const pf = el("div"); pf.innerHTML = '<label class="chk"><input type="checkbox" id="pmUp"> Upload class rolls</label><label class="chk"><input type="checkbox" id="pmDel"> Delete class rolls</label><label class="chk"><input type="checkbox" id="pmVen"> Save their own venues</label><label for="pmMax">Longest class they may start (minutes, empty = no limit)</label><input id="pmMax" type="number" min="5" max="1440" placeholder="e.g. 120">';
  box.appendChild(pf); pf.querySelector("#pmUp").checked = !off("upload_rolls"); pf.querySelector("#pmDel").checked = !off("delete_rolls"); pf.querySelector("#pmVen").checked = !off("save_venues"); pf.querySelector("#pmMax").value = perms.max_minutes || "";
  const msg = el("p", "msg"); msg.setAttribute("role", "status");
  const sv = el("button", "btn quiet"); sv.type = "button"; sv.textContent = "Save permissions";
  sv.addEventListener("click", async () => {
    const p = { upload_rolls: pf.querySelector("#pmUp").checked, delete_rolls: pf.querySelector("#pmDel").checked, save_venues: pf.querySelector("#pmVen").checked }; const m = pf.querySelector("#pmMax").value.trim(); if (m) p.max_minutes = Number(m);
    const r = await sb.rpc("admin_set_perms", { p_id: x.id, p_perms: p }); if (r.error) { msg.className = "msg bad"; msg.textContent = /function|exist/i.test(r.error.message) ? "Run upgrade28.sql in Supabase first." : r.error.message; return; }
    x.perms = r.data.perms; msg.className = "msg ok"; msg.textContent = "Saved. It applies the next time they use the page.";
  }); box.append(sv, msg);
  const h3 = el("h4", "ch3"); h3.textContent = "Send a private message"; box.appendChild(h3);
  const ta = el("textarea"); ta.maxLength = 500; ta.rows = 2; ta.placeholder = "Only " + (x.full_name || x.email) + " will see this on their Home tab."; box.appendChild(ta);
  const mb = el("button", "btn quiet"); mb.type = "button"; mb.textContent = "Send message";
  mb.addEventListener("click", async () => { const m = ta.value.trim(); if (m.length < 3) return; const r = await sb.from("announcements").insert({ message: m, kind: "info", target: x.id, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }); msg.className = r.error ? "msg bad" : "msg ok"; msg.textContent = r.error ? (/target|column/i.test(r.error.message) ? "Run upgrade28.sql in Supabase first." : r.error.message) : "Message sent. It shows for 7 days."; if (!r.error) ta.value = ""; });
  box.append(mb);
  const h4 = el("h4", "ch3"); h4.textContent = "Recent classes"; box.appendChild(h4);
  const list = el("div", "scrollbox"); list.style.maxHeight = "220px";
  for (const s of mine.slice(0, 12)) { const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span"); b.textContent = s.course; sp.textContent = fmt(s.created_at) + " | " + (counts[s.id] || 0) + " check-ins" + (s.archived ? " | archived" : ""); t.append(b, sp); const a = el("div", "acts"); a.append(abtn("Sheet", "", () => adminSheet(s)), abtn("Manage", "", () => { ov.remove(); manageClass(s); })); row.append(t, a); list.appendChild(row); }
  if (!mine.length) list.textContent = "No classes yet."; box.appendChild(list);
  const cl = el("button", "btn quiet"); cl.type = "button"; cl.textContent = "Close"; cl.style.marginTop = "14px"; cl.addEventListener("click", close); box.appendChild(cl);
}

// ---- Tools: database size and counts ----
async function loadSystem() {
  const r = await sb.rpc("admin_system_stats"), box = $("sysBox"); if (!box) return; box.textContent = "";
  if (r.error) { box.textContent = /function|exist/i.test(r.error.message) ? "Run upgrade28.sql in Supabase to see this." : r.error.message; return; }
  const s = r.data, mb = s.db_bytes / 1048576, pct = Math.min(100, (mb / 500) * 100);
  const p = el("p"); p.innerHTML = ""; p.textContent = "Database size: " + mb.toFixed(1) + " MB of the 500 MB free allowance (" + pct.toFixed(1) + "%)."; box.appendChild(p);
  const bar = el("div", "bar2" + (pct > 80 ? " low" : "")), i = el("i"); i.style.width = Math.max(1, pct) + "%"; bar.appendChild(i); box.appendChild(bar);
  const q = el("p", "note"); q.textContent = s.staff + " accounts, " + s.sessions + " classes, " + s.attendance + " check-ins, " + s.rolls + " roll entries, " + s.trash + " items in the Trash, " + s.audit + " activity records."; box.appendChild(q);
}

// ---- Messages from lecturers ----
let msgAll = [];
async function loadMsgsAdmin() {
  const { data, error } = await sb.from("staff_messages").select("*").order("created_at", { ascending: false }).limit(600);
  if (error) { msgAll = []; return error; }
  msgAll = data || []; return null;
}
const unreadMsgs = () => msgAll.filter((m) => m.sender === "staff" && !m.read_by_admin).length;
function drawMsgThreads() {
  const box = $("inMsgs"); box.textContent = "";
  const by = new Map(); for (const m of msgAll) { if (!by.has(m.thread_owner)) by.set(m.thread_owner, []); by.get(m.thread_owner).push(m); }
  if (!by.size) { const p = el("p", "note"); p.textContent = "No messages from lecturers yet."; box.appendChild(p); return; }
  for (const [owner, list] of by) {
    const un = list.filter((m) => m.sender === "staff" && !m.read_by_admin).length, last = list[0];
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = staffName(owner) + (un ? "  (" + un + " new)" : ""); sp.textContent = (last.sender === "admin" ? "You: " : "") + last.body.slice(0, 120) + " | " + fmt(last.created_at); t.append(b, sp);
    const a = el("div", "acts"); a.append(abtn(un ? "Read and reply" : "Open", un ? "ok" : "", () => openThread(owner))); row.append(t, a); box.appendChild(row);
  }
}
function openThread(owner) { KtuChat.open(owner); }

// ---- Overview: when students check in ----
function drawHours() {
  const box = $("chHour"); if (!box) return; box.textContent = "";
  const hrs = new Array(24).fill(0), dow = new Array(7).fill(0);
  for (const a of attRows) { const d = new Date(a.checked_in_at); hrs[d.getHours()]++; dow[(d.getDay() + 6) % 7]++; }
  const mk = (arr, labels, target) => {
    const max = Math.max(1, ...arr);
    arr.forEach((n, i) => { const col = el("div", "vcol"), num = el("span", "vnum"), track = el("div", "vtrack"), bar = el("div", "vbar"), lab = el("span", "vlab"); num.textContent = n || ""; bar.style.height = n ? Math.max(4, (n / max) * 100) + "%" : "0"; bar.style.background = "var(--blue)"; lab.textContent = labels[i]; col.title = n + " check-in(s)"; track.appendChild(bar); col.append(num, track, lab); target.appendChild(col); });
  };
  mk(dow, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], box);
  const b2 = $("chHour2"); b2.textContent = ""; mk(hrs.slice(6, 21), Array.from({ length: 15 }, (_, i) => String(i + 6)), b2);
}

// ---- Messages: the chat button (chat.js) ----
let chatOn = false;
function startChat() {
  if (chatOn) return; chatOn = true;
  KtuChat.init(sb, { mode: "admin", nameOf: (id) => staffName(id), onChange: () => loadMsgsAdmin().then(() => { drawMsgThreads(); updateInboxBadge(); }), onUnread: () => loadMsgsAdmin().then(() => { drawMsgThreads(); updateInboxBadge(); }) });
}

// ---- Command palette: Ctrl+K (or /) to jump anywhere, open a lecturer, or look up a student ----
function openPalette() {
  if (document.querySelector(".palette")) return;
  const ov = el("div", "rpt palette"), box = el("div", "rptc"); ov.appendChild(box); document.body.appendChild(ov);
  const inp = el("input"); inp.placeholder = "Type a section, a lecturer, a course or an index number"; inp.setAttribute("aria-label", "Search the admin page"); inp.setAttribute("role", "combobox"); inp.setAttribute("aria-expanded", "true");
  const ul = el("ul"); ul.setAttribute("role", "listbox"); const hint = el("div", "hint"); hint.textContent = "Up and Down to choose, Enter to open, Esc to close.";
  box.append(inp, ul, hint); let items = [], cur = 0;
  const close = () => ov.remove(); ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  const tabs = Array.from(document.querySelectorAll(".tabs [data-t]")).map((b) => ({ label: b.textContent.replace(/\d+$/, "").trim(), k: "Section", run: () => b.click() }));
  function build() {
    const q = inp.value.trim().toLowerCase(), out = [];
    for (const t of tabs) if (!q || t.label.toLowerCase().includes(q)) out.push(t);
    if (q) {
      for (const x of people.filter((p) => (p.email + " " + (p.full_name || "")).toLowerCase().includes(q)).slice(0, 6)) out.push({ label: staffName(x.id), k: "Lecturer profile", run: () => openProfile(x) });
      for (const c of [...new Set(courses.map((c) => c.name))].filter((n) => n.toLowerCase().includes(q)).slice(0, 4)) out.push({ label: c, k: "Classes of this course", run: () => { document.querySelector('.tabs [data-t="cls"]').click(); const f = $("cq") || document.querySelector("#t-cls input"); if (f) { f.value = c; f.dispatchEvent(new Event("input")); } } });
      const idx = inp.value.trim().toUpperCase(); if (/^[A-Z0-9\/\-]{4,30}$/.test(idx) && /\d/.test(idx)) out.push({ label: "Look up student " + idx, k: "Student", run: () => { document.querySelector('.tabs [data-t="stu"]').click(); $("stIdx").value = idx; $("stGo").click(); } });
    }
    items = out.slice(0, 12); cur = 0; draw();
  }
  function draw() { ul.textContent = ""; items.forEach((it, i) => { const li = el("li"), b = el("button"); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(i === cur)); b.append(it.label); const s = el("small"); s.textContent = it.k; b.appendChild(s); b.addEventListener("click", () => { close(); it.run(); }); li.appendChild(b); ul.appendChild(li); }); if (!items.length) { const li = el("li"); li.textContent = "Nothing found."; li.style.padding = "12px"; ul.appendChild(li); } }
  inp.addEventListener("input", build);
  inp.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); cur = Math.min(items.length - 1, cur + 1); draw(); } else if (e.key === "ArrowUp") { e.preventDefault(); cur = Math.max(0, cur - 1); draw(); } else if (e.key === "Enter" && items[cur]) { e.preventDefault(); close(); items[cur].run(); } });
  build();
}
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) || e.target.isContentEditable;
  if (($("app") && $("app").hidden) || document.querySelector(".rpt")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
  else if (e.key === "/" && !typing) { e.preventDefault(); openPalette(); }
});


// ---- Phones used by several students, and lecturer activity ----
async function loadShared() {
  const box = $("shList"); box.textContent = "Loading...";
  const r = await sb.rpc("admin_shared_devices", { p_days: Number($("shDays").value) });
  box.textContent = "";
  if (r.error) { box.textContent = /function|exist/i.test(r.error.message) ? "Run upgrade31.sql in Supabase first." : r.error.message; return; }
  if (!(r.data || []).length) { box.textContent = "No phone was used by more than one student in this period."; return; }
  for (const x of r.data) {
    const row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = x.students + " students on one phone, in " + x.classes + " class" + (x.classes === 1 ? "" : "es");
    sp.textContent = (x.names || []).slice(0, 6).join(", ") + (x.names.length > 6 ? "..." : "") + " | last " + new Date(x.last_at).toLocaleString(); t.append(b, sp);
    const a = el("div", "acts");
    a.append(abtn("Look up first student", "", () => { const i = (x.indexes || [])[0]; if (!i) return; document.querySelector('[data-t="stu"]').click(); $("stIdx").value = i; $("stGo").click(); }),
      abtn("Block this phone", "bad", async () => { if (!confirm("Block this phone from checking in to any class?")) return; const why = "Used by " + x.students + " students"; if (await blockStudent("device", x.device, why)) loadShared(); }));
    row.append(t, a); box.appendChild(row);
  }
}
$("shDays").addEventListener("change", loadShared);
async function loadActivityBoard() {
  const box = $("laList"); if (!box) return; box.textContent = "";
  const r = await sb.rpc("admin_lecturer_activity", { p_days: Number($("laDays").value) });
  if (r.error) { box.textContent = /function|exist/i.test(r.error.message) ? "Run upgrade31.sql in Supabase first." : r.error.message; return; }
  const rows = (r.data || []).sort((a, b) => b.checkins - a.checkins);
  const tb = el("table"), th = el("thead"), hr = el("tr");
  for (const h of ["Lecturer", "Classes", "Check-ins", "Last class", "Last seen"]) { const c = el("th"); c.textContent = h; hr.appendChild(c); }
  th.appendChild(hr); tb.appendChild(th); const body = el("tbody");
  for (const x of rows) {
    const tr = el("tr"); const f = (d) => (d ? new Date(d).toLocaleDateString() : "never");
    for (const v of [staffName(x.id), x.classes, x.checkins, f(x.last_class), f(x.last_seen)]) { const c = el("td"); c.textContent = v; tr.appendChild(c); }
    body.appendChild(tr);
  }
  tb.appendChild(body); const w = el("div", "table-wrap"); w.appendChild(tb); box.appendChild(w);
}
$("laDays").addEventListener("change", loadActivityBoard);


// ---- Term report ----
let trRows = [];
function initTerm() {
  const fill = (sel, vals, all) => { const keep = sel.value; sel.textContent = ""; if (all) { const o = el("option"); o.value = ""; o.textContent = "All"; sel.appendChild(o); } for (const v of vals) { const o = el("option"); o.value = o.textContent = v; sel.appendChild(o); } if ([...sel.options].some((o) => o.value === keep)) sel.value = keep; };
  const uniq = (k) => [...new Set(classes.map((c) => c[k]).filter(Boolean))].sort();
  fill($("trCourse"), uniq("course"), false); fill($("trYear"), uniq("academic_year").reverse(), true);
  fillProgSel($("trProg")); fillLevelSel($("trLevel"));
}
$("trRun").addEventListener("click", async () => {
  if (!$("trCourse").value) return say("rpMsg", "Choose a course first.", "bad");
  say("rpMsg", "Working...", "");
  const r = await sb.rpc("admin_term_report", { p_course: $("trCourse").value, p_year: $("trYear").value, p_sem: $("trSem").value, p_programme: $("trProg").value, p_level: $("trLevel").value });
  if (r.error) return say("rpMsg", /function|exist/i.test(r.error.message) ? "Run upgrade32.sql in Supabase first." : r.error.message, "bad");
  trRows = r.data || []; say("rpMsg", "", ""); drawTerm2();
});
function drawTerm2() {
  const lim = Number($("trMin").value) || 75, low = $("trLow").checked;
  const rows = trRows.filter((x) => !low || (x.pct !== null && Number(x.pct) < lim));
  const b = $("rpB"); b.textContent = "";
  const known = trRows.filter((x) => x.pct !== null), avg = known.length ? known.reduce((s, x) => s + Number(x.pct), 0) / known.length : 0;
  const s = $("trSum"); s.textContent = "";
  for (const [n, l] of [[trRows.length, "Students"], [trRows.length ? trRows[0].held : 0, "Classes held"], [Math.round(avg) + "%", "Average attendance"], [known.filter((x) => Number(x.pct) < lim).length, "Below " + lim + "%"]]) { const d = el("div"), bb = el("b"); bb.textContent = n; d.append(bb, l); s.appendChild(d); }
  for (const x of rows) {
    const tr = el("tr"), p = x.pct === null ? "-" : x.pct + "%";
    for (const v of [x.index_number, x.student_name || "-", x.programme || "-", x.level || "-", x.held, x.attended, x.excused, p]) { const c = el("td"); c.textContent = v; tr.appendChild(c); }
    if (x.pct !== null && Number(x.pct) < lim) tr.lastChild.style.cssText = "color:#b3261e;font-weight:700";
    b.appendChild(tr);
  }
  if (!rows.length) { const tr = el("tr"), c = el("td"); c.colSpan = 8; c.textContent = trRows.length ? "Nobody is below the limit." : "No students found for these choices."; tr.appendChild(c); b.appendChild(tr); }
  $("trX").disabled = !trRows.length;
}
$("trMin").addEventListener("input", drawTerm2); $("trLow").addEventListener("change", drawTerm2);
$("trX").addEventListener("click", () => downloadXlsx("Term report " + $("trCourse").value, [{ name: "Term report", rows: [["Index number", "Name", "Programme", "Level", "Classes held", "Attended", "Excused", "Attendance %"], ...trRows.map((x) => [x.index_number, x.student_name || "", x.programme || "", x.level || "", x.held, x.attended, x.excused, x.pct === null ? "" : Number(x.pct)])] }]));

$("trCopy").addEventListener("click", async () => {
  const lim = Number($("trMin").value) || 75, list = trRows.filter((x) => x.pct !== null && Number(x.pct) < lim);
  if (!list.length) return say("rpMsg", "Nobody is below " + lim + "%.", "ok");
  const txt = $("trCourse").value + ": students below " + lim + "% attendance\n" + list.map((x) => (x.student_name || "-") + " (" + x.index_number + ") " + x.pct + "%").join("\n");
  try { await navigator.clipboard.writeText(txt); say("rpMsg", "Copied " + list.length + " student(s).", "ok"); } catch (e) { prompt("Copy this list:", txt); }
});

// ---- Feature switches ----
const FEATURES = [["new_classes", "Starting new classes", "Lecturers cannot start a class while this is off."], ["manual_add", "Adding students by hand", "Hides Add student manually and Mark present."], ["chat", "Chat with the admin", "Lecturers cannot send you messages."], ["rolls", "Uploading class rolls", "Lecturers cannot upload new rolls."], ["exports", "Excel downloads (lecturers)", "Lecturers cannot download Excel files."], ["lookup", "Student lookup (lecturers)", "Hides the lookup card on the lecturer page."], ["announce", "Showing announcements", "Notices you post are hidden from lecturers."]];
function drawFeatures(f) {
  const box = $("featList"); if (!box) return; box.textContent = ""; f = f || {};
  for (const [k, label, hint] of FEATURES) {
    const on = f[k] !== false, row = el("div", "reqrow"), t = el("div", "reqtxt"), b = el("b"), sp = el("span");
    b.textContent = (on ? "On: " : "OFF: ") + label; sp.textContent = hint; t.append(b, sp);
    const a = el("div", "acts"); a.appendChild(abtn(on ? "Switch off" : "Switch on", on ? "bad" : "ok", async () => {
      if (on && !confirm("Switch off: " + label + " for every lecturer?")) return;
      const r = await sb.rpc("admin_set_feature", { p_key: k, p_on: !on });
      if (r.error || (r.data && r.data.ok === false)) return say("tlMsg", r.error ? (/function|exist/i.test(r.error.message) ? "Run upgrade33.sql in Supabase first." : r.error.message) : r.data.error, "bad");
      drawFeatures(r.data.features); say("tlMsg", label + (on ? " switched off." : " switched on."), "ok");
    })); row.append(t, a); box.appendChild(row);
  }
}

// ---- Email alerts for problem reports ----
async function loadNotify() {
  if (!$("ntUrl")) return;
  const r = await sb.rpc("admin_get_notify");
  if (r.error) return say("ntMsg", "Run upgrade34.sql in Supabase first.", "bad");
  if (document.activeElement !== $("ntUrl")) $("ntUrl").value = r.data.url || "";
  $("ntOn").checked = !!r.data.on;
  say("ntMsg", (r.data.on ? "Email alerts are ON." : "Email alerts are off.") + (r.data.has_secret ? " A secret is saved." : " No secret saved yet.") + (r.data.net === false ? " The pg_net extension is missing: in Supabase open Database > Extensions and switch on pg_net." : ""), r.data.on && r.data.net !== false ? "ok" : "");
}
$("ntSave").addEventListener("click", async () => {
  const r = await sb.rpc("admin_set_notify", { p_url: $("ntUrl").value, p_secret: $("ntSecret").value, p_on: $("ntOn").checked });
  if (r.error) return say("ntMsg", r.error.message, "bad");
  $("ntSecret").value = ""; loadNotify();
});
$("ntTest").addEventListener("click", async () => {
  const r = await sb.rpc("admin_test_notify");
  say("ntMsg", r.error ? r.error.message : r.data.ok ? "Test sent. Check your inbox (and spam) in a minute. If nothing arrives, check the function's Logs in Supabase." : r.data.error, r.error || !r.data.ok ? "bad" : "ok");
});
