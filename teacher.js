const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid mix-ups
let sortBy = ["checked_in_at", 1];
let current = null, timer = null, records = [];

function say(id, text, kind) { $(id).textContent = text; $(id).className = "msg " + (kind || ""); }

// Fill a programme dropdown. Accepts groups like {group, items:[...]} and also plain strings,
// so an older or differently shaped programmes.js cannot break the page.
function fillProgrammes(sel) {
  const list = (typeof PROGRAMMES !== "undefined" && Array.isArray(PROGRAMMES)) ? PROGRAMMES : [];
  const addOpt = (parent, name) => {
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    parent.appendChild(o);
  };
  for (const g of list) {
    if (typeof g === "string") { addOpt(sel, g); continue; }
    const items = (g && (g.items || g.programmes || g.options || g.list)) || [];
    if (!Array.isArray(items) || !items.length) { console.warn("Skipped programme group:", g); continue; }
    const og = document.createElement("optgroup");
    og.label = g.group || g.label || g.name || "Programmes";
    for (const name of items) addOpt(og, name);
    sel.appendChild(og);
  }
  if (!list.length) console.warn("PROGRAMMES is missing or empty. Check programmes.js is loaded before this script.");
}
fillProgrammes($("tprog"));
try { $("tprog").value = localStorage.getItem("ktu_tprog") || ""; } catch (e) {}

function newCode() {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return Array.from(a, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("This browser cannot share location."));
    navigator.geolocation.getCurrentPosition(res, () => rej(new Error("Allow location for this page, then try again.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

const studentLink = (code) => new URL("index.html?s=" + code, location.href).href;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

async function refreshAuth() {
  const { data: { session } } = await sb.auth.getSession();
  $("login").hidden = !!session;
  $("app").hidden = !session;
  $("who").textContent = session ? session.user.email : "KTU class check-in";
  if (session) {
    const { data: pr } = await sb.from("profiles").select("role,must_change,active").eq("id", session.user.id).single();
    if (pr && pr.must_change) return location.replace("change-password.html");
    if (pr && pr.active === false) { await sb.auth.signOut(); return say("loginMsg", "This account is disabled. Contact the admin.", "bad"); }
    $("adminLink").hidden = !(pr && pr.role === "admin");
    loadSessions();
  } else stopPolling();
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("loginMsg", "Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value });
  if (error) return say("loginMsg", "Wrong email or password.", "bad");
  $("pw").value = ""; say("loginMsg", ""); refreshAuth();
});
$("out").addEventListener("click", async () => { await sb.auth.signOut(); current = null; $("live").hidden = true; refreshAuth(); });

$("start").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("startBtn").disabled = true;
  say("startMsg", "Getting your location…");
  try {
    const pos = await getPosition();
    let row = null, lastErr = null;
    for (let i = 0; i < 3 && !row; i++) {
      const { data, error } = await sb.from("sessions").insert({
        code: newCode(),
        course: $("course").value.trim(),
        programme: $("tprog").value,
        level: $("tlevel").value,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        radius_m: Number($("radius").value),
        closes_at: new Date(Date.now() + Number($("mins").value) * 60000).toISOString()
      }).select().single();
      if (error) { lastErr = error; if (error.code !== "23505") break; } else row = data;
    }
    if (!row) throw lastErr || new Error("Could not start the class.");
    try { localStorage.setItem("ktu_tprog", $("tprog").value); } catch (e2) {}
    say("startMsg", "Check-in is open.", "ok");
    await loadSessions();
    openSession(row);
  } catch (err) {
    say("startMsg", err.message || "Could not start the class.", "bad");
  } finally { $("startBtn").disabled = false; }
});

async function loadSessions() {
  const { data, error } = await sb.from("sessions").select("*").order("created_at", { ascending: false }).limit(30);
  const box = $("sessions"); box.textContent = "";
  if (error) return;
  if (!data.length) { box.textContent = "No classes yet."; return; }
  const cq = $("cq").value.trim().toLowerCase();
  for (const s of data) {
    if (cq && !((s.course || "") + " " + (s.programme || "") + " " + (s.level || "")).toLowerCase().includes(cq)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(current && current.id === s.id));
    b.append(s.course);
    const small = document.createElement("small");
    small.textContent = fmtDay(s.created_at) + ", " + fmtTime(s.created_at) + (s.programme ? "  |  " + s.programme : "") + "  |  code " + s.code;
    b.appendChild(small);
    b.addEventListener("click", () => openSession(s));
    box.appendChild(b);
  }
}

function openSession(s) {
  current = s;
  $("live").hidden = false;
  $("liveCourse").textContent = s.course + (s.programme ? " (" + s.programme + (s.level ? ", " + s.level : "") + ")" : "");
  $("liveCode").textContent = s.code;
  $("liveLink").textContent = studentLink(s.code);
  loadAttendance();
  stopPolling();
  timer = setInterval(loadAttendance, 8000);
  $("live").scrollIntoView({ behavior: "smooth", block: "start" });
  loadSessions();
}
function stopPolling() { if (timer) clearInterval(timer); timer = null; }

// Phones that checked in more than one different index number in this class.
function sharedIndexes(data) {
  const byDevice = {};
  for (const r of data) {
    if (!r.device_id) continue;
    (byDevice[r.device_id] = byDevice[r.device_id] || new Set()).add(String(r.index_number).toUpperCase());
  }
  const shared = new Set();
  for (const [d, set] of Object.entries(byDevice)) if (set.size > 1) shared.add(d);
  return shared;
}

async function loadAttendance() {
  if (!current) return;
  const { data, error } = await sb.from("attendance").select("*").eq("session_id", current.id).order("checked_in_at");
  if (error) return;
  records = data;
  const shared = sharedIndexes(data);
  for (const r of records) r._shared = !!(r.device_id && shared.has(r.device_id));
  renderRows();
}
function renderRows() {
  const q = $("q").value.trim().toLowerCase(), f = $("flt").value;
  const list = records.filter((r) => {
    if (q && !((r.student_name || "") + " " + r.index_number).toLowerCase().includes(q)) return false;
    return f === "all" || (f === "in" && r.in_range) || (f === "out" && !r.in_range) || (f === "shared" && r._shared) || (f === "manual" && r.manual);
  });
  const [sk, sd] = sortBy; list.sort((a, b) => ((a[sk] ?? "") > (b[sk] ?? "") ? 1 : (a[sk] ?? "") < (b[sk] ?? "") ? -1 : 0) * sd);
  const body = $("rows"); body.textContent = "";
  for (const r of list) {
    const tr = document.createElement("tr");
    tr.style.background = r.in_range ? "#d9f2dd" : "#f9d6d6"; tr.style.color = "#1a1a1a";
    for (const c of [r.student_name || "-", r.index_number, r.programme, r.level || "-", fmtTime(r.checked_in_at), Math.round(r.distance_m) + " m", r.in_range ? "Yes" : "No", (r._shared ? "Shared phone " : "") + (r.manual ? "Manual" : "")]) {
      const td = document.createElement("td"); td.textContent = c; tr.appendChild(td);
    }
    const act = document.createElement("td");
    const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); act.appendChild(b); };
    mk(r.in_range ? "Mark outside" : "Mark present", async () => { await sb.from("attendance").update({ in_range: !r.in_range, manual: true }).eq("id", r.id); loadAttendance(); });
    mk("Remove", async () => { if (confirm("Remove " + r.index_number + " from this class?")) { await sb.from("attendance").delete().eq("id", r.id); loadAttendance(); } });
    tr.appendChild(act); body.appendChild(tr);
  }
  const inside = records.filter((r) => r.in_range).length, sc = records.filter((r) => r._shared).length;
  const open = new Date(current.closes_at) > new Date();
  $("stats").innerHTML = "";
  for (const [n, l] of [[records.length, "Checked in"], [inside, "In class area"], [records.length - inside, "Outside"], [sc, "Shared phone"]]) {
    const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = n; d.append(b, l); $("stats").appendChild(d);
  }
  say("count", (open ? "Check-in is open until " + fmtTime(current.closes_at) + "." : "Check-in is closed.") + " Showing " + list.length + " of " + records.length + ".");
}
document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { sortBy = [th.dataset.k, sortBy[0] === th.dataset.k ? -sortBy[1] : 1]; renderRows(); }));
$("cq").addEventListener("input", loadSessions);
$("q").addEventListener("input", renderRows); $("flt").addEventListener("change", renderRows);
$("more").addEventListener("click", async () => {
  const base = Math.max(Date.now(), new Date(current.closes_at).getTime());
  const t = new Date(base + 600000).toISOString();
  const { error } = await sb.from("sessions").update({ closes_at: t }).eq("id", current.id);
  if (!error) { current.closes_at = t; renderRows(); }
});
$("addm").addEventListener("click", async () => {
  const idx = (prompt("Index number of the student:") || "").trim().toUpperCase(); if (!idx) return;
  const name = (prompt("Full name of the student:") || "").trim(); if (!name) return;
  const { error } = await sb.from("attendance").insert({ session_id: current.id, index_number: idx, student_name: name,
    programme: current.programme || "-", level: current.level || "-", lat: current.lat, lng: current.lng, accuracy_m: 0, distance_m: 0, in_range: true, manual: true, note: "Added by lecturer" });
  say("count", error ? (error.code === "23505" ? "That index number is already in this class." : "Could not add: " + error.message) : "Student added.", error ? "bad" : "ok");
  loadAttendance();
});

$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(studentLink(current.code)); say("count", "Link copied.", "ok"); }
  catch (e) { say("count", "Copy failed. Select the link above and copy it.", "warn"); }
});

$("close").addEventListener("click", async () => {
  const now = new Date().toISOString();
  const { error } = await sb.from("sessions").update({ closes_at: now }).eq("id", current.id);
  if (!error) { current.closes_at = now; loadAttendance(); }
});

// CSV: a leading ' stops Excel from running cells that start with = + - @
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
$("csv").addEventListener("click", () => {
  const head = ["Name", "Level", "Index number", "Programme", "Checked in", "Distance (m)", "In class area", "GPS accuracy (m)", "Shared phone"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of records) {
    lines.push([r.student_name, r.level, r.index_number, r.programme, new Date(r.checked_in_at).toLocaleString(), Math.round(r.distance_m),
      r.in_range ? "Yes" : "No", Math.round(r.accuracy_m ?? 0), r._shared ? "Yes" : "No"].map(csvCell).join(","));
  }
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (current.course.replace(/[^\w\- ]+/g, "") || "attendance") + " " + fmtDay(current.created_at) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

refreshAuth();
