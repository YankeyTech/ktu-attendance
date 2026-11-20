const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid mix-ups
let sortBy = ["checked_in_at", 1];
let groups = [];
let rowLimit = 50, openRows = new Set(), knownOut = new Set(), popQueue = [], popId = null, popReady = false, reviewAll = false;
let myPerms = {}, byAdmin = false, popupsOff = false, myId = "", venues = [], seenDots = new Set(), projN = -1;
let current = null, timer = null, records = [], role = "lecturer", qrTimer = null, lastWin = -1, rollRows = [], clockOffset = 0, myName = "", myEmail = "";

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
  $("who").textContent = session ? "Loading..." : "KTU class check-in";
  if (session) {
    const { data: pr } = await sb.from("profiles").select("role,must_change,active,full_name,alerts_by_admin,perms").eq("id", session.user.id).single();
    if (pr && pr.must_change) return location.replace("change-password.html");
    if (pr && pr.active === false) { await sb.auth.signOut(); return say("loginMsg", "This account is disabled. Contact the admin.", "bad"); }
    role = (pr && pr.role) || "lecturer"; byAdmin = !!(pr && pr.alerts_by_admin); myPerms = (pr && pr.perms) || {}; applyPerms(); 
    { const { data: pn } = await sb.from("name_requests").select("requested_name").eq("user_id", session.user.id).eq("status", "pending").maybeSingle(); pendingName = pn ? pn.requested_name : ""; }
    myName = (pr && pr.full_name) || ""; $("myName").value = myName; myEmail = session.user.email; myId = session.user.id; drawPresets(); startChat(); loadVenues(); applyName();
    document.body.dataset.role = role;
    $("adminLink").hidden = !(role === "admin" && session.user.email.toLowerCase() === "ygpedri@gmail.com");
    await loadCourses();
    loadSessions(); pausedBanner();
  } else { stopPolling(); stopQr(); }
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  say("loginMsg", "Signing in…");
  const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("pw").value });
  if (error) return say("loginMsg", "Wrong email or password.", "bad");
  $("pw").value = ""; say("loginMsg", ""); refreshAuth();
});
wireForgot(sb, "login");
$("out").addEventListener("click", async () => { await sb.auth.signOut(); current = null; $("live").hidden = true; $("stickybar").hidden = true; document.body.classList.remove("hasbar"); refreshAuth(); });

$("start").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("startBtn").disabled = true;
  say("startMsg", "Getting your location…");
  try {
    const comb = document.querySelector('input[name="ctype"]:checked').value === "combined";
    if (comb && groups.length < 2) throw new Error("Add at least two programme and level groups, or choose Single programme.");
    const isNew = $("coursePick").value === "__new";
    const courseName = isNew ? $("course").value.trim() : $("coursePick").value;
    if (courseName.length < 2) throw new Error("Choose a course, or type the new course name.");
    const vsel = venues.find((v) => v.id === $("venue").value);
    const pos = vsel ? { coords: { latitude: vsel.lat, longitude: vsel.lng } } : await getPosition();
    let row = null, lastErr = null;
    for (let i = 0; i < 3 && !row; i++) {
      const { data, error } = await sb.from("sessions").insert({
        code: newCode(),
        course: courseName,
        programme: comb ? "Combined" : $("tprog").value,
        level: comb ? "Combined" : $("tlevel").value,
        combined: comb, class_groups: comb ? groups : [],
        academic_year: $("tyear").value, semester: $("tsem").value,
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
    try { localStorage.setItem("ktu_tprog", $("tprog").value); localStorage.setItem("ktu_tyear", $("tyear").value); localStorage.setItem("ktu_tsem", $("tsem").value); } catch (e2) {}
    if (isNew) { await sb.from("courses").insert({ name: courseName }); }
    await loadCourses(); $("coursePick").value = courseName; $("course").hidden = true; $("course").value = "";
    say("startMsg", "Check-in is open.", "ok");
    await loadSessions();
    openSession(row);
  } catch (err) {
    say("startMsg", err.message || "Could not start the class.", "bad");
  } finally { $("startBtn").disabled = false; }
});

// "Your week" strip on the Home tab: classes, check-ins and how many were inside the class area, since Monday.
let mySessions = [];
async function pausedBanner() {
  try { const { data } = await sb.rpc("get_public_settings"); popupsOff = data && data.popups === false; applyFeatures(data && data.features); applyPolicy(data && data.policy); applyDefaults(data && data.defaults); showWelcome(data && data.texts && data.texts.welcome);
    if (!(data && data.features && data.features.announce === false)) showAnnouncements(sb, $("announceBox"));
    if (!data || !data.paused) return;
    const d = document.createElement("div"); d.className = "announce warn"; const t = document.createElement("div"), b = document.createElement("b"), s = document.createElement("span");
    b.textContent = "Check-in is paused by the admin"; s.textContent = data.message || "Students cannot check in right now."; t.append(b, s); d.appendChild(t); $("announceBox").prepend(d); } catch (e) {}
}
// "Courses at a glance": classes held and average check-ins per course.
async function courseSummary(all) {
  const box = $("courseSum"); if (!box) return;
  const live = (all || []).filter((s) => !s.archived), by = new Map();
  for (const s of live) { const e = by.get(s.course) || { course: s.course, ids: [] }; e.ids.push(s.id); by.set(s.course, e); }
  if (!by.size) { box.textContent = "No classes yet."; return; }
  let rows = []; try { rows = (await fetchAttendance(sb, live.map((s) => s.id))) || []; } catch (e) { return; }
  const cnt = new Map(); for (const r of rows) cnt.set(r.session_id, (cnt.get(r.session_id) || 0) + 1);
  box.textContent = "";
  const plans = new Map(); { const q = await sb.from("courses").select("name,planned_classes"); if (!q.error) for (const c of q.data || []) if (c.planned_classes) plans.set(String(c.name).toLowerCase(), c.planned_classes); }
  for (const e of Array.from(by.values()).sort((a, b) => b.ids.length - a.ids.length)) {
    const total = e.ids.reduce((n, id) => n + (cnt.get(id) || 0), 0), avg = total / e.ids.length;
    const best = Math.max(1, ...Array.from(by.values()).map((x) => x.ids.reduce((n, id) => n + (cnt.get(id) || 0), 0) / x.ids.length));
    const d = document.createElement("div"); d.className = "cmini";
    const a = document.createElement("b"), b = document.createElement("span"), bar = document.createElement("div"), i = document.createElement("i");
    a.textContent = e.course; b.textContent = e.ids.length + " class" + (e.ids.length === 1 ? "" : "es") + ", avg " + avg.toFixed(1); bar.className = "bar2"; i.style.width = Math.round((avg / best) * 100) + "%"; bar.appendChild(i); d.append(a, b, bar);
    const last = e.ids.slice(0, 12).reverse(), top = Math.max(1, ...last.map((id) => cnt.get(id) || 0)), sp = document.createElement("div"); sp.className = "spark"; sp.title = "Check-ins in your last " + last.length + " classes, oldest on the left";
    for (const id of last) { const u = document.createElement("i"); u.style.height = Math.max(8, ((cnt.get(id) || 0) / top) * 100) + "%"; sp.appendChild(u); }
    const plan = (plans.get(String(e.course).toLowerCase()) || 0);
    if (plan) { const pr = document.createElement("div"); pr.className = "note"; pr.textContent = e.ids.length + " of " + plan + " planned classes held" + (e.ids.length >= plan ? " (done)" : ""); const pb = document.createElement("div"), pi = document.createElement("i"); pb.className = "bar2"; pi.style.width = Math.min(100, Math.round((e.ids.length / plan) * 100)) + "%"; pb.appendChild(pi); d.append(pr, pb); }
    const pbtn = document.createElement("button"); pbtn.type = "button"; pbtn.className = "abtn"; pbtn.textContent = plan ? "Change planned classes" : "Set planned classes";
    pbtn.addEventListener("click", async () => {
      const v = prompt("How many classes do you plan to hold for " + e.course + " this term? (empty = no plan)", plan || ""); if (v === null) return;
      const n = v.trim() === "" ? null : Number(v); if (n !== null && (!Number.isInteger(n) || n < 1 || n > 200)) return toast("Use a whole number from 1 to 200.");
      const r = await sb.rpc("set_course_plan", { p_course: e.course, p_n: n }); if (r.error) return toast(/function|exist/i.test(r.error.message) ? "Run upgrade38.sql in Supabase first." : r.error.message);
      courseSummary(all);
    }); d.appendChild(pbtn);
    d.appendChild(sp); box.appendChild(d);
  }
}
// "Students to follow up": roll students of one course whose attendance is below the chosen percentage.
function fillRiskCourses(all) {
  const sel = $("riskCourse"), keep = sel.value; sel.textContent = "";
  const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Choose a course"; sel.appendChild(o0);
  for (const c of [...new Set((all || []).map((s) => s.course))].sort()) { const o = document.createElement("option"); o.value = o.textContent = c; sel.appendChild(o); }
  sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
}
let riskRows = [];
$("riskGo").addEventListener("click", async () => {
  const course = $("riskCourse").value, thr = Number($("riskThr").value) || 75, min = Number($("riskMin").value) || 3, out = $("riskOut");
  if (!course) { out.textContent = "Choose a course."; return; }
  out.textContent = "Working it out…";
  const sess = mySessions.filter((s) => s.course === course && !s.archived);
  const [roll, atts] = await Promise.all([fetchRolls(course), fetchAttendance(sb, sess.map((s) => s.id))]);
  if (!roll.length) { out.textContent = "There is no class roll for this course yet. Upload one on the Rolls tab."; return; }
  const seen = new Map(); for (const a of atts) seen.set(a.session_id + "|" + String(a.index_number).toUpperCase(), 1);
  riskRows = [];
  for (const r of roll) {
    const held = sess.filter((c) => rollMatchesClass(r, c)); if (held.length < min) continue;
    const idx = String(r.index_number).toUpperCase(), got = held.filter((c) => seen.has(c.id + "|" + idx)).length, pct = Math.round((got / held.length) * 100);
    if (pct < thr) riskRows.push({ name: r.student_name || "", idx, prog: r.programme || "", lvl: r.level || "", got, held: held.length, pct });
  }
  riskRows.sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name));
  out.textContent = "";
  if (!riskRows.length) { out.textContent = "No student is below " + thr + "% (for courses with at least " + min + " classes)."; return; }
  const w = document.createElement("div"); w.className = "table-wrap"; const tb = document.createElement("table");
  tb.innerHTML = "<thead><tr><th>Name</th><th>Index number</th><th>Attended</th><th>Rate</th></tr></thead>"; const bd = document.createElement("tbody");
  for (const r of riskRows) { const tr = document.createElement("tr"); for (const v of [r.name || "-", r.idx, r.got + " of " + r.held, r.pct + "%"]) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); } bd.appendChild(tr); }
  tb.appendChild(bd); w.appendChild(tb); out.appendChild(w);
  const x = document.createElement("button"); x.type = "button"; x.className = "btn quiet"; x.style.marginTop = "10px"; x.textContent = "Download (Excel)";
  x.addEventListener("click", () => downloadXlsx(course + " students to follow up", [{ name: "Follow up", rows: [["Name", "Index number", "Programme", "Level", "Attended", "Classes held", "Rate %"]].concat(riskRows.map((r) => [r.name, r.idx, r.prog, r.lvl, r.got, r.held, r.pct])) }]));
  out.appendChild(x);
});
$("lkGo").addEventListener("click", async () => {
  const idx = $("lkIdx").value.trim().toUpperCase(); if (idx.length < 4) return say("cmsg", "Enter the student's index number.", "warn");
  $("lkOut").textContent = "Looking…";
  try { renderLookup($("lkOut"), await lookupStudent(sb, idx, mySessions), null, idx); } catch (e) { $("lkOut").textContent = "Could not look up: " + (e.message || e); }
});
$("lkIdx").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("lkGo").click(); } });
async function weekStats(all) {
  const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const wk = (all || []).filter((s) => new Date(s.created_at) >= mon);
  $("weekBox").hidden = !wk.length; if (!wk.length) return;
  let rows = []; try { rows = (await fetchAttendance(sb, wk.map((s) => s.id))) || []; } catch (e) { return; }
  const inn = rows.filter((r) => r.in_range).length, stud = new Set(rows.map((r) => r.index_number)).size;
  const box = $("weekStats"); box.textContent = "";
  for (const [n, l] of [[wk.length, "Classes this week"], [rows.length, "Check-ins"], [stud, "Different students"], [rows.length ? Math.round((inn / rows.length) * 100) + "%" : "-", "Inside the class area"]]) {
    const d = document.createElement("div"), b = document.createElement("b"); b.textContent = n; d.append(b, l); box.appendChild(d);
  }
}
async function loadSessions() {
  if (!$("sessions").firstChild) skelList();
  const { data, error } = await sb.from("sessions").select("*").order("created_at", { ascending: false }).limit(200);
  const box = $("sessions"); box.textContent = "";
  if (error) return;
  weekStats(data); mySessions = data; courseSummary(data); fillRiskCourses(data); drawCalendar(data);
  if (!data.length) { box.textContent = "No classes yet."; return; }
  const cq = $("cq").value.trim().toLowerCase(), cf = $("cfilter").value;
  for (const s of data) {
    if (cf && s.course !== cf) continue;
    if (s.archived && !$("showArch").checked) continue;
    const yf = $("yfilter").value, sf = $("sfilter").value;
    if ((yf && s.academic_year !== yf) || (sf && s.semester !== sf)) continue;
    const tf = $("tfilter").value;
    if ((tf === "combined" && !s.combined) || (tf === "single" && s.combined)) continue;
    if (cq && !((s.course || "") + " " + (s.programme || "") + " " + (s.level || "") + " " + (s.class_groups || []).map(groupLabel).join(" ")).toLowerCase().includes(cq)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(current && current.id === s.id));
    b.append(s.course);
    const small = document.createElement("small");
    small.textContent = fmtDay(s.created_at) + ", " + fmtTime(s.created_at) + (s.programme ? "  |  " + s.programme : "") + "  |  code " + s.code + (s.combined ? "  |  Combined" : "") + (s.semester ? "  |  " + (s.academic_year || "") + " " + s.semester : "") + (new Date(s.closes_at) > new Date() ? "  |  Open now" : "  |  Ended");
    b.appendChild(small);
    b.addEventListener("click", () => openSession(s));
    box.appendChild(b);
  }
}

function openSession(s) {
  current = s;
  { let ln = $("lockNote"); if (!ln) { ln = document.createElement("p"); ln.id = "lockNote"; ln.className = "msg warn"; $("liveCourse").after(ln); }
    ln.hidden = !s.locked; ln.textContent = s.locked ? "This class is locked by the admin. You can look at it but not change it." : ""; if (s.locked) $("addm").disabled = true; }
  $("live").hidden = false; showTab("home", true);
  $("classNotes").value = s.notes || ""; $("notesMsg").textContent = ""; phoneAll = []; updateHello();
  $("liveCourse").textContent = s.course + (s.combined ? " (Combined)" : s.programme ? " (" + s.programme + (s.level ? ", " + s.level : "") + ")" : "");
  const gs = s.class_groups || [];
  { const txt = [[s.academic_year, s.semester].filter(Boolean).join(", "), s.combined ? "Combined class. Open to: " + gs.map(groupLabel).join("; ") : ""].filter(Boolean).join("  |  "); $("liveGroups").hidden = !txt; $("liveGroups").textContent = txt; }
  const gf = $("gflt"); gf.hidden = !s.combined; gf.textContent = "";
  { const o = document.createElement("option"); o.value = ""; o.textContent = "All groups"; gf.appendChild(o); }
  gs.forEach((g, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = groupLabel(g); gf.appendChild(o); });
  $("liveCode").textContent = s.code;
  $("liveLink").textContent = studentLink(s.code);
  loadAttendance();
  $("qrBox").hidden = !s.rotating;
  $("pinBox").hidden = !s.rotating;
  $("delClass").hidden = role === "assistant";
  $("endchk").hidden = !s.two_point; $("endchk").textContent = s.end_open ? "Close end-of-class check" : "Open end-of-class check (10 min)";
  lastWin = -1; if (qrTimer) clearInterval(qrTimer); qrTimer = setInterval(tickQr, 1000); tickQr();
  syncClock().then(() => { lastWin = -1; tickQr(); });
  wasOpen = null; beepFor = ""; seenDots = new Set(); projN = -1; rowLimit = 50; openRows = new Set(); knownOut = new Set(); popQueue = []; popId = null; popReady = false; reviewAll = false; $("reviewPop").hidden = true; phoneQ = []; phoneAll = []; phoneSeen = new Set(); $("phonePop").hidden = true; skelRows(); loadRoll(); applyState(); keepAwake();
  stopPolling();
  timer = setInterval(loadAttendance, 8000);
  $("live").scrollIntoView({ behavior: "smooth", block: "start" });
  loadSessions();
}
function stopPolling() { if (timer) clearInterval(timer); timer = null; }
function stopQr() { if (qrTimer) clearInterval(qrTimer); qrTimer = null; }

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

// ---- Same phone, different student: alert with Allow / Reject ----
let phoneQ = [], phoneSeen = new Set(), phoneHidden = false;
let phoneAll = [];
async function loadBlocked() {
  if (!current) { $("phonePop").hidden = true; return; }
  const { data, error } = await sb.from("blocked_attempts").select("*").eq("session_id", current.id).order("at").limit(200);
  if (error || !data) return; // the table only exists after upgrade19.sql
  phoneAll = data;
  let fresh = false;
  const pend = data.filter((b) => b.status === "pending");
  for (const b of pend) if (!phoneSeen.has(b.id)) { phoneSeen.add(b.id); fresh = true; }
  phoneQ = pend;
  if (fresh) { phoneHidden = false; if (isOpen() && !adminHandles()) beep(0.25); }
  showPhonePop(); renderPhoneAlerts(); updateAlerts();
}
function phoneText(b) {
  return "on the same phone that " + (b.device_name || "another student") + (b.device_index ? " (" + b.device_index + ")" : "") + " already used. They are " + (b.in_range === false ? "OUTSIDE the class area" : "inside the class area") + (b.distance_m != null ? " (about " + Math.round(b.distance_m) + " m away)" : "") + ". " + (b.programme || "") + (b.level ? ", " + b.level : "") + ".";
}
const adminHandles = () => byAdmin || popupsOff;
function showPhonePop() {
  const pop = $("phonePop");
  if (!phoneQ.length || phoneHidden || adminHandles()) { pop.hidden = true; return; }
  const b = phoneQ[0];
  $("phWho").textContent = (b.student_name || b.index_number) + "  (" + b.index_number + ")";
  $("phInfo").textContent = "is trying to check in " + phoneText(b);
  $("phMore").textContent = phoneQ.length > 1 ? phoneQ.length - 1 + " more waiting in the Alerts tab." : "You can also decide later in the Alerts tab.";
  pop.hidden = false;
}
async function decidePhone(allow, b) {
  b = b || phoneQ[0]; if (!b) return;
  const { data, error } = await sb.rpc("resolve_blocked", { p_id: b.id, p_allow: allow });
  if (error || (data && data.error)) toast("Could not save: " + ((error && error.message) || data.error));
  else toast(allow ? (b.student_name || b.index_number) + " added as present." : "Rejected.");
  await loadBlocked(); loadAttendance();
}
function renderPhoneAlerts() {
  const pend = phoneAll.filter((b) => b.status === "pending"), done = phoneAll.filter((b) => b.status !== "pending");
  $("phoneBox").hidden = !pend.length; $("phoneN").textContent = pend.length;
  const L = $("phoneList"); L.textContent = "";
  for (const b of pend) {
    const row = document.createElement("div"); row.className = "rvrow";
    const info = document.createElement("div"); info.className = "rvinfo";
    const n = document.createElement("b"); n.textContent = (b.student_name || b.index_number) + " (" + b.index_number + ")";
    const sp = document.createElement("span"); sp.textContent = "Tried " + phoneText(b);
    info.append(n, sp);
    const acts = document.createElement("div"); acts.className = "acts";
    if (adminHandles()) { const w = document.createElement("span"); w.className = "note"; w.textContent = "The admin is handling this one."; acts.appendChild(w); }
    else acts.append(rvBtn("Allow", "ok", () => decidePhone(true, b)), rvBtn("Reject", "bad", () => decidePhone(false, b)));
    row.append(info, acts); L.appendChild(row);
  }
  const D = $("phoneDone"); D.textContent = ""; $("phoneHist").hidden = !done.length;
  for (const b of done) { const p = document.createElement("p"); p.className = "note"; p.textContent = (b.student_name || b.index_number) + " (" + b.index_number + "): " + (b.status === "allowed" ? "allowed" : "rejected"); D.appendChild(p); }
}
$("phAllow").addEventListener("click", () => decidePhone(true));
$("phReject").addEventListener("click", () => decidePhone(false));
$("phLater").addEventListener("click", () => { phoneHidden = true; showPhonePop(); toast("Saved in the Alerts tab. Come back to it any time."); });

// ---- Sections (tabs) ----
const TABS = ["home", "alerts", "rolls", "classes", "account"];
function showTab(name, keepScroll) {
  for (const x of TABS) $("p-" + x).hidden = x !== name;
  document.querySelectorAll("#tabs [data-p]").forEach((b) => { const on = b.dataset.p === name; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
  if (!keepScroll) window.scrollTo({ top: 0 });
  if (name === "alerts") updateAlerts();
}
document.querySelectorAll("#tabs [data-p]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.p)));
function updateAlerts() {
  const review = current ? records.filter(needsReview).length : 0, phone = current ? phoneQ.length : 0, n = review + phone;
  $("alertN").textContent = n > 9 ? "9+" : n; $("alertN").hidden = !n;
  $("alertEmpty").hidden = n > 0 || (current && phoneAll.length > 0);
  $("alertEmpty").textContent = current ? "No alerts for this class right now. They appear here as they come in." : "Open a class on the Home tab to see its alerts here.";
}
function updateHello() {
  const h = new Date().getHours(), part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  $("helloT").textContent = myName ? part + ", " + myName.split(" ")[0] : "Welcome";
  const live = current && !$("live").hidden && isOpen();
  $("helloS").textContent = live ? "Class running: " + current.course : current && !$("live").hidden ? "Last class: " + current.course + " (closed)" : "Start a class below, or open an earlier one from the Classes tab.";
  $("helloGo").hidden = !(current && !$("live").hidden);
}
$("helloGo").addEventListener("click", () => { showTab("home", true); $("live").scrollIntoView({ behavior: "smooth", block: "start" }); });

// ---- Class notes ----
$("saveNotes").addEventListener("click", async () => {
  if (!current) return;
  const notes = $("classNotes").value.trim() || null;
  const { error } = await sb.from("sessions").update({ notes }).eq("id", current.id);
  if (error) return say("notesMsg", /notes/.test(error.message) ? "Run upgrade21.sql in Supabase first." : "Could not save: " + error.message, "bad");
  current.notes = notes; say("notesMsg", "Saved.", "ok");
});

// ---- Absent list: Excel and a message to send ----
$("absXlsx").addEventListener("click", () => {
  const list = absentees(); if (!current || !list.length) return toast("Nobody is absent.");
  downloadXlsx(current.course + " absent " + fmtDay(current.created_at), [{ name: "Absent", rows: [["Name", "Index number", "Programme", "Level"]].concat(list.map((r) => [r.student_name || "", r.index_number, r.programme || current.programme || "", r.level || current.level || ""])) }]);
});
$("absCopy").addEventListener("click", async () => {
  const list = absentees(); if (!current || !list.length) return toast("Nobody is absent.");
  const txt = "Dear students,\n\nThe following students were absent from " + current.course + " on " + fmtDay(current.created_at) + ":\n\n"
    + list.map((r, i) => (i + 1) + ". " + (r.student_name || "-") + " (" + r.index_number + ")").join("\n")
    + "\n\nPlease contact me as soon as possible. If you were present but could not check in, tell me and I will update the record.\n\n" + (myName || "");
  toast((await copyText(txt)) ? "Message copied. Paste it into WhatsApp or email." : "Could not copy. Try again.");
});

// ---- Programme and level lists (the admin can change them) ----
onCatalog(() => {
  for (const id of ["tprog", "gprog", "rollProg"]) refillSelect($(id), fillProgrammes);
  refillSelect($("tlevel"), (s) => fillLevels(s, false)); refillSelect($("glevel"), (s) => fillLevels(s, true)); refillSelect($("rollLevel"), (s) => fillLevels(s, false));
});
loadCatalog(sb);

// ---- Printable course attendance sheet for one programme and level ----
$("sheetBtn").addEventListener("click", async () => {
  const course = $("rollCourse").value, prog = $("rollProg").value, lvl = $("rollLevel").value;
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  say("rollMsg", "Preparing the sheet...");
  const [{ data: cls }, roll] = await Promise.all([sessQ(course, true), fetchRolls(course)]);
  const mine = (cls || []).filter((c) => classMatchesGroup(c, prog, lvl));
  const atts = mine.length ? await fetchAttendance(sb, mine.map((c) => c.id)) : [];
  say("rollMsg", "");
  openCourseSheet({ course, programme: prog, level: lvl, lecturer: myName || myEmail, classes: mine, atts, roll });
});

async function loadAttendance() {
  if (!current) return;
  const { data, error } = await sb.from("attendance").select("*").eq("session_id", current.id).order("checked_in_at");
  if (error) return;
  records = data;
  const shared = sharedIndexes(data);
  for (const r of records) r._shared = !!(r.device_id && shared.has(r.device_id));
  renderRows(); feedReview(); loadBlocked(); updateAlerts(); updateHello();
}
function renderRows() {
  const q = $("q").value.trim().toLowerCase(), f = $("flt").value;
  const list = records.filter((r) => {
    if (q && !((r.student_name || "") + " " + r.index_number).toLowerCase().includes(q)) return false;
    const gi = $("gflt").value;
    if (gi !== "" && current.combined) { const g = (current.class_groups || [])[Number(gi)]; if (g && !(r.programme === g.programme && (g.level === "All levels" || r.level === g.level))) return false; }
    return f === "all" || (f === "in" && r.in_range) || (f === "out" && !r.in_range) || (f === "shared" && r._shared) || (f === "manual" && r.manual) || (f === "late" && r.late) || (f === "flag" && r.gps_flag);
  });
  const [sk, sd] = sortBy; list.sort((a, b) => ((a[sk] ?? "") > (b[sk] ?? "") ? 1 : (a[sk] ?? "") < (b[sk] ?? "") ? -1 : 0) * sd);
  const body = $("rows"); body.textContent = "";
  for (const r of list.slice(0, rowLimit)) {
    const tr = document.createElement("tr"); tr.className = "rowin" + (openRows.has(r.id) ? " open" : "");
    tr.addEventListener("click", (e) => { if (e.target.closest("button")) return; tr.classList.toggle("open"); if (tr.classList.contains("open")) openRows.add(r.id); else openRows.delete(r.id); });
    tr.style.background = r.in_range ? "#d9f2dd" : "#f9d6d6"; tr.style.color = "#1a1a1a";
    for (const c of [nameCell(r), r.index_number, r.programme, r.level || "-", fmtTime(r.checked_in_at), Math.round(r.distance_m) + " m", trustBadge(r), noteOf(r)]) {
      const td = document.createElement("td"); if (c instanceof Node) td.appendChild(c); else td.textContent = c; tr.appendChild(td);
    }
    const act = document.createElement("td");
    const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); act.appendChild(b); };
    if (allowed("edit_checkins")) mk("Edit", () => editCheckin(r));
    mk(r.in_range ? "Mark outside" : "Accept", () => (r.in_range ? updateRec(r, { in_range: false, manual: true }) : acceptRec(r)));
    if (role !== "assistant") mk("Remove", () => removeRecord(r));
    tr.appendChild(act); Array.from(tr.children).forEach((td, i) => { td.dataset.label = ROW_LABELS[i] || ""; }); body.appendChild(tr);
  }
  const inside = records.filter((r) => r.in_range).length, sc = records.filter((r) => r._shared).length;
  const open = new Date(current.closes_at) > new Date();
  $("stats").innerHTML = "";
  for (const [n, l] of [[records.length, "Checked in"], [inside, "In class area"], [records.length - inside, "Outside"], [sc, "Shared phone"], [records.filter((r) => r.late).length, "Late"], [records.filter((r) => r.gps_flag).length, "GPS warnings"]]) {
    const d = document.createElement("div"); const b = document.createElement("b"); b.textContent = n; d.append(b, l); $("stats").appendChild(d);
  }
  renderAbsent(); renderGroupSum(); applyState(); renderRadar(); updateProj(); renderReview();
  $("moreRows").hidden = list.length <= rowLimit; $("moreRows").textContent = "Show more (" + (list.length - rowLimit) + " left)";
  say("count", (open ? "Check-in is open until " + fmtTime(current.closes_at) + "." : "Check-in is closed.") + " Showing " + Math.min(list.length, rowLimit) + " of " + records.length + ".");
}
document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { sortBy = [th.dataset.k, sortBy[0] === th.dataset.k ? -sortBy[1] : 1]; renderRows(); }));
$("cq").addEventListener("input", loadSessions);
$("q").addEventListener("input", renderRows); $("flt").addEventListener("change", renderRows);
$("more").addEventListener("click", async () => {
  const base = Math.max(Date.now(), new Date(current.closes_at).getTime());
  const t = new Date(base + 600000).toISOString();
  const { error } = await sb.from("sessions").update({ closes_at: t }).eq("id", current.id);
  if (!error) { current.closes_at = t; applyState(); renderRows(); loadSessions(); toast("Added 10 minutes."); }
});
// Add a student by hand. In a combined class the lecturer also picks the student's programme and level, so the sheets separate them.
function manualDialog() {
  return new Promise((resolve) => {
    const groups = current.combined ? (current.class_groups || []) : [];
    const back = document.createElement("div");
    back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px";
    const form = document.createElement("form"); form.className = "card"; form.style.cssText = "max-width:440px;width:100%;max-height:92vh;overflow:auto;margin:0";
    const add = (label, el) => { const l = document.createElement("label"); l.textContent = label; form.append(l, el); return el; };
    const h = document.createElement("h2"); h.textContent = "Add student manually"; form.appendChild(h);
    const nm = add("Full name", Object.assign(document.createElement("input"), { maxLength: 100, required: true, autocomplete: "off" }));
    const ix = add("Index number", Object.assign(document.createElement("input"), { maxLength: 30, required: true, autocomplete: "off" }));
    const pr = document.createElement("select"), lv = document.createElement("select");
    const opt = (sel, v, tx) => { const o = document.createElement("option"); o.value = v; o.textContent = tx || v; sel.appendChild(o); };
    if (groups.length) {
      add("Programme", pr); add("Level", lv);
      opt(pr, "", "Select the programme");
      for (const p of Array.from(new Set(groups.map((g) => g.programme)))) opt(pr, p);
      const fillLv = () => {
        lv.textContent = ""; opt(lv, "", "Select the level");
        const ls = groups.filter((g) => g.programme === pr.value).map((g) => g.level);
        const all = ls.includes("All levels") ? ROLL_LEVELS : Array.from(new Set(ls));
        for (const l of all) opt(lv, l);
        if (all.length === 1) lv.value = all[0];
      };
      pr.addEventListener("change", fillLv); fillLv();
      pr.required = lv.required = true;
    } else {
      const p = add("Programme", Object.assign(document.createElement("input"), { value: current.programme || "-", disabled: true }));
      add("Level", Object.assign(document.createElement("input"), { value: current.level || "-", disabled: true }));
    }
    const row = document.createElement("div"); row.className = "row"; row.style.marginTop = "14px";
    const ok = Object.assign(document.createElement("button"), { type: "submit", className: "btn", textContent: "Add student" });
    const no = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Cancel" });
    const err = document.createElement("p"); err.className = "msg bad"; err.setAttribute("role", "status");
    row.append(ok, no); form.append(row, err); back.appendChild(form); document.body.appendChild(back); nm.focus();
    const done = (v) => { back.remove(); resolve(v); };
    no.addEventListener("click", () => done(null));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const idx = ix.value.trim().toUpperCase(), name = nm.value.trim().replace(/\s+/g, " ");
      if (name.length < 3) return (err.textContent = "Enter the student's full name.");
      if (!/^[A-Z0-9\/\-]{4,30}$/.test(idx)) return (err.textContent = "Enter a valid index number.");
      done({ idx, name, programme: groups.length ? pr.value : current.programme || "-", level: groups.length ? lv.value : current.level || "-" });
    });
  });
}
// A notice with the student's details after the lecturer adds someone by hand. "Add another" reopens the form.
function addedNotice(v) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px";
    const box = document.createElement("div"); box.className = "card"; box.style.cssText = "max-width:420px;width:100%;margin:0"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    const h = document.createElement("h2"); h.textContent = "Student added"; box.appendChild(h);
    const dl = document.createElement("div"); dl.className = "reqbox"; dl.style.margin = "10px 0";
    for (const [k, val] of [["Name", v.name], ["Index number", v.idx], ["Programme", v.programme], ["Level", v.level], ["Class", current.course], ["Marked", "Present, added by you at " + fmtTime(new Date().toISOString())]]) {
      if (!val || val === "-") continue;
      const p = document.createElement("p"); p.style.margin = "4px 0"; const b = document.createElement("b"); b.textContent = k + ": "; p.append(b, document.createTextNode(val)); dl.appendChild(p);
    }
    box.appendChild(dl);
    const row = document.createElement("div"); row.className = "row";
    const ok = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "OK" });
    const more = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Add another student" });
    row.append(ok, more); box.appendChild(row); back.appendChild(box); document.body.appendChild(back); ok.focus();
    const done = (again) => { back.remove(); resolve(again); };
    ok.addEventListener("click", () => done(false)); more.addEventListener("click", () => done(true));
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") done(false); });
  });
}
async function addManual() {
  const v = await manualDialog(); if (!v) return;
  const { error } = await sb.from("attendance").insert({ session_id: current.id, index_number: v.idx, student_name: v.name,
    programme: v.programme, level: v.level, lat: current.lat, lng: current.lng, accuracy_m: 0, distance_m: 0, in_range: true, manual: true, note: "Added by lecturer" });
  say("count", error ? (error.code === "23505" ? "That index number is already in this class." : "Could not add: " + error.message) : "Student added.", error ? "bad" : "ok");
  loadAttendance();
  if (!error && await addedNotice(v)) addManual();
}
$("addm").addEventListener("click", addManual);

function classMessage() {
  const term = [current.academic_year, current.semester].filter(Boolean).join(", ");
  return "Attendance: " + current.course + (term ? " (" + term + ")" : "") + "\nOpen this link on your phone and tap Check in:\n" + studentLink(current.code) + "\nClass code: " + current.code + "\nCheck-in closes at " + fmtTime(current.closes_at) + ".";
}
const rotNote = () => { if (current.rotating) toast("Rotating code is on, so students also need the 6-digit screen code. With no projector, start the class with Rotating QR switched off.", { ms: 10000 }); };
$("copy").addEventListener("click", async () => { const ok = await copyText(studentLink(current.code)); toast(ok ? "Link copied. Paste it in your class group." : "Copy failed. Select the link above and copy it."); if (ok) rotNote(); });
$("copyMsg").addEventListener("click", async () => { const ok = await copyText(classMessage()); toast(ok ? "Message copied. Paste it in your class group." : "Copy failed."); if (ok) rotNote(); });
$("shareBtn").addEventListener("click", async () => { try { await navigator.share({ title: "Attendance: " + current.course, text: classMessage() }); rotNote(); } catch (e) {} });

$("close").addEventListener("click", async () => {
  if (!confirm("Close check-in now? Students will no longer be able to check in.")) return;
  const now = new Date().toISOString();
  const { error } = await sb.from("sessions").update({ closes_at: now }).eq("id", current.id);
  if (!error) { current.closes_at = now; applyState(); loadAttendance(); loadSessions(); toast("Check-in closed.", { action: "Reopen 10 min", onAction: () => { $("reopenMins").value = "10"; $("reopen").click(); } }); }
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
  const c = Object.assign({}, current, { _owner: myName || myEmail });
  downloadXlsx(current.course + " " + fmtDay(current.created_at), buildSheets([c], records, absentees().map((r) => [r.student_name || "", r.index_number, r.programme || "", r.level || ""])));
});
$("cxlsx").addEventListener("click", async () => {
  if (role === "assistant") return;
  const course = $("cfilter").value;
  if (!course) return say("cmsg", "Pick a course in the course filter first.", "warn");
  say("cmsg", "Preparing the spreadsheet...");
  let qb = sb.from("sessions").select("*").eq("course", course);
  if ($("yfilter").value) qb = qb.eq("academic_year", $("yfilter").value);
  if ($("sfilter").value) qb = qb.eq("semester", $("sfilter").value);
  const { data: cls } = await qb.order("created_at", { ascending: false });
  if (!cls || !cls.length) return say("cmsg", "No classes found for that course.", "warn");
  const atts = await fetchAttendance(sb, cls.map((c) => c.id));
  for (const c of cls) c._owner = myName || myEmail;
  downloadXlsx(course + " all classes", buildSheets(cls, atts));
  say("cmsg", "Downloaded.", "ok");
});


// ---- Rotating screen code ----
// The screen code lasts for the whole class (database functions check_in and get_pass, upgrade23.sql).
// Adding time to the class keeps the same code running; the bar below it shows the class time left.
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
  if (!current || !current.rotating || !current.secret || !isOpen()) return;
  const now = Date.now() / 1000 + clockOffset, end = new Date(current.closes_at).getTime() / 1000, total = Math.max(60, end - new Date(current.opens_at).getTime() / 1000), left = Math.max(0, end - now), w = 0;
  $("cd").style.width = Math.min(100, (left / total) * 100) + "%";
  const lm = Math.floor(left / 60), ls = Math.floor(left % 60); if ($("cdTxt")) $("cdTxt").textContent = "Code valid for " + lm + ":" + String(ls).padStart(2, "0") + " more (until the class ends)";
  if (w === lastWin) return;
  lastWin = w;
  const t = await tokenFor(current.secret, w);
  current._tok = t; $("pin").textContent = t.slice(0, 3) + " " + t.slice(3);
  $("liveLink").textContent = studentLink(current.code);
  if (!$("qrBox").hidden) drawQr();
  if (!$("qrFs").hidden) drawFs();
  if (!$("proj").hidden) drawProj(true);
}
$("endchk").addEventListener("click", async () => {
  const open = !current.end_open;
  const patch = { end_open: open, closes_at: open ? new Date(Date.now() + 600000).toISOString() : new Date().toISOString() };
  const { error } = await sb.from("sessions").update(patch).eq("id", current.id);
  if (error) return say("count", "Could not change the end check: " + error.message, "bad");
  Object.assign(current, patch); applyState();
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
  const all = await fetchRolls(current.course);
  // Only students of this class's programme(s) and level(s). Older rolls saved without a programme or level still count.
  rollRows = all.filter((r) => rollMatchesClass(r, current));
  excuses = [];
  { const x = await sb.from("excuses").select("*").eq("session_id", current.id); if (!x.error) excuses = x.data || []; }
  renderAbsent();
}
// Rolls can hold more than 1000 rows, and the database returns 1000 at a time.
async function fetchRolls(course) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("rolls").select("*").eq("course", course).order("id").range(from, from + 999);
    if (error || !data) break;
    all = all.concat(data); if (data.length < 1000) break;
  }
  return all;
}
// Saved rolls for the chosen course, one line per programme, each with a Delete button.
async function renderSavedRolls() {
  const box = $("savedRolls"), course = $("rollCourse").value; box.textContent = "";
  if (!course) return;
  const all = await fetchRolls(course);
  if (course !== $("rollCourse").value) return;
  if (!all.length) { box.textContent = "No roll saved for this course yet."; return; }
  const by = new Map(); for (const r of all) { const k = (r.programme || "").trim() + "\u0001" + (r.level || "").trim(); const e = by.get(k) || { prog: (r.programme || "").trim(), lvl: (r.level || "").trim(), ids: [] }; e.ids.push(r.id); by.set(k, e); }
  const h = document.createElement("b"); h.textContent = "Saved rolls for this course"; box.appendChild(h);
  for (const g of by.values()) {
    const n = g.ids.length, row = document.createElement("div"); row.className = "absrow";
    const s = document.createElement("span"); s.textContent = (g.prog || "No programme (older upload)") + " | " + (g.lvl || "Level not set") + ": " + n + " student" + (n === 1 ? "" : "s");
    row.appendChild(s);
    if (role !== "assistant" && allowed("delete_rolls")) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet danger"; b.textContent = "Delete roll";
      b.addEventListener("click", () => deleteRoll(course, g));
      row.appendChild(b);
    }
    box.appendChild(row);
  }
}
async function deleteRoll(course, g) {
  if (!confirm("Delete the saved roll for " + course + " (" + (g.prog || "no programme") + ", " + (g.lvl || "level not set") + "), " + g.ids.length + " students? Attendance records are not affected.\n\nIt is kept in the admin Trash for 3 months. Ask the admin if you need it restored.")) return;
  const { n, error } = await deleteRollIds(sb, g.ids);
  if (error) return say("rollMsg", "Could not delete the roll: " + error.message, "bad");
  say("rollMsg", n ? "Roll deleted (" + n + " students)." : "Nothing was deleted. You can only delete rolls you uploaded.", n ? "ok" : "warn");
  renderSavedRolls(); if (current && current.course === course) loadRoll();
}
$("rollCourse").addEventListener("change", renderSavedRolls);
fillProgrammes($("rollProg")); fillLevelSel($("rollLevel"));
let excuses = [];
function absentees() {
  const here = new Set(records.map((r) => String(r.index_number).toUpperCase()));
  const exc = new Set(excuses.map((e) => String(e.index_number).toUpperCase()));
  return rollRows.filter((r) => !here.has(r.index_number) && !exc.has(String(r.index_number).toUpperCase()));
}
function renderAbsent() {
  const box = $("absent");
  if (!rollRows.length) { box.hidden = true; return; }
  renderExcused(); const list = absentees(); box.hidden = false; $("absN").textContent = list.length;
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
      if (!error) addedNotice({ name: r.student_name || r.index_number, idx: r.index_number, programme: r.programme || current.programme, level: r.level || current.level });
    });
    const ex = document.createElement("button"); ex.type = "button"; ex.className = "btn quiet"; ex.textContent = "Excuse";
    ex.addEventListener("click", async () => {
      const why = prompt("Why is " + (r.student_name || r.index_number) + " excused? (for example: sick, permission, school event)", ""); if (why === null) return;
      const { error } = await sb.from("excuses").insert({ session_id: current.id, index_number: r.index_number, student_name: r.student_name || null, reason: why.trim().slice(0, 200) || null });
      say("count", error ? (/excuses/.test(error.message) ? "Run upgrade31.sql in Supabase first." : "Could not excuse: " + error.message) : "Excused.", error ? "bad" : "ok"); if (!error) loadRoll();
    });
    row.append(s, b, ex); L.appendChild(row);
  }
}
function renderExcused() {
  const box = $("excBox"); if (!box) return;
  box.hidden = !excuses.length; $("excN").textContent = excuses.length; const L = $("excList"); L.textContent = "";
  for (const e of excuses) {
    const row = document.createElement("div"); row.className = "absrow";
    const s = document.createElement("span"); s.textContent = (e.student_name || "-") + " (" + e.index_number + ")" + (e.reason ? ": " + e.reason : "");
    const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet"; b.textContent = "Undo";
    b.addEventListener("click", async () => { await sb.from("excuses").delete().eq("id", e.id); loadRoll(); });
    row.append(s, b); L.appendChild(row);
  }
}

// ---- Class roll: upload ----
$("rollUp").addEventListener("click", async () => {
  const course = $("rollCourse").value, prog = $("rollProg").value, lvl = $("rollLevel").value, f = $("rollFile").files[0];
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  if (!prog) return say("rollMsg", "Choose the programme this roll is for.", "warn");
  if (!lvl) return say("rollMsg", "Choose the level this roll is for.", "warn");
  if (!f) return say("rollMsg", "Choose a CSV or Excel file first.", "warn");
  if (!window.XLSX) return say("rollMsg", "The Excel library did not load. Check your internet.", "bad");
  say("rollMsg", "Reading the file...");
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    if (rows.length < 2) return say("rollMsg", "The file has no student rows.", "bad");
    const head = rows[0].map((h) => String(h).toLowerCase());
    const find = (re, fb) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fb; };
    const ci = find(/index|student\s*(id|no)|reg|^id$/, 0), cn = find(/^(full |student )?name/, 1);
    const map = new Map(); let skipped = 0;
    for (const r of rows.slice(1)) {
      const idx = String(r[ci] || "").trim().toUpperCase();
      if (!/^[A-Z0-9\/\-]{4,30}$/.test(idx)) { if (idx || r.some((x) => String(x).trim())) skipped++; continue; }
      map.set(idx, { course, index_number: idx, student_name: String(r[cn] || "").trim().slice(0, 100) || null, programme: prog, level: lvl });
    }
    if (!map.size) return say("rollMsg", "No valid index numbers found. Check the column headings.", "bad");
    const { data: { session } } = await sb.auth.getSession();
    const list = Array.from(map.values()).map((x) => Object.assign(x, { owner: session.user.id }));
    // Replace only this programme and level's roll. Also clear these index numbers from other rolls of the course, so nobody is listed twice.
    const old = (await fetchRolls(course)).filter((r) => sameText(r.programme, prog) && levelKey(r.level) === levelKey(lvl)).map((r) => r.id);
    const d1 = await deleteRollIds(sb, old);
    if (d1.error) return say("rollMsg", "Could not replace the old roll: " + d1.error.message, "bad");
    for (let i = 0; i < list.length; i += 200) {
      const d2 = await sb.from("rolls").delete().eq("course", course).in("index_number", list.slice(i, i + 200).map((x) => x.index_number));
      if (d2.error) return say("rollMsg", "Could not replace the old roll: " + d2.error.message, "bad");
    }
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await sb.from("rolls").insert(list.slice(i, i + 200));
      if (error) return say("rollMsg", "Upload failed: " + error.message, "bad");
    }
    say("rollMsg", "Roll saved for " + prog + ", " + lvl + ": " + list.length + " students" + (skipped ? ", " + skipped + " rows skipped (invalid index number)." : "."), "ok");
    $("rollFile").value = ""; renderSavedRolls(); if (current && current.course === course) loadRoll();
  } catch (e) { say("rollMsg", "Could not read that file.", "bad"); }
});

// ---- Attendance report and at-risk list ----
$("rep").addEventListener("click", async () => {
  const course = $("rollCourse").value, prog = $("rollProg").value, lvl = $("rollLevel").value, thr = Number($("thr").value) || 75;
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  say("rollMsg", "Working out the report...");
  let [{ data: cls }, roll] = await Promise.all([sessQ(course, true), fetchRolls(course)]);
  if (prog) {
    const eq = (a) => sameText(a, prog), lk = (x) => !lvl || levelKey(x) === levelKey(lvl);
    cls = (cls || []).filter((c) => c.combined ? (c.class_groups || []).some((g) => eq(g.programme) && (!lvl || g.level === "All levels" || lk(g.level))) : eq(c.programme) && lk(c.level));
    roll = roll.filter((r) => eq(r.programme) && lk(r.level));
  } else if (new Set(roll.map((r) => (r.programme || "").trim())).size > 1) {
    return say("rollMsg", "This course has rolls for several programmes. Choose a programme (and level) above to get its report.", "warn");
  }
  if (!cls || !cls.length) return say("rollMsg", "No classes found for that course" + (prog ? " and programme" : "") + (lvl ? " and level" : "") + " yet.", "warn");
  let atts = await fetchAttendance(sb, cls.map((c) => c.id));
  if (prog) atts = atts.filter((a) => sameText(a.programme, prog) && (!lvl || levelKey(a.level) === levelKey(lvl)));
  const st = new Map();
  for (const r of roll) st.set(r.index_number, { name: r.student_name || "", set: new Set() });
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


// ---- Combined classes ----
const groupLabel = (g) => g.programme + " (" + g.level + ")";
fillProgrammes($("gprog"));
function setType() {
  const comb = document.querySelector('input[name="ctype"]:checked').value === "combined";
  $("singleBox").hidden = comb; $("combBox").hidden = !comb;
  $("tprog").required = !comb; $("tlevel").required = !comb;
}
document.querySelectorAll('input[name="ctype"]').forEach((r) => r.addEventListener("change", setType));
function drawChips() {
  const box = $("gchips"); box.textContent = "";
  groups.forEach((g, i) => {
    const c = document.createElement("span"); c.className = "chip"; c.textContent = groupLabel(g);
    const x = document.createElement("button"); x.type = "button"; x.setAttribute("aria-label", "Remove " + groupLabel(g)); x.textContent = "\u00d7";
    x.addEventListener("click", () => { groups.splice(i, 1); drawChips(); });
    c.appendChild(x); box.appendChild(c);
  });
}
$("gadd").addEventListener("click", () => {
  const p = $("gprog").value, l = $("glevel").value;
  if (!p || !l) return say("startMsg", "Choose a programme and a level to add.", "warn");
  if (groups.some((g) => g.programme === p && g.level === l)) return say("startMsg", "That programme and level is already added.", "warn");
  if (groups.length >= 12) return say("startMsg", "You can add up to 12 groups.", "warn");
  groups.push({ programme: p, level: l }); drawChips(); say("startMsg", "");
});
function renderGroupSum() {
  const box = $("groupSum");
  if (!current || !current.combined) { box.hidden = true; return; }
  box.hidden = false; box.textContent = "";
  for (const g of current.class_groups || []) {
    const n = records.filter((r) => r.programme === g.programme && (g.level === "All levels" || r.level === g.level)).length;
    const c = document.createElement("span"); c.className = "chip"; c.textContent = groupLabel(g) + ": " + n; box.appendChild(c);
  }
}
$("tfilter").addEventListener("change", loadSessions);
$("gflt").addEventListener("change", renderRows);
setType();


// ---- Academic year and semester ----
function startYear() { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 7 ? y : y - 1; }
function academicYears() { const s = startYear(); return [s + 1, s, s - 1, s - 2].map((a) => a + "/" + (a + 1)); }
function sessQ(course, wide) {
  let q = sb.from("sessions").select(wide ? "id,programme,level,combined,class_groups,created_at,academic_year,semester" : "id").eq("course", course);
  if ($("repYear").value) q = q.eq("academic_year", $("repYear").value);
  if ($("repSem").value) q = q.eq("semester", $("repSem").value);
  return q;
}
for (const id of ["tyear", "yfilter", "repYear"]) {
  const sel = $(id);
  for (const y of academicYears()) { const o = document.createElement("option"); o.value = y; o.textContent = y; sel.appendChild(o); }
}
{
  let y = startYear() + "/" + (startYear() + 1), sm = new Date().getMonth() >= 7 ? "Semester 1" : "Semester 2";
  try { y = localStorage.getItem("ktu_tyear") || y; sm = localStorage.getItem("ktu_tsem") || sm; } catch (e) {}
  $("tyear").value = academicYears().includes(y) ? y : academicYears()[1]; $("tsem").value = sm;
  // The admin's current term is the default when this browser has no earlier choice.
  sb.rpc("get_public_settings").then(({ data }) => { try {
    if (!data || !(data.year || data.semester)) return;
    const mark = (data.year || "") + "|" + (data.semester || ""), seen = localStorage.getItem("ktu_admin_term");
    // Use the admin's term when it is new to this browser, or when no choice was made here before.
    if (seen === mark || (seen === null && localStorage.getItem("ktu_tyear"))) { if (seen === null) localStorage.setItem("ktu_admin_term", mark); return; }
    if (data.year && academicYears().includes(data.year)) $("tyear").value = data.year; if (data.semester) $("tsem").value = data.semester;
    localStorage.setItem("ktu_admin_term", mark);
  } catch (e) {} });
}
$("yfilter").addEventListener("change", loadSessions); $("sfilter").addEventListener("change", loadSessions);


// Keep the screen on while a rotating QR is showing, and refresh the code when the tab returns.
let wake = null;
async function keepAwake() {
  try { if (current && current.rotating && isOpen() && navigator.wakeLock && !document.hidden) wake = await navigator.wakeLock.request("screen"); } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { keepAwake(); tickQr(); } });


// ---- Your name: saved once, then only the admin can change it ----
let requesting = false, pendingName = "";
$("saveName").addEventListener("click", async () => {
  const name = $("myName").value.trim().replace(/\s+/g, " ").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  if (name.length < 3) return say("nameMsg", "Enter your full name.", "warn");
  if (requesting) {
    const { error } = await sb.rpc("request_name_change", { p_name: name });
    if (error) return say("nameMsg", "Could not send: " + error.message, "bad");
    requesting = false; pendingName = name; say("nameMsg", "Request sent. The admin will review it.", "ok"); return applyName();
  }
  const { error } = await sb.rpc("set_my_name", { p_name: name });
  if (error) return say("nameMsg", "Could not save: " + error.message, "bad");
  myName = name; say("nameMsg", "Saved. Your Excel files will now show this name.", "ok"); applyName();
});
$("reqName").addEventListener("click", () => { requesting = true; $("myName").value = ""; applyName(); $("myName").focus(); });

// ---- Welcome line and first-time name prompt ----
const roleLabel = (r) => (r === "assistant" ? "Teaching assistant" : r === "admin" ? "Admin" : "Lecturer");
function applyName() {
  const need = !myName, locked = !!myName && role !== "admin", card = $("nameCard"), app = $("app");
  $("who").textContent = need ? "Welcome. Please add your full name to continue." : "Welcome, " + myName + "  |  " + roleLabel(role);
  $("start").hidden = need; $("tabs").classList.toggle("locked", need);
  if (need) { showTab("account", true); card.querySelector("h2").textContent = "What is your name?"; }
  else { card.querySelector("h2").textContent = "Your name"; }
  updateHello();
  if (!requesting) $("myName").value = myName;
  $("myName").disabled = locked && !requesting;
  $("saveName").hidden = locked && !requesting;
  $("saveName").textContent = requesting ? "Send request" : "Save name";
  $("reqName").hidden = !locked || requesting;
  $("reqInfo").hidden = !pendingName; $("reqInfo").textContent = pendingName ? "Request pending: " + pendingName + ". The admin will review it." : "";
  $("nameNote").textContent = need ? "Type your full name. You can only set it once, so check the spelling."
    : requesting ? "Type the name you want. The admin must approve it before it changes."
    : locked ? "Your name is saved. Only the admin can change it. If it needs correcting, send a request."
    : "This name appears on your Excel files and on the student page.";
}


// ---- Open or ended class: show the right controls ----
const isOpen = () => !!current && new Date(current.closes_at) > new Date();
function applyState() {
  if (!current) return;
  const open = isOpen(), st = $("liveStatus");
  st.textContent = open ? "Check-in open" : "Check-in ended"; st.className = "badge " + (open ? "on" : "off");
  $("close").hidden = !open; $("more").hidden = !open; $("reopenBox").hidden = open;
  $("qr").hidden = !open; $("copy").hidden = !open; $("copyMsg").hidden = !open; $("shareBtn").hidden = !open || !navigator.share;
  $("pinBox").hidden = !(open && current.rotating);
  if (!open) { $("qrBox").hidden = true; $("qrFs").hidden = true; stopQr(); }
  else if (current.rotating) { $("qrBox").hidden = false; if (!qrTimer) { lastWin = -1; qrTimer = setInterval(tickQr, 1000); tickQr(); keepAwake(); } }
  renderBar();
}
$("reopen").addEventListener("click", async () => {
  const t = new Date(Date.now() + Number($("reopenMins").value) * 60000).toISOString();
  const { error } = await sb.from("sessions").update({ closes_at: t }).eq("id", current.id);
  if (error) return say("count", "Could not reopen: " + error.message, "bad");
  current.closes_at = t; applyState(); loadAttendance(); loadSessions();
  say("count", "Check-in reopened.", "ok"); toast("Check-in reopened.");
});


// ---- Confidence badge ----
function trustOf(r) {
  const rad = current.radius_m, why = [];
  if (!r.in_range) return { lv: "low", label: "Outside", why: [Math.round(r.distance_m) + " m from you (allowed " + rad + " m)"] };
  if (r.gps_flag) why.push(r.gps_flag);
  if (r._shared) why.push("This phone was used for another student");
  if ((r.accuracy_m || 0) > 60) why.push("Weak GPS (about " + Math.round(r.accuracy_m) + " m)");
  if (r.retries > 0) why.push("Location retried " + r.retries + " time(s)");
  if (r.distance_m > rad * 0.9) why.push("Close to the edge of the area");
  return why.length ? { lv: "mid", label: "Check", why } : { lv: "high", label: "Good", why: ["Inside the area with a clear GPS reading"] };
}
function trustBadge(r) {
  const t = trustOf(r), b = document.createElement("button");
  b.type = "button"; b.className = "trust " + t.lv; b.textContent = t.label; b.title = t.why.join("; ");
  b.addEventListener("click", () => toast(r.index_number + ": " + t.why.join("; ")));
  return b;
}

// ---- Loading placeholders ----
function skelRows() {
  const body = $("rows"); body.textContent = "";
  for (let i = 0; i < 4; i++) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 9; const d = document.createElement("div"); d.className = "skel"; td.appendChild(d); tr.appendChild(td); body.appendChild(tr); }
}
function skelList() {
  const box = $("sessions");
  for (let i = 0; i < 3; i++) { const d = document.createElement("div"); d.className = "skel big"; box.appendChild(d); }
}

// ---- Countdown and sound alerts ----
let wasOpen = null, beepFor = "", beeped2 = false, audio = null;
function beep(len) {
  if (!$("snd").checked) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.start(t); o.stop(t + len + 0.05);
  } catch (e) {}
}
setInterval(() => {
  if (!$("proj").hidden) updateProj();
  const el = $("countdown");
  if (!current) { el.hidden = true; return; }
  const open = isOpen();
  if (beepFor !== current.closes_at) { beepFor = current.closes_at; beeped2 = false; }
  if (wasOpen === true && !open) { beep(0.8); toast("Check-in has closed.", { action: "Reopen 10 min", onAction: () => { $("reopenMins").value = "10"; $("reopen").click(); } }); }
  wasOpen = open;
  if (!open) { el.hidden = true; return; }
  const ms = new Date(current.closes_at) - Date.now(), m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
  el.hidden = false; el.textContent = "Closes in " + m + ":" + String(sec).padStart(2, "0"); el.className = "countdown" + (ms <= 120000 ? " soon" : "");
  if (ms <= 120000 && !beeped2) { beeped2 = true; beep(0.35); toast("Check-in closes in 2 minutes.", { action: "+10 min", onAction: () => $("more").click() }); }
}, 1000);


// ---- Phone layout: labels for the card view, and a sticky action bar ----
const ROW_LABELS = ["Name", "Index number", "Programme", "Level", "Time", "Distance", "Confidence", "Notes", ""];
function renderBar() {
  const bar = $("stickybar");
  if (!current || $("live").hidden) { bar.hidden = true; document.body.classList.remove("hasbar"); return; }
  bar.hidden = false; document.body.classList.add("hasbar"); bar.textContent = "";
  const items = isOpen() ? [["Copy link", "copy"], ["QR", "qr"], ["+10 min", "more"], ["Close", "close", "danger"]] : [["Reopen", "reopen"], ["Projector", "projBtn"]];
  for (const [label, id, cls] of items) {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet " + (cls || ""); b.textContent = label;
    b.addEventListener("click", () => $(id).click()); bar.appendChild(b);
  }
}

// ---- Radar view ----
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(n, a) { const e = document.createElementNS(SVGNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; }
function renderRadar() {
  const box = $("radarBox"); if (!current || !box.open) return;
  const svg = $("radar"); svg.textContent = "";
  const R = current.radius_m, lat0 = current.lat, lng0 = current.lng, mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = records.filter((r) => r.lat != null && r.lng != null).map((r) => ({ r, x: (r.lng - lng0) * mx, y: -(r.lat - lat0) * 110540 }));
  const ext = Math.max(R * 1.25, ...pts.map((p) => Math.hypot(p.x, p.y) * 1.08)), k = 100 / ext;
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: R * k, fill: "none", stroke: "#1a7f4b", "stroke-width": 1.2, "stroke-dasharray": "4 3" }));
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: (R * k) / 2, fill: "none", stroke: "#8aa0b4", "stroke-width": 0.6, "stroke-dasharray": "2 3" }));
  const lab = svgEl("text", { x: R * k * 0.7, y: -R * k * 0.72, "font-size": 6, fill: "#5a6878" }); lab.textContent = R + " m"; svg.appendChild(lab);
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 3.5, fill: "#004c84" }));
  const you = svgEl("text", { x: 0, y: -6, "font-size": 6, "text-anchor": "middle", fill: "#5a6878" }); you.textContent = "You"; svg.appendChild(you);
  for (const p of pts) {
    const t = trustOf(p.r), isNew = !seenDots.has(p.r.id); seenDots.add(p.r.id);
    const c = svgEl("circle", { cx: p.x * k, cy: p.y * k, r: 3.2, fill: t.lv === "high" ? "#1a7f4b" : t.lv === "mid" ? "#f2b705" : "#b3261e", stroke: "#fff", "stroke-width": 0.8, class: isNew ? "dot new" : "dot" });
    const tt = svgEl("title", {}); tt.textContent = (p.r.student_name || p.r.index_number) + ", " + Math.round(p.r.distance_m) + " m"; c.appendChild(tt);
    c.addEventListener("click", () => toast((p.r.student_name || p.r.index_number) + " (" + p.r.index_number + "), " + Math.round(p.r.distance_m) + " m from you."));
    svg.appendChild(c);
  }
  if (!pts.length) { const t = svgEl("text", { x: 0, y: 30, "font-size": 7, "text-anchor": "middle", fill: "#5a6878" }); t.textContent = "No locations yet"; svg.appendChild(t); }
}
$("radarBox").addEventListener("toggle", renderRadar);

// ---- Projector mode ----
function drawProj(redraw) {
  if (!current) return;
  const open = isOpen();
  $("projCourse").textContent = current.course;
  $("projTerm").textContent = [current.academic_year, current.semester].filter(Boolean).join(", ") + (current.combined ? "  |  Combined class" : "");
  $("projCode").textContent = current.code;
  const pin = $("projPin"); pin.hidden = !(current.rotating && current._tok);
  if (!pin.hidden) pin.textContent = current._tok.slice(0, 3) + " " + current._tok.slice(3);
  const cv = $("projCanvas"); cv.hidden = !open;
  if (open && redraw !== false) drawQR(cv, studentLink(current.code, current._tok), Math.min(innerHeight * 0.62, innerWidth * 0.38));
  updateProj();
}
function updateProj() {
  if ($("proj").hidden || !current) return;
  const n = records.length, el = $("projN");
  if (n !== projN) { el.textContent = n; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); projN = n; }
  const ins = records.filter((r) => r.in_range).length;
  $("projSub").textContent = ins + " in the class area" + (n - ins ? ", " + (n - ins) + " outside" : "");
  $("projCd").textContent = isOpen() ? $("countdown").textContent : "Check-in has ended";
  const g = $("projGroups"); g.textContent = "";
  if (current.combined) for (const x of current.class_groups || []) {
    const c = document.createElement("span"); c.className = "chip";
    c.textContent = groupLabel(x) + ": " + records.filter((r) => r.programme === x.programme && (x.level === "All levels" || r.level === x.level)).length; g.appendChild(c);
  }
}
$("projBtn").addEventListener("click", () => {
  $("proj").hidden = false; projN = -1; drawProj(true);
  try { if ($("proj").requestFullscreen) $("proj").requestFullscreen(); } catch (e) {}
});
function closeProj() { $("proj").hidden = true; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} }
$("projClose").addEventListener("click", closeProj);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("proj").hidden) closeProj(); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) $("proj").hidden = true; });

// ---- Venues ----
async function loadVenues() {
  const { data } = await sb.from("venues").select("*").order("name");
  let shared = []; try { const r = await sb.from("shared_venues").select("*").order("name"); shared = (r.data || []).map((v) => Object.assign({}, v, { shared: true })); } catch (e) {}
  venues = shared.concat(data || []);
  const sel = $("venue"), keep = sel.value; sel.textContent = "";
  const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); };
  add("", "My current location (stand in the room)");
  for (const v of venues) add(v.id, (v.shared ? "\u2605 " : "") + v.name + (v.shared ? " (KTU)" : ""));
  sel.value = venues.some((v) => v.id === keep) ? keep : ""; syncVenue();
}
function syncVenue() {
  { const sv = venues.find((x) => x.id === $("venue").value); $("venueDel").hidden = !sv || !!sv.shared; }
  const v = venues.find((x) => x.id === $("venue").value); if (v && v.radius_m) $("radius").value = v.radius_m;
}
$("venue").addEventListener("change", syncVenue);
$("venueSave").addEventListener("click", async () => {
  const name = (prompt("Name this place, for example Block B Lab 2:") || "").trim(); if (name.length < 2) return;
  try {
    toast("Getting your location...");
    const pos = await getPosition();
    const { error } = await sb.from("venues").insert({ name, lat: pos.coords.latitude, lng: pos.coords.longitude, radius_m: Number($("radius").value) || null });
    if (error) return toast(error.code === "23505" ? "You already have a venue with that name." : "Could not save: " + error.message);
    toast("Saved " + name + " (GPS accuracy about " + Math.round(pos.coords.accuracy) + " m). Save it from the middle of the room."); await loadVenues();
  } catch (e) { toast(e.message || "Could not get your location."); }
});
$("venueDel").addEventListener("click", async () => {
  const v = venues.find((x) => x.id === $("venue").value); if (!v || !confirm("Delete the venue " + v.name + "?")) return;
  const { error } = await sb.from("venues").delete().eq("id", v.id); toast(error ? "Could not delete: " + error.message : "Venue deleted."); loadVenues();
});

// ---- What the admin allows this account to do (the database enforces it too) ----
const allowed = (k) => !(myPerms[k] === false || myPerms[k] === "false");
function applyPerms() {
  if (role !== "assistant") { $("rollUp").disabled = !allowed("upload_rolls"); $("rollFile").disabled = !allowed("upload_rolls"); }
  $("venueSave").hidden = !allowed("save_venues");
  if (!allowed("start_classes")) $("startBtn").disabled = true; if (!allowed("manual_add")) $("addm").disabled = true;
  const n = []; if (!allowed("upload_rolls")) n.push("upload class rolls"); if (!allowed("delete_rolls")) n.push("delete class rolls"); if (!allowed("save_venues")) n.push("save venues"); if (!allowed("start_classes")) n.push("start classes"); if (!allowed("manual_add")) n.push("add students by hand"); if (!allowed("edit_checkins")) n.push("edit check-ins"); if (myPerms.max_minutes) n.push("start classes longer than " + myPerms.max_minutes + " minutes");
  const box = $("permNote"); if (box) { box.hidden = !n.length; box.textContent = n.length ? "The admin has turned off these for your account: " + n.join(", ") + ". Contact the admin if you need them." : ""; }
}
// ---- Saved setups (kept on this phone or computer) ----
function getPresets() { try { return JSON.parse(localStorage.getItem("ktu_presets_" + myId) || "[]"); } catch (e) { return []; } }
function putPresets(p) { try { localStorage.setItem("ktu_presets_" + myId, JSON.stringify(p.slice(0, 8))); } catch (e) {} drawPresets(); }
function drawPresets() {
  const box = $("presetList"); box.textContent = "";
  for (const p of getPresets()) {
    const b = document.createElement("button"); b.type = "button"; b.className = "abtn"; b.textContent = p.name; b.addEventListener("click", () => fillFrom(p.s));
    const x = document.createElement("button"); x.type = "button"; x.className = "abtn bad"; x.textContent = "\u00d7"; x.title = "Remove " + p.name; x.setAttribute("aria-label", "Remove " + p.name);
    x.addEventListener("click", () => { if (confirm("Remove the saved setup " + p.name + "?")) putPresets(getPresets().filter((q) => q.name !== p.name)); });
    box.append(b, x);
  }
}
$("presetSave").addEventListener("click", () => {
  const pick = $("coursePick").value, course = (pick === "__new" ? $("course").value : pick).trim(); if (!course) return toast("Choose the course first, then save the setup.");
  const comb = document.querySelector('input[name="ctype"]:checked').value === "combined";
  const s = { course, combined: comb, class_groups: comb ? groups.map((g) => ({ programme: g.programme, level: g.level })) : null, programme: $("tprog").value, level: $("tlevel").value, academic_year: $("tyear").value, semester: $("tsem").value, rotating: $("rot").checked, block_shared: $("blk").checked, two_point: $("two").checked, late_after_min: Number($("late").value) || null, radius_m: Number($("radius").value) || null };
  const name = (prompt("Name this setup:", course + (comb ? " (combined)" : s.level ? " " + s.level : "")) || "").trim().slice(0, 40); if (!name) return;
  putPresets(getPresets().filter((q) => q.name !== name).concat({ name, s })); toast("Saved. Tap it any time to fill the form.");
});
drawPresets();
// ---- Repeat a class ----
function fillFrom(s) {
  const pick = $("coursePick");
  if (Array.from(pick.options).some((o) => o.value === s.course)) pick.value = s.course; else { pick.value = "__new"; $("course").value = s.course; }
  pick.dispatchEvent(new Event("change"));
  const comb = !!s.combined;
  document.querySelector('input[name="ctype"][value="' + (comb ? "combined" : "single") + '"]').checked = true;
  if (comb) { groups = (s.class_groups || []).map((g) => ({ programme: g.programme, level: g.level })); drawChips(); }
  else { $("tprog").value = s.programme || ""; $("tlevel").value = s.level || ""; }
  setType();
  if (s.academic_year) $("tyear").value = s.academic_year; if (s.semester) $("tsem").value = s.semester;
  $("rot").checked = !!s.rotating; $("blk").checked = s.block_shared !== false; $("two").checked = !!s.two_point; $("late").value = s.late_after_min || "";
  if (s.radius_m) $("radius").value = s.radius_m;
  showTab("home", true); $("start").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Details loaded. Check them, then press Start check-in here.");
}
$("repeatLast").addEventListener("click", async () => {
  const { data } = await sb.from("sessions").select("*").eq("owner", myId).order("created_at", { ascending: false }).limit(1);
  if (!data || !data.length) return toast("You have no earlier class to repeat.");
  fillFrom(data[0]);
});
$("repeat").addEventListener("click", () => { if (current) fillFrom(current); });
$("delClass").addEventListener("click", async () => {
  if (!current || role === "assistant") return;
  const s = current;
  if (!confirm("Delete this class (" + s.course + ", " + fmtDay(s.created_at) + ") and its " + records.length + " check-in(s)?\n\nIt is kept in the admin Trash for 3 months. Ask the admin if you need it restored.")) return;
  const { data, error } = await sb.from("sessions").delete().eq("id", s.id).select("id");
  if (error) return toast("Could not delete the class: " + error.message);
  if (!data || !data.length) return toast("Nothing was deleted. You can only delete your own classes.");
  stopPolling(); stopQr(); current = null; records = []; rollRows = [];
  $("live").hidden = true; $("stickybar").hidden = true; document.body.classList.remove("hasbar"); updateHello(); updateAlerts();
  toast("Class deleted."); loadSessions();
});


// ---- Printable attendance sheet and archived classes ----
$("pdfSheet").addEventListener("click", () => { if (!current || role === "assistant") return; openAttendanceSheet(Object.assign({}, current), records, rollRows, myName || myEmail); });
$("showArch").addEventListener("change", loadSessions);


// ---- Compact rows, review list and review pop-up ----
function nameCell(r) {
  const c = document.createElement("span"), n = document.createElement("span"), s = document.createElement("small");
  n.textContent = r.student_name || "-"; s.className = "sub";
  s.textContent = r.index_number + "  |  " + Math.round(r.distance_m) + " m  |  " + fmtTime(r.checked_in_at);
  c.append(n, s); return c;
}
$("moreRows").addEventListener("click", () => { rowLimit += 50; renderRows(); });

let warnedCol = false;
async function updateRec(r, patch, okMsg) {
  let { error } = await sb.from("attendance").update(patch).eq("id", r.id);
  if (error && "reviewed" in patch && /reviewed/i.test(error.message)) {
    const p2 = Object.assign({}, patch); delete p2.reviewed;
    ({ error } = await sb.from("attendance").update(p2).eq("id", r.id));
    if (!warnedCol) { warnedCol = true; toast("Run the latest database update (upgrade14) so the review list remembers your choices."); }
  }
  if (error) { toast("Could not save: " + error.message); return false; }
  if (okMsg) toast(okMsg);
  await loadAttendance(); return true;
}
const acceptRec = (r) => updateRec(r, { in_range: true, manual: true, reviewed: true }, r.index_number + " accepted as present.");
const keepOutRec = (r) => updateRec(r, { reviewed: true }, r.index_number + " kept outside.");
async function removeRecord(r) {
  if (!confirm("Remove " + r.index_number + " from this class?")) return;
  const { error } = await sb.from("attendance").delete().eq("id", r.id);
  if (error) return toast("Could not remove: " + error.message);
  const row = {}; for (const k in r) if (!k.startsWith("_")) row[k] = r[k];
  await loadAttendance();
  toast("Removed " + r.index_number + ".", { action: "Undo", ms: 9000, onAction: async () => { const u = await sb.from("attendance").insert(row); toast(u.error ? "Could not undo: " + u.error.message : "Restored " + r.index_number + "."); loadAttendance(); } });
}
const needsReview = (r) => !r.in_range && !r.reviewed;

function rvBtn(text, cls, fn) { const b = document.createElement("button"); b.type = "button"; b.className = "abtn " + cls; b.textContent = text; b.addEventListener("click", fn); return b; }
function renderReview() {
  const box = $("reviewBox"), L = $("reviewList"), list = records.filter(needsReview);
  box.hidden = !list.length; $("reviewN").textContent = list.length; L.textContent = "";
  for (const r of reviewAll ? list : list.slice(0, 8)) {
    const row = document.createElement("div"); row.className = "rvrow";
    const info = document.createElement("div"); info.className = "rvinfo";
    const b = document.createElement("b"); b.textContent = r.student_name || r.index_number;
    const sp = document.createElement("span"); sp.textContent = r.index_number + "  |  " + Math.round(r.distance_m) + " m away (allowed " + current.radius_m + " m)";
    info.append(b, sp);
    const acts = document.createElement("div"); acts.className = "acts";
    acts.append(rvBtn("Accept", "ok", () => acceptRec(r)), rvBtn("Keep outside", "", () => keepOutRec(r)));
    if (role !== "assistant") acts.appendChild(rvBtn("Remove", "bad", () => removeRecord(r)));
    row.append(info, acts); L.appendChild(row);
  }
  if (!reviewAll && list.length > 8) { const m = document.createElement("button"); m.type = "button"; m.className = "btn quiet"; m.style.marginTop = "8px"; m.textContent = "Show all " + list.length; m.addEventListener("click", () => { reviewAll = true; renderReview(); }); L.appendChild(m); }
}

function feedReview() {
  if (!current) return;
  for (const r of records) {
    if (!needsReview(r)) continue;
    if (!knownOut.has(r.id)) { knownOut.add(r.id); if (popReady && isOpen()) popQueue.push(r.id); }
  }
  popReady = true;
  popQueue = popQueue.filter((id) => records.some((r) => r.id === id && needsReview(r)));
  showPop();
}
function showPop() {
  const pop = $("reviewPop");
  if (popId && !records.some((r) => r.id === popId && needsReview(r))) popId = null;
  if (!popId && popQueue.length) { popId = popQueue.shift(); beep(0.25); }
  if (!popId) { pop.hidden = true; return; }
  const r = records.find((x) => x.id === popId);
  $("rvWho").textContent = (r.student_name || r.index_number) + "  (" + r.index_number + ")";
  $("rvInfo").textContent = (r.programme || "") + (r.level ? ", " + r.level : "") + ". About " + Math.round(r.distance_m) + " m from you; the allowed distance is " + current.radius_m + " m." + (r.accuracy_m ? " GPS accuracy about " + Math.round(r.accuracy_m) + " m." : "") + (noteOf(r) ? " " + noteOf(r) + "." : "");
  $("rvMore").textContent = popQueue.length ? popQueue.length + " more waiting." : "";
  $("rvRemove").hidden = role === "assistant";
  pop.hidden = false;
}
function closePop() {
  const waiting = records.filter(needsReview).length;
  popQueue = []; popId = null; $("reviewPop").hidden = true;
  if (waiting) toast(waiting + " student" + (waiting > 1 ? "s are" : " is") + " waiting in Needs review.");
}
$("rvClose").addEventListener("click", closePop); $("rvLater").addEventListener("click", closePop);
$("rvAccept").addEventListener("click", () => { const r = records.find((x) => x.id === popId); if (r) acceptRec(r); });
$("rvKeep").addEventListener("click", () => { const r = records.find((x) => x.id === popId); if (r) keepOutRec(r); });
$("rvRemove").addEventListener("click", () => { const r = records.find((x) => x.id === popId); if (r) removeRecord(r); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("reviewPop").hidden) closePop(); });

refreshAuth();

// ---- Messages: the chat button (chat.js) ----
$("chatOpen").addEventListener("click", () => KtuChat.open());
function startChat() {
  if (role === "admin") return;
  KtuChat.init(sb, { mode: "staff", me: myId, onUnread: (n) => { $("msgN").hidden = !n; $("msgN").textContent = n > 9 ? "9+" : n; } });
}

// ---- Teaching calendar: last 12 weeks, one square per day ----
async function drawCalendar(all) {
  const box = $("calBox"); if (!box) return; box.textContent = "";
  const live = (all || []).filter((s) => !s.archived); if (!live.length) { box.textContent = "Your classes will appear here."; return; }
  const per = new Map(); for (const s of live) { const k = new Date(s.created_at).toLocaleDateString("en-CA"); per.set(k, (per.get(k) || 0) + 1); }
  const t0 = new Date(); t0.setHours(0, 0, 0, 0); const start = new Date(t0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 11 * 7);
  const grid = document.createElement("div"); grid.className = "cal";
  for (let w = 0; w < 12; w++) { const col = document.createElement("div"); col.className = "calcol";
    for (let d = 0; d < 7; d++) { const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); const n = per.get(x.toLocaleDateString("en-CA")) || 0, c = document.createElement("i"); c.className = "cal" + (x > t0 ? " fut" : n >= 3 ? " l3" : n === 2 ? " l2" : n === 1 ? " l1" : ""); c.title = x.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + ": " + n + " class" + (n === 1 ? "" : "es"); col.appendChild(c); }
    grid.appendChild(col); }
  box.appendChild(grid);
  const lg = document.createElement("p"); lg.className = "note"; lg.textContent = "Each column is a week (oldest on the left, Monday at the top). Darker means more classes that day."; box.appendChild(lg);
}

// ---- Features the admin has switched off ----
function applyFeatures(f) {
  window.KTU_FEATURES = f || {}; if (!f || role === "admin") return;
  const off = [];
  if (f.new_classes === false) { $("startBtn").disabled = true; off.push("start new classes"); }
  if (f.manual_add === false) { $("addm").disabled = true; off.push("add students by hand"); }
  if (f.chat === false) { $("chatOpen").disabled = true; off.push("chat with the admin"); }
  if (f.rolls === false) { $("rollUp").disabled = true; $("rollFile").disabled = true; off.push("upload class rolls"); }
  if (f.exports === false) off.push("download Excel files");
  if (f.lookup === false) { const c = $("lkIdx") && $("lkIdx").closest("section,.card"); if (c) c.hidden = true; off.push("student lookup"); }
  const box = $("permNote"); if (box && off.length) { box.hidden = false; box.textContent = "The admin has switched off for everyone: " + off.join(", ") + "." + (box.textContent ? " " + box.textContent : ""); }
}

// ---- Correct a checked-in student's name or index number ----
function editCheckin(r) {
  const back = document.createElement("div");
  back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px";
  const form = document.createElement("form"); form.className = "card"; form.style.cssText = "max-width:420px;width:100%;margin:0"; form.setAttribute("role", "dialog"); form.setAttribute("aria-modal", "true");
  const h = document.createElement("h2"); h.textContent = "Edit student"; form.appendChild(h);
  const add = (label, input) => { const l = document.createElement("label"); l.textContent = label; form.append(l, input); return input; };
  const nm = add("Full name", Object.assign(document.createElement("input"), { value: r.student_name || "", maxLength: 100, required: true, autocomplete: "off" }));
  const ix = add("Index number", Object.assign(document.createElement("input"), { value: r.index_number, maxLength: 30, required: true, autocomplete: "off", autocapitalize: "characters" }));
  const err = document.createElement("p"); err.className = "msg bad"; err.setAttribute("role", "status");
  const row = document.createElement("div"); row.className = "row"; row.style.marginTop = "14px";
  const ok = Object.assign(document.createElement("button"), { type: "submit", className: "btn", textContent: "Save changes" });
  const no = Object.assign(document.createElement("button"), { type: "button", className: "btn quiet", textContent: "Cancel" });
  row.append(ok, no); form.append(row, err); back.appendChild(form); document.body.appendChild(back); nm.focus();
  no.addEventListener("click", () => back.remove());
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") back.remove(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); ok.disabled = true; err.textContent = "";
    const { data, error } = await sb.rpc("edit_checkin", { p_id: r.id, p_index: ix.value, p_name: nm.value });
    ok.disabled = false;
    if (error) return (err.textContent = /function|exist/i.test(error.message) ? "Run upgrade34.sql in Supabase first." : "Could not save: " + error.message);
    if (!data.ok) return (err.textContent = data.error);
    back.remove(); toast("Student details updated."); loadAttendance();
  });
}

// ---- Limits set by the admin ----
let defApplied = false;
function applyDefaults(d) {
  if (!d || role === "admin" || defApplied) return; defApplied = true;
  if (d.minutes > 0) $("mins").value = d.minutes; if (d.radius > 0) $("radius").value = d.radius;
}
function showWelcome(txt) {
  const box = $("announceBox"); if (!box || !txt || box.querySelector(".welcomeu45")) return;
  const d = document.createElement("div"); d.className = "announce welcomeu45"; const s = document.createElement("span"); s.textContent = txt; d.appendChild(s); box.prepend(d);
}
function applyPolicy(p) {
  if (!p || role === "admin") return;
  const note = [];
  if (p.max_minutes > 0) { $("mins").max = p.max_minutes; if (Number($("mins").value) > p.max_minutes) $("mins").value = p.max_minutes; note.push("classes up to " + p.max_minutes + " minutes"); }
  if (p.min_radius > 0) { $("radius").min = p.min_radius; if (Number($("radius").value) < p.min_radius) $("radius").value = p.min_radius; }
  if (p.max_radius > 0) { $("radius").max = p.max_radius; if (Number($("radius").value) > p.max_radius) $("radius").value = p.max_radius; }
  if (p.max_per_day > 0) note.push("at most " + p.max_per_day + " classes a day");
  if (p.max_open > 0) note.push("at most " + p.max_open + " open at once");
  if (p.venues_only) note.push("starting only at approved venues (star)");
  if (p.hour_to > 0) note.push("starting classes from " + p.hour_from + ":00 to " + p.hour_to + ":00");
  if (p.min_radius > 0 || p.max_radius > 0) note.push("distance " + (p.min_radius || 20) + " to " + (p.max_radius || 2000) + " m");
  let n = $("policyNote"); if (!note.length) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement("p"); n.id = "policyNote"; n.className = "note"; $("startBtn").before(n); }
  n.textContent = "Set by the admin: " + note.join(", ") + ".";
}
// ---- Copy a short summary of this class (for WhatsApp or a report) ----
$("sumCopy").addEventListener("click", async () => {
  if (!current) return;
  const inside = records.filter((r) => r.in_range).length, late = records.filter((r) => r.late).length, abs = rollRows.length ? absentees() : null;
  const txt = current.course + " (" + fmtDay(current.created_at) + ")\nChecked in: " + records.length + " (" + inside + " in the class area, " + (records.length - inside) + " outside" + (late ? ", " + late + " late" : "") + ")"
    + (abs ? "\nOn the roll: " + rollRows.length + ". Absent: " + abs.length + (abs.length && abs.length <= 15 ? "\n" + abs.map((r) => "- " + (r.student_name || "-") + " (" + r.index_number + ")").join("\n") : "") : "")
    + "\nLecturer: " + (myName || "");
  toast((await copyText(txt)) ? "Summary copied." : "Could not copy. Try again.");
});

// ---- Attendance grid: one row per student, one column per class (P present, E excused, O outside, A absent) ----
$("repGrid").addEventListener("click", async () => {
  const course = $("rollCourse").value, prog = $("rollProg").value, lvl = $("rollLevel").value;
  if (!course) return say("rollMsg", "Choose the course first.", "warn");
  say("rollMsg", "Building the grid...");
  let [{ data: cls }, roll] = await Promise.all([sessQ(course, true), fetchRolls(course)]);
  if (prog) {
    const eq = (a) => sameText(a, prog), lk = (x) => !lvl || levelKey(x) === levelKey(lvl);
    cls = (cls || []).filter((c) => c.combined ? (c.class_groups || []).some((g) => eq(g.programme) && (!lvl || g.level === "All levels" || lk(g.level))) : eq(c.programme) && lk(c.level));
    roll = roll.filter((r) => eq(r.programme) && lk(r.level));
  } else if (new Set(roll.map((r) => (r.programme || "").trim())).size > 1) {
    return say("rollMsg", "This course has rolls for several programmes. Choose a programme (and level) above first.", "warn");
  }
  if (!cls || !cls.length) return say("rollMsg", "No classes found for that course yet.", "warn");
  cls = cls.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let atts = await fetchAttendance(sb, cls.map((c) => c.id));
  if (prog) atts = atts.filter((a) => sameText(a.programme, prog) && (!lvl || levelKey(a.level) === levelKey(lvl)));
  let exc = []; { const x = await sb.from("excuses").select("session_id,index_number").in("session_id", cls.map((c) => c.id)); if (!x.error) exc = x.data || []; }
  const st = new Map(); for (const r of roll) st.set(String(r.index_number).toUpperCase(), { name: r.student_name || "", cell: new Map() });
  for (const a of atts) { const k = String(a.index_number).toUpperCase(); if (!st.has(k)) st.set(k, { name: a.student_name || "", cell: new Map() }); st.get(k).cell.set(a.session_id, a.in_range ? "P" : "O"); }
  for (const e of exc) { const k = String(e.index_number).toUpperCase(); if (!st.has(k)) st.set(k, { name: "", cell: new Map() }); if (!st.get(k).cell.has(e.session_id)) st.get(k).cell.set(e.session_id, "E"); }
  const head = ["Name", "Index number"].concat(cls.map((c) => fmtDay(c.created_at))).concat(["Present", "Excused", "Classes", "Attendance %"]);
  const rows = Array.from(st, ([k, v]) => {
    const marks = cls.map((c) => v.cell.get(c.id) || "A"), p = marks.filter((m) => m === "P").length, e = marks.filter((m) => m === "E").length, base = cls.length - e;
    return [v.name, k].concat(marks).concat([p, e, cls.length, base > 0 ? Math.round((p * 100) / base) : ""]);
  }).sort((a, b) => String(a[0] || a[1]).localeCompare(String(b[0] || b[1])));
  downloadXlsx(course + " attendance grid", [{ name: "Grid", rows: [head].concat(rows) }, { name: "Key", rows: [["Mark", "Meaning"], ["P", "Present, inside the class area"], ["O", "Checked in outside the class area"], ["E", "Excused"], ["A", "Absent"]] }]);
  say("rollMsg", "Grid downloaded: " + rows.length + " students, " + cls.length + " classes.", "ok");
});

// ---- Account end date notice ----
(async function expiryNote() {
  try {
    await new Promise((r) => setTimeout(r, 2500));
    const { data, error } = await sb.rpc("my_expiry"); if (error || !data) return;
    const days = Math.ceil((new Date(data + "T23:59:59") - new Date()) / 86400000), box = $("permNote"); if (!box) return;
    box.hidden = false; box.textContent = (days < 0 ? "Your access ended on " : "Your access ends on ") + new Date(data).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + (days >= 0 && days <= 60 ? " (" + days + " day" + (days === 1 ? "" : "s") + " left)" : "") + ". " + (box.textContent || "");
  } catch (e) {}
})();

// ---- My timetable: weekly slots that link to a saved setup. Kept on this device. ----
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function getTT() { try { return JSON.parse(localStorage.getItem("ktu_tt_" + myId) || "[]"); } catch (e) { return []; } }
function putTT(v) { try { localStorage.setItem("ktu_tt_" + myId, JSON.stringify(v.slice(0, 40))); } catch (e) {} drawTT(); }
function drawTT() {
  const L = $("ttList"), T = $("ttToday"); if (!L) return; L.textContent = ""; const all = getTT().sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)), today = new Date().getDay();
  const mine = all.filter((x) => x.day === today);
  T.textContent = all.length ? (mine.length ? "Today (" + DAYS[today] + "): " + mine.map((x) => x.time + " " + x.preset).join(", ") : "No slot today. Add your weekly classes so they are one tap away.") : "Add your weekly classes here. Each slot uses one of your saved setups.";
  for (const x of all) {
    const row = document.createElement("div"); row.className = "ttrow" + (x.day === today ? " today" : "");
    const s = document.createElement("span"); s.textContent = DAYS[x.day].slice(0, 3) + " " + x.time + "  " + x.preset + " (" + x.mins + " min)";
    const go = document.createElement("button"); go.type = "button"; go.className = "abtn ok"; go.textContent = "Use";
    go.addEventListener("click", () => { const p = getPresets().find((q) => q.name === x.preset); if (!p) return toast("That saved setup no longer exists."); fillFrom(p.s); $("mins").value = x.mins; toast("Filled in. Check it and press Start."); window.scrollTo({ top: $("startBtn").getBoundingClientRect().top + scrollY - 200, behavior: "smooth" }); });
    const rm = document.createElement("button"); rm.type = "button"; rm.className = "abtn bad"; rm.textContent = "\u00d7"; rm.setAttribute("aria-label", "Remove this slot");
    rm.addEventListener("click", () => putTT(getTT().filter((q) => !(q.day === x.day && q.time === x.time && q.preset === x.preset))));
    row.append(s, go, rm); L.appendChild(row);
  }
}
$("ttAdd").addEventListener("click", () => {
  const ps = getPresets(); if (!ps.length) return toast("First save a setup with the Save this setup button, then add it to your timetable.");
  const back = document.createElement("div"); back.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:70;display:flex;align-items:center;justify-content:center;padding:16px";
  const f = document.createElement("form"); f.className = "card"; f.style.cssText = "max-width:420px;width:100%;margin:0"; f.setAttribute("role", "dialog"); f.setAttribute("aria-modal", "true");
  f.innerHTML = '<h2>Add a timetable slot</h2><label>Saved setup</label><select id="ttP"></select><label>Day</label><select id="ttD"></select><label>Time</label><input id="ttT" type="time" value="08:00" required><label>Minutes the class stays open</label><input id="ttM" type="number" min="5" max="600" value="60"><div class="row" style="margin-top:14px"><button class="btn" type="submit">Add slot</button><button class="btn quiet" type="button" id="ttX">Cancel</button></div>';
  back.appendChild(f); document.body.appendChild(back);
  for (const p of ps) { const o = document.createElement("option"); o.value = o.textContent = p.name; f.querySelector("#ttP").appendChild(o); }
  DAYS.forEach((d, i) => { const o = document.createElement("option"); o.value = i; o.textContent = d; f.querySelector("#ttD").appendChild(o); }); f.querySelector("#ttD").value = new Date().getDay();
  f.querySelector("#ttX").addEventListener("click", () => back.remove());
  f.addEventListener("submit", (e) => { e.preventDefault(); putTT(getTT().concat([{ day: Number(f.querySelector("#ttD").value), time: f.querySelector("#ttT").value, preset: f.querySelector("#ttP").value, mins: Number(f.querySelector("#ttM").value) || 60 }])); back.remove(); });
});
setTimeout(drawTT, 1500);
// ---- Print the list of this class ----
$("printList").addEventListener("click", () => {
  if (!current) return;
  const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to print.");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = records.slice().sort((a, b) => String(a.student_name || "").localeCompare(String(b.student_name || ""))).map((r, i) => "<tr><td>" + (i + 1) + "</td><td>" + esc(r.student_name) + "</td><td>" + esc(r.index_number) + "</td><td>" + esc(fmtTime(r.checked_in_at)) + "</td><td>" + (r.in_range ? "" : "Outside") + "</td><td class=\"sig\"></td></tr>").join("");
  w.document.write("<!doctype html><meta charset=\"utf-8\"><title>" + esc(current.course) + " attendance</title><style>body{font:14px system-ui,Arial;margin:24px}h1{font-size:20px;margin:0}p{margin:4px 0 14px;color:#444}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}.sig{width:140px}</style><h1>" + esc(current.course) + "</h1><p>" + esc(fmtDay(current.created_at)) + (current.programme ? " | " + esc(current.programme) + " " + esc(current.level || "") : "") + " | " + records.length + " present | Lecturer: " + esc(myName || "") + "</p><table><thead><tr><th>#</th><th>Name</th><th>Index number</th><th>Time</th><th>Area</th><th>Signature</th></tr></thead><tbody>" + rows + "</tbody></table><script>window.onload=function(){window.print()}<\/script>");
  w.document.close();
});
