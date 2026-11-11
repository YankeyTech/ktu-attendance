const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (i) => document.getElementById(i);
const say = (id, t, k) => { $(id).textContent = t; $(id).className = "msg " + (k || ""); };
let people = [], classes = [], counts = {}, sort = { lect: ["email", 1], cls: ["created_at", -1] };
const fmt = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  $("login").hidden = !!session; $("app").hidden = true;
  if (!session) return;
  const { data: me } = await sb.from("profiles").select("role").eq("id", session.user.id).single();
  if (!me || me.role !== "admin") { await sb.auth.signOut(); $("login").hidden = false; return say("loginMsg", "This page is for the admin only.", "bad"); }
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
  const [p, c, a] = await Promise.all([sb.from("profiles").select("*"), sb.from("sessions").select("*").order("created_at", { ascending: false }), sb.from("attendance").select("session_id")]);
  people = p.data || []; classes = c.data || []; counts = {};
  for (const r of a.data || []) counts[r.session_id] = (counts[r.session_id] || 0) + 1;
  const byId = Object.fromEntries(people.map((x) => [x.id, x]));
  for (const s of classes) { s._owner = (byId[s.owner] || {}).email || "-"; s._n = counts[s.id] || 0; }
  for (const x of people) x._classes = classes.filter((s) => s.owner === x.id).length;
  $("stats").innerHTML = "";
  for (const [n, l] of [[people.length, "Staff accounts"], [people.filter((x) => x.role === "lecturer" && x.active).length, "Active lecturers"], [classes.length, "Classes"], [(a.data || []).length, "Check-ins"]]) {
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = n; d.append(b, l); $("stats").appendChild(d);
  }
  drawL(); drawC();
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
  const rows = grid($("lh"), $("lb"), [["email", "Email"], ["full_name", "Name"], ["role", "Role"], ["active", "Status"], ["_classes", "Classes"], ["created_at", "Added"], [null, "Actions"]], people.filter((x) => (x.email + " " + (x.full_name || "")).toLowerCase().includes(q)), "lect");
  for (const x of rows) {
    const tr = document.createElement("tr");
    for (const v of [x.email, x.full_name || "-", x.role, x.active ? "Active" : "Disabled", x._classes, fmt(x.created_at)]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    if (x.role !== "admin") {
      const mk = (t, f) => { const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.addEventListener("click", f); td.appendChild(b); };
      mk("Reset password", () => call({ action: "reset", id: x.id }, x.email, "Password reset for "));
      mk(x.active ? "Disable" : "Enable", async () => { const r = await sb.functions.invoke("admin-users", { body: { action: "active", id: x.id, active: !x.active } }); fail(r) || load(); });
    }
    tr.appendChild(td); $("lb").appendChild(tr);
  }
}
function drawC() {
  const q = $("cq").value.trim().toLowerCase();
  const rows = grid($("ch"), $("cb"), [["created_at", "Date"], ["course", "Course"], ["programme", "Programme"], ["level", "Level"], ["_owner", "Lecturer"], ["_n", "Check-ins"], [null, "Actions"]], classes.filter((s) => ((s.course || "") + " " + (s.programme || "") + " " + s._owner).toLowerCase().includes(q)), "cls");
  for (const s of rows) {
    const tr = document.createElement("tr");
    for (const v of [fmt(s.created_at), s.course, s.programme || "-", s.level || "-", s._owner, s._n]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td"), b = document.createElement("button"); b.type = "button"; b.textContent = "Delete";
    b.addEventListener("click", async () => { if (confirm("Delete this class and all its attendance?")) { await sb.from("sessions").delete().eq("id", s.id); load(); } });
    td.appendChild(b); tr.appendChild(td); $("cb").appendChild(tr);
  }
}
$("lq").addEventListener("input", drawL); $("cq").addEventListener("input", drawC);

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
  if (fail(r)) return; say("msg", "Done.", "ok"); showCred(email || r.data.email, r.data.password, lead); document.querySelector('[data-t="lect"]').click(); load();
}
$("add").addEventListener("submit", (e) => { e.preventDefault(); call({ action: "create", email: $("aemail").value, name: $("aname").value }, null, "Account created for ").then(() => { $("aemail").value = ""; $("aname").value = ""; }); });
start();
