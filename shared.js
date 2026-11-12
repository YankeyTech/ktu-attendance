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
  const ci = [["Date", "Course", "Programme", "Level", "Lecturer", "Name", "Index number", "Time", "Distance (m)", "In class area", "Shared phone", "Manual", "Late", "End check", "GPS warning"]];
  for (const a of sorted) {
    const c = byId[a.session_id];
    ci.push([d(c.created_at), c.course, a.programme || c.programme || "", a.level || (c.combined ? "" : c.level) || "", c._owner || "", a.student_name || "", a.index_number, t(a.checked_in_at), Math.round(a.distance_m || 0), a.in_range ? "Yes" : "No", shared(a) ? "Yes" : "No", a.manual ? "Yes" : "No", a.late ? "Yes" : "No", a.end_at ? t(a.end_at) : "", a.gps_flag || ""]);
  }
  const cl = [["Date", "Course", "Programme", "Level", "Lecturer", "Checked in", "In class area", "Outside", "Code"]];
  for (const c of classes) {
    const r = atts.filter((a) => a.session_id === c.id), n = r.filter((a) => a.in_range).length;
    cl.push([d(c.created_at), c.course, progLabel(c), c.combined ? "Various" : c.level || "", c._owner || "", r.length, n, r.length - n, c.code]);
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
