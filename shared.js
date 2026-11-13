// Shared helpers: Excel export, QR code, count-up and confetti.
const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const safeName = (s) => (String(s || "").replace(/[^\w\- ]+/g, "").trim() || "attendance");

async function fetchAttendance(sb, ids) {
  let out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const { data } = await sb.from("attendance").select("*").in("session_id", ids.slice(i, i + 40));
    out = out.concat(data || []);
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
  const sorted = [...atts].sort((a, b) => (byId[a.session_id].created_at < byId[b.session_id].created_at ? 1 : -1) || (a.checked_in_at > b.checked_in_at ? 1 : -1));
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
    ws["!cols"] = s.rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(10, ...s.rows.map((r) => String(r[i] ?? "").length + 2))) }));
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
  const apply = () => { document.documentElement.classList.toggle("big", get("big")); document.documentElement.classList.toggle("hc", get("hc")); };
  apply();
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "a11y"; btn.textContent = "Aa";
  btn.setAttribute("aria-label", "Display options"); btn.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div"); menu.className = "a11ymenu"; menu.hidden = true;
  for (const [label, key] of [["Larger text", "big"], ["High contrast", "hc"]]) {
    const l = document.createElement("label"); const c = document.createElement("input"); c.type = "checkbox"; c.checked = get(key);
    c.addEventListener("change", () => { set(key, c.checked); apply(); }); l.append(c, " " + label); menu.appendChild(l);
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
  document.body.append(btn, menu);
}
addDisplayOptions();
