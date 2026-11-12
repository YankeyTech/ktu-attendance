const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid mix-ups
let sortBy = ["checked_in_at", 1];
let current = null, timer = null, records = [], role = "lecturer", qrTimer = null, lastWin = -1, rollRows = [], clockOffset = 0;

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

const studentLink = (code, tok) => new URL("index.html?s=" + code + (tok ? "&t=" + tok : ""), location.href).href;
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
    role = (pr && pr.role) || "lecturer";
    document.body.dataset.role = role;
    $("adminLink").hidden = !(role === "admin" && session.user.email.toLowerCase() === "ygpedri@gmail.com");
    await loadCourses();
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
    const isNew = $("coursePick").value === "__new";
    const courseName = isNew ? $("course").value.trim() : $("coursePick").value;
    if (courseName.length < 2) throw new Error("Choose a course, or type the new course name.");
    const pos = await getPosition();
    let row = null, lastErr = null;
    for (let i = 0; i < 3 && !row; i++) {
      const { data, error } = await sb.from("sessions").insert({
        code: newCode(),
        course: courseName,
        programme: $("tprog").value,
        level: $("tlevel").value,
        late_after_min: $("late").value ? Number($("late").value) : null,
        rotating: $("rot").checked, two_point: $("two").checked, block_shared: $("blk").checked,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        radius_m: Number($("radius").value),
        closes_at: new Date(Date.now() + Number($("mins").value) * 60000).toISOString()
      }).select().single();
      if (error) { lastErr = error; if (error.code !== "23505") break; } else row = data;
    }
    if (!row) throw lastErr || new Error("Could not start the class.");
    try { localStorage.setItem("ktu_tprog", $("tprog").value); } catch (e2) {}
    if (isNew) { await sb.from("courses").insert({ name: courseName }); }
    await loadCourses(); $("coursePick").value = courseName; $("course").hidden = true; $("course").value = "";
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
  const cq = $("cq").value.trim().toLowerCase(), cf = $("cfilter").value;
  for (const s of data) {
    if (cf && s.course !== cf) continue;
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
  $("qrBox").hidden = !s.rotating;
  $("pinBox").hidden = !s.rotating; $("copy").hidden = !!s.rotating;
  $("endchk").hidden = !s.two_point; $("endchk").textContent = s.end_open ? "Close end-of-class check" : "Open end-of-class check (10 min)";
  lastWin = -1; if (qrTimer) clearInterval(qrTimer); qrTimer = setInterval(tickQr, 1000); tickQr();
  syncClock().then(() => { lastWin = -1; tickQr(); });
  loadRoll();
  stopPolling();
  timer = setInterval(loadAttendance, 8000);
  $("live").scrollIntoView({ behavior: "smooth", block: "start" });
  loadSessions();
}
function stopPolling() { if (timer) clearInterval(timer); timer = null; if (qrTimer) clearInterval(qrTimer); qrTimer = null; }

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
    return f === "all" || (f === "in" && r.in_range) || (f === "out" && !r.in_range) || (f === "shared" && r._shared) || (f === "manual" && r.manual) || (f === "late" && r.late) || (f === "flag" && r.gps_flag);
  });
  const [sk, sd] = sortBy; list.sort((a, b) => ((a[sk] ?? "") > (b[sk] ?? "") ? 1 : (a[sk] ?? "") < (b[sk] ?? "") ? -1 : 0) * sd);
  const body = $("rows"); body.textContent = "";
  for (const r of list) {
    const tr = document.createElement("tr"); tr.className = "rowin";
    tr.style.background = r.in_range ? "#d9f2dd" : "#f9d6d6"; tr.style.color = "#1a1a1a";
    for (const c of [r.student_name || "-", r.index_number, r.programme, r.level || "-", fmtTime(r.checked_in_at), Math.round(r.distance_m) + " m", r.in_range ? "Yes" : "No", noteOf(r)]) {
      const td = document.createElement("td"); td.textContent = c; tr.appendChild(td);
    }
    const act = document.createElement("td");
    const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); act.appendChild(b); };
    mk(r.in_range ? "Mark outside" : "Mark present", async () => { await sb.from("attendance").update({ in_range: !r.in_range, manual: true }).eq("id", r.id); loadAttendance(); });
    if (role !== "assistant") mk("Remove", async () => { if (confirm("Remove " + r.index_number + " from this class?")) { await sb.from("attendance").delete().eq("id", r.id); loadAttendance(); } });
    tr.appendChild(act); body.appendChild(tr);
  }
  const inside = records.filter((r) => r.in_range).length, sc = records.filter((r) => r._shared).length;
  const open = new Date(current.closes_at) > new Date();
  $("stats").innerHTML = "";
  for (const [n, l] of [[records.length, "Checked in"], [inside, "In class area"], [records.length - inside, "Outside"], [sc, "Shared phone"], [records.filter((r) => r.late).length, "Late"], [records.filter((r) => r.gps_flag).length, "GPS warnings"]]) {
    const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = n; d.append(b, l); $("stats").appendChild(d);
  }
  renderAbsent();
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



// ---- Courses ----
async function loadCourses() {
  const { data } = await sb.from("courses").select("name").order("name");
  const names = (data || []).map((c) => c.name);
  const pick = $("coursePick"), keep = pick.value, flt = $("cfilter"), keepF = flt.value;
  pick.textContent = ""; flt.textContent = "";
  const add = (sel, v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
  add(pick, "", "Select your course");
  for (const n of names) add(pick, n, n);
  add(pick, "__new", "+ Add a new course...");
  add(flt, "", "All courses");
  for (const n of names) add(flt, n, n);
  const rc = $("rollCourse"), keepR = rc.value; rc.textContent = "";
  add(rc, "", "Select the course");
  for (const n of names) add(rc, n, n);
  rc.value = names.includes(keepR) ? keepR : "";
  pick.value = names.includes(keep) || keep === "__new" ? keep : ""; flt.value = names.includes(keepF) ? keepF : "";
}
$("coursePick").addEventListener("change", () => {
  const isNew = $("coursePick").value === "__new";
  $("course").hidden = !isNew; $("course").required = isNew; if (isNew) $("course").focus();
});
$("cfilter").addEventListener("change", loadSessions);

// ---- QR code ----
function drawQr() {
  if (!current) return;
  if (!drawQR($("qrCanvas"), studentLink(current.code, current._tok), 260)) say("count", "QR library did not load. Check your internet.", "warn");
}
$("qr").addEventListener("click", () => { $("qrBox").hidden = !$("qrBox").hidden; if (!$("qrBox").hidden) drawQr(); });
$("qrDl").addEventListener("click", () => {
  const c = document.createElement("canvas"); drawQR(c, studentLink(current.code, current._tok), 800);
  const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = safeName(current.course) + " QR.png"; a.click();
});
$("qrFull").addEventListener("click", () => {
  $("qrFs").hidden = false; drawFs();
});
$("qrFs").addEventListener("click", () => { $("qrFs").hidden = true; });

// ---- Excel ----
$("xlsx").addEventListener("click", () => {
  if (role === "assistant" || !current) return;
  const c = Object.assign({}, current, { _owner: $("who").textContent });
  downloadXlsx(current.course + " " + fmtDay(current.created_at), buildSheets([c], records, absentees().map((r) => [r.student_name || "", r.index_number, r.programme || "", r.level || ""])));
});
$("cxlsx").addEventListener("click", async () => {
  if (role === "assistant") return;
  const course = $("cfilter").value;
  if (!course) return say("cmsg", "Pick a course in the course filter first.", "warn");
  say("cmsg", "Preparing the spreadsheet...");
  const { data: cls } = await sb.from("sessions").select("*").eq("course", course).order("created_at", { ascending: false });
  if (!cls || !cls.length) return say("cmsg", "No classes found for that course.", "warn");
  const atts = await fetchAttendance(sb, cls.map((c) => c.id));
  for (const c of cls) c._owner = $("who").textContent;
  downloadXlsx(course + " all classes", buildSheets(cls, atts));
  say("cmsg", "Downloaded.", "ok");
});


// ---- Rotating screen code ----
// Use the database clock, so a wrong laptop clock cannot break the codes.
async function syncClock() {
  try { const t0 = Date.now(); const { data } = await sb.rpc("server_epoch"); if (typeof data === "number") clockOffset = data - (t0 + Date.now()) / 2000; } catch (e) {}
}
async function tokenFor(secret, w) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret + ":" + w));
  const hex = Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
  return String(parseInt(hex.slice(0, 7), 16) % 1000000).padStart(6, "0");
}
function drawFs() {
  if (!current) return;
  drawQR($("qrFsCanvas"), studentLink(current.code, current._tok), Math.min(innerWidth, innerHeight) * 0.7);
  $("qrFsCode").textContent = current.code;
  $("qrFsPin").hidden = !current.rotating; if (current.rotating && current._tok) $("qrFsPin").textContent = current._tok.slice(0, 3) + " " + current._tok.slice(3);
}
async function tickQr() {
  if (!current || !current.rotating || !current.secret) return;
  const now = Date.now() / 1000 + clockOffset, w = Math.floor(now / 30);
  $("cd").style.width = ((30 - (now % 30)) / 30) * 100 + "%";
  if (w === lastWin) return;
  lastWin = w;
  const t = await tokenFor(current.secret, w);
  current._tok = t; $("pin").textContent = t.slice(0, 3) + " " + t.slice(3);
  $("liveLink").textContent = studentLink(current.code);
  if (!$("qrBox").hidden) drawQr();
  if (!$("qrFs").hidden) drawFs();
}
$("endchk").addEventListener("click", async () => {
  const open = !current.end_open;
  const patch = { end_open: open, closes_at: open ? new Date(Date.now() + 600000).toISOString() : new Date().toISOString() };
  const { error } = await sb.from("sessions").update(patch).eq("id", current.id);
  if (error) return say("count", "Could not change the end check: " + error.message, "bad");
  Object.assign(current, patch);
  $("endchk").textContent = open ? "Close end-of-class check" : "Open end-of-class check (10 min)";
  loadAttendance();
});

// ---- Notes column ----
function noteOf(r) {
  const n = [];
  if (r.late) n.push("Late");
  if (r._shared) n.push("Shared phone");
  if (r.gps_flag) n.push(r.gps_flag);
  if (r.manual) n.push("Manual");
  if (current && current.two_point) n.push(r.end_at ? "Ended " + fmtTime(r.end_at) + (r.end_in_range === false ? " (outside area)" : "") : (current.end_open ? "Not ended yet" : ""));
  return n.filter(Boolean).join(", ");
}

// ---- Class roll: absentees ----
async function loadRoll() {
  rollRows = [];
  if (!current) return;
  const { data } = await sb.from("rolls").select("*").eq("course", current.course);
  rollRows = data || []; renderAbsent();
}
function absentees() {
  const here = new Set(records.map((r) => String(r.index_number).toUpperCase()));
  return rollRows.filter((r) => !here.has(r.index_number));
}
function renderAbsent() {
  const box = $("absent");
  if (!rollRows.length) { box.hidden = true; return; }
  const list = absentees(); box.hidden = false; $("absN").textContent = list.length;
  const L = $("absList"); L.textContent = "";
  if (!list.length) { L.textContent = "Everyone on the roll has checked in."; return; }
  for (const r of list) {
    const row = document.createElement("div"); row.className = "absrow";
    const s = document.createElement("span"); s.textContent = (r.student_name || "-") + " (" + r.index_number + ")";
    const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet"; b.textContent = "Mark present";
    b.addEventListener("click", async () => {
      const { error } = await sb.from("attendance").insert({ session_id: current.id, index_number: r.index_number, student_name: r.student_name || r.index_number,
        programme: r.programme || current.programme || "-", level: r.level || current.level || "-", lat: current.lat, lng: current.lng,
        accuracy_m: 0, distance_m: 0, in_range: true, manual: true, note: "Marked present by lecturer" });
      say("count", error ? "Could not mark present: " + error.message : "Marked present.", error ? "bad" : "ok"); loadAttendance();
    });
    row.append(s, b); L.appendChild(row);
  }
}

// ---- Class roll: upload ----
$("rollUp").addEventListener("click", async () => {
  const course = $("rollCourse").value, f = $("rollFile").files[0];
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  if (!f) return say("rollMsg", "Choose a CSV or Excel file first.", "warn");
  if (!window.XLSX) return say("rollMsg", "The Excel library did not load. Check your internet.", "bad");
  say("rollMsg", "Reading the file...");
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    if (rows.length < 2) return say("rollMsg", "The file has no student rows.", "bad");
    const head = rows[0].map((h) => String(h).toLowerCase());
    const find = (re, fb) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fb; };
    const ci = find(/index|student\s*(id|no)|reg|^id$/, 0), cn = find(/^(full |student )?name/, 1), cp = find(/programme|program/, -1), cl = find(/level/, -1);
    const map = new Map(); let skipped = 0;
    for (const r of rows.slice(1)) {
      const idx = String(r[ci] || "").trim().toUpperCase();
      if (!/^[A-Z0-9\/\-]{4,30}$/.test(idx)) { if (idx || r.some((x) => String(x).trim())) skipped++; continue; }
      map.set(idx, { course, index_number: idx, student_name: String(r[cn] || "").trim().slice(0, 100) || null, programme: cp >= 0 ? String(r[cp] || "").trim() || null : null, level: cl >= 0 ? String(r[cl] || "").trim() || null : null });
    }
    if (!map.size) return say("rollMsg", "No valid index numbers found. Check the column headings.", "bad");
    const { data: { session } } = await sb.auth.getSession();
    const list = Array.from(map.values()).map((x) => Object.assign(x, { owner: session.user.id }));
    await sb.from("rolls").delete().eq("course", course);
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await sb.from("rolls").insert(list.slice(i, i + 200));
      if (error) return say("rollMsg", "Upload failed: " + error.message, "bad");
    }
    say("rollMsg", "Roll uploaded: " + list.length + " students" + (skipped ? ", " + skipped + " rows skipped (invalid index number)." : "."), "ok");
    $("rollFile").value = ""; if (current && current.course === course) loadRoll();
  } catch (e) { say("rollMsg", "Could not read that file.", "bad"); }
});

// ---- Attendance report and at-risk list ----
$("rep").addEventListener("click", async () => {
  const course = $("rollCourse").value, thr = Number($("thr").value) || 75;
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  say("rollMsg", "Working out the report...");
  const [{ data: cls }, { data: roll }] = await Promise.all([sb.from("sessions").select("id").eq("course", course), sb.from("rolls").select("*").eq("course", course)]);
  if (!cls || !cls.length) return say("rollMsg", "No classes found for that course yet.", "warn");
  const atts = await fetchAttendance(sb, cls.map((c) => c.id));
  const st = new Map();
  for (const r of roll || []) st.set(r.index_number, { name: r.student_name || "", set: new Set() });
  for (const a of atts) {
    const k = String(a.index_number).toUpperCase();
    if (!st.has(k)) st.set(k, { name: a.student_name || "", set: new Set(), extra: true });
    if (a.in_range) st.get(k).set.add(a.session_id);
  }
  const total = cls.length;
  const list = Array.from(st, ([k, v]) => ({ idx: k, name: v.name, n: v.set.size, pct: Math.round((v.set.size / total) * 100), extra: v.extra })).sort((a, b) => a.pct - b.pct);
  const risk = list.filter((x) => x.pct < thr).length;
  const box = $("report"); box.textContent = "";
  const sum = document.createElement("p"); sum.className = "msg"; sum.textContent = total + " classes held. " + risk + " of " + list.length + " students are below " + thr + "%."; box.appendChild(sum);
  const wrap = document.createElement("div"); wrap.className = "table-wrap"; const t = document.createElement("table");
  t.innerHTML = "<thead><tr><th>Name</th><th>Index number</th><th>Attended</th><th>Rate</th></tr></thead>";
  const tb = document.createElement("tbody");
  for (const x of list) {
    const tr = document.createElement("tr");
    if (x.pct < thr) { tr.style.background = "#f9d6d6"; tr.style.color = "#1a1a1a"; }
    for (const v of [x.name || "-", x.idx + (x.extra ? " (not on roll)" : ""), x.n + " of " + total, x.pct + "%"]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    tb.appendChild(tr);
  }
  t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
  if (role !== "assistant") {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet"; b.style.marginTop = "10px"; b.textContent = "Download report as Excel";
    b.addEventListener("click", () => downloadXlsx(course + " attendance report", [
      { name: "Report", rows: [["Name", "Index number", "Classes attended", "Total classes", "Attendance %", "At risk"]].concat(list.map((x) => [x.name, x.idx, x.n, total, x.pct, x.pct < thr ? "Yes" : "No"])) },
      { name: "At risk", rows: [["Name", "Index number", "Attendance %"]].concat(list.filter((x) => x.pct < thr).map((x) => [x.name, x.idx, x.pct])) }]));
    box.appendChild(b);
  }
  say("rollMsg", "");
});

refreshAuth();
