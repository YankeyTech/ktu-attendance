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
$("out").addEventListener("click", async () => { await sb.auth.signOut(); start(); });
document.querySelectorAll(".tabs [data-t]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs [data-t]").forEach((x) => x.classList.toggle("on", x === b));
  for (const t of ["over", "lect", "cls"]) $("t-" + t).hidden = t !== b.dataset.t;
}));

async function load() {
  const [p, c, a, cr, rq] = await Promise.all([sb.from("profiles").select("*"), sb.from("sessions").select("*").order("created_at", { ascending: false }), sb.from("attendance").select("session_id"), sb.from("courses").select("owner,name").order("name"), sb.from("name_requests").select("*").eq("status", "pending").order("created_at")]);
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
  fillFilters(); drawL(); drawC(); drawReq();
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
      mk("Reset password", () => call({ action: "reset", id: x.id }, x.email, "Password reset for "));
      mk(x.active ? "Disable" : "Enable", async () => { const r = await sb.functions.invoke("admin-users", { body: { action: "active", id: x.id, active: !x.active } }); fail(r) || load(); });
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
    const td = document.createElement("td"), b = document.createElement("button"); b.type = "button"; b.textContent = "Delete";
    b.addEventListener("click", async () => { if (confirm("Delete this class and all its attendance?")) { await sb.from("sessions").delete().eq("id", s.id); load(); } });
    td.appendChild(b); tr.appendChild(td); $("cb").appendChild(tr);
  }
}
$("lq").addEventListener("input", drawL);
for (const id of ["cq", "fc", "fp", "fl", "fo", "ft", "fy", "fs", "fd1", "fd2"]) $(id).addEventListener(id === "cq" ? "input" : "change", drawC);
const roleLabel = (r) => (r === "assistant" ? "Teaching assistant" : r === "admin" ? "Admin" : "Lecturer");
function filteredClasses() {
  const q = $("cq").value.trim().toLowerCase(), fc = $("fc").value, fp = $("fp").value, fl = $("fl").value, fo = $("fo").value, ft = $("ft").value, fy = $("fy").value, fs = $("fs").value, d1 = $("fd1").value, d2 = $("fd2").value;
  return classes.filter((s) => {
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
function showCred(email, password, lead) {
  const box = $("cred"); box.textContent = "";
  const d = document.createElement("div"); d.className = "cred";
  const p = document.createElement("p"); p.textContent = lead + email + ". Give them this default password. It is shown only now:";
  const c = document.createElement("code"); c.textContent = password;
  const b = document.createElement("button"); b.className = "btn quiet"; b.type = "button"; b.textContent = "Copy";
  b.addEventListener("click", () => navigator.clipboard.writeText(password).then(() => (b.textContent = "Copied")));
  const n = document.createElement("p"); n.className = "note"; n.textContent = "They sign in at the lecturer page and will be asked to choose their own password.";
  d.append(p, c, document.createTextNode(" "), b, n); box.appendChild(d);
}
async function call(body, email, lead) {
  say("msg", "Working…"); const r = await sb.functions.invoke("admin-users", { body });
  if (fail(r)) return; say("msg", "Done.", "ok"); showCred(email || r.data.email, r.data.password, lead); document.querySelector('[data-t="lect"]').click(); load(); return true;
}
$("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("aemail").value.trim(), role = $("arole").value, nm = $("aname").value.trim().replace(/\s+/g, " ");
  const ok = await call({ action: "create", email, name: $("aname").value, role }, null, "Account created for ");
  if (!ok) return;
  if (nm.length >= 3) {
    const r2 = await sb.rpc("admin_set_name", { p_email: email, p_name: nm.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()), p_only_if_empty: true });
    if (r2.error) say("msg", "Account created, but the name could not be saved: " + r2.error.message, "bad");
  }
  if (role !== "lecturer") { const r = await sb.rpc("set_staff_role", { p_email: email, p_role: role }); if (r.error) say("msg", "Account created, but the role could not be set: " + r.error.message, "bad"); }
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
