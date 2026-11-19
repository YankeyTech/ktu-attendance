// chat.js: a floating messenger between a lecturer / teaching assistant and the admin.
// Staff mode: one conversation with the admin. Admin mode: a list of conversations and the chat beside it.
// Only the latest messages are loaded; older ones come with "Earlier messages", so a long chat never takes over the page.
const KtuChat = (() => {
  let sb, mode, me, nameOf, onChange, onUnread, root, fab, badge, panel, listEl, msgsEl, inputEl, sendBtn, headEl, titleEl, backBtn, moreBtn, threadsEl, searchEl;
  let open = false, owner = null, rows = [], hasMore = false, threads = [], poll = null, lastSig = "";
  const PAGE = 30;
  const h = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const svg = (d, w) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", w || 22); s.setAttribute("height", w || 22); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "2"); p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round"); s.appendChild(p); return s; };
  const SEND = "M22 2L11 13M22 2l-7 20-4-9-9-4z", CHAT = "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z", BACK = "M15 18l-6-6 6-6", CLOSE = "M18 6L6 18M6 6l12 12";
  const hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0); const dd = new Date(d); dd.setHours(0, 0, 0, 0); const diff = Math.round((t - dd) / 86400000);
    return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
  }
  function build() {
    root = h("div", "kchat" + (mode === "admin" ? " admin" : "")); fab = h("button", "kfab"); fab.type = "button"; fab.setAttribute("aria-label", "Open messages"); fab.setAttribute("aria-expanded", "false"); fab.appendChild(svg(CHAT, 26));
    badge = h("span", "kbadge"); badge.hidden = true; fab.appendChild(badge);
    panel = h("div", "kpanel"); panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", mode === "admin" ? "Messages from lecturers" : "Chat with the admin");
    if (mode === "admin") {
      threadsEl = h("div", "kthreads"); const hd = h("div", "khead"); hd.append(h("b", "", "Messages")); const x1 = h("button", "kx"); x1.type = "button"; x1.setAttribute("aria-label", "Close messages"); x1.appendChild(svg(CLOSE, 20)); x1.addEventListener("click", close); hd.appendChild(x1);
      searchEl = h("input", "ksearch"); searchEl.placeholder = "Search lecturers"; searchEl.setAttribute("aria-label", "Search lecturers"); searchEl.addEventListener("input", drawThreads);
      listEl = h("div", "klist"); threadsEl.append(hd, searchEl, listEl); panel.appendChild(threadsEl);
    }
    const chat = h("div", "kmain"); headEl = h("div", "khead");
    backBtn = h("button", "kx kback"); backBtn.type = "button"; backBtn.setAttribute("aria-label", "Back to conversations"); backBtn.appendChild(svg(BACK, 20)); backBtn.addEventListener("click", () => { owner = null; showPane(); });
    const av = h("span", "kav", mode === "admin" ? "?" : "A"); titleEl = h("div", "ktitle"); titleEl.append(h("b", "", mode === "admin" ? "Choose a conversation" : "Admin"), h("small", "", mode === "admin" ? "" : "Ask for a restore, report a decision, or ask for help"));
    const x2 = h("button", "kx"); x2.type = "button"; x2.setAttribute("aria-label", "Close chat"); x2.appendChild(svg(CLOSE, 20)); x2.addEventListener("click", close);
    headEl.append(backBtn, av, titleEl, x2);
    msgsEl = h("div", "kmsgs"); msgsEl.setAttribute("role", "log"); msgsEl.setAttribute("aria-live", "polite"); msgsEl.setAttribute("aria-label", "Messages");
    const comp = h("div", "kcomp"); inputEl = h("textarea"); inputEl.rows = 1; inputEl.maxLength = 1000; inputEl.placeholder = "Type a message"; inputEl.setAttribute("aria-label", "Type a message");
    sendBtn = h("button", "ksend"); sendBtn.type = "button"; sendBtn.setAttribute("aria-label", "Send message"); sendBtn.appendChild(svg(SEND, 20));
    comp.append(inputEl, sendBtn); chat.append(headEl, msgsEl, comp); panel.appendChild(chat);
    root.append(panel, fab); document.body.appendChild(root);
    fab.addEventListener("click", () => (open ? close() : openPanel()));
    sendBtn.addEventListener("click", send);
    inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    inputEl.addEventListener("input", () => { inputEl.style.height = "auto"; inputEl.style.height = Math.min(110, inputEl.scrollHeight) + "px"; });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); fab.focus(); } });
  }
  function showPane() { panel.classList.toggle("onchat", !!owner || mode !== "admin"); if (mode === "admin") { titleEl.firstChild.textContent = owner ? nameOf(owner) : "Choose a conversation"; msgsEl.classList.toggle("empty", !owner); } }
  async function openPanel(ownerId) {
    open = true; panel.hidden = false; fab.setAttribute("aria-expanded", "true"); fab.classList.add("on");
    if (mode === "admin") { await loadThreads(); if (ownerId) await openThread(ownerId); else { owner = null; showPane(); msgsEl.textContent = ""; msgsEl.appendChild(h("p", "knone", "Pick a lecturer on the left to read and reply.")); } }
    else { owner = me; rows = []; lastSig = ""; showPane(); await loadMsgs(true); }
    startPoll(); setTimeout(() => (owner || mode !== "admin" ? inputEl : searchEl).focus(), 50);
  }
  function close() { open = false; panel.hidden = true; fab.setAttribute("aria-expanded", "false"); fab.classList.remove("on"); startPoll(); }
  async function loadThreads() {
    const { data, error } = await sb.from("staff_messages").select("thread_owner,sender,body,created_at,read_by_admin").order("created_at", { ascending: false }).limit(600);
    if (error) { threads = []; return; }
    const by = new Map();
    for (const m of data || []) { let t = by.get(m.thread_owner); if (!t) { t = { owner: m.thread_owner, last: m, unread: 0 }; by.set(m.thread_owner, t); } if (m.sender === "staff" && !m.read_by_admin) t.unread++; }
    threads = Array.from(by.values()); setUnread(threads.reduce((n, t) => n + t.unread, 0)); if (open) drawThreads();
  }
  function drawThreads() {
    if (!listEl) return; listEl.textContent = ""; const q = (searchEl.value || "").trim().toLowerCase();
    const list = threads.filter((t) => !q || nameOf(t.owner).toLowerCase().includes(q));
    if (!list.length) listEl.appendChild(h("p", "knone", threads.length ? "No match." : "No messages from lecturers yet."));
    for (const t of list) {
      const b = h("button", "kthread" + (t.owner === owner ? " cur" : "") + (t.unread ? " unread" : "")); b.type = "button";
      const nm = nameOf(t.owner); b.appendChild(h("span", "kav", (nm.trim()[0] || "?").toUpperCase()));
      const mid = h("span", "kmid"); mid.append(h("b", "", nm), h("small", "", (t.last.sender === "admin" ? "You: " : "") + t.last.body.slice(0, 60))); b.appendChild(mid);
      const rt = h("span", "kmeta"); rt.appendChild(h("small", "", dayLabel(t.last.created_at) === "Today" ? hm(t.last.created_at) : dayLabel(t.last.created_at).slice(0, 10))); if (t.unread) rt.appendChild(h("i", "kdot", String(t.unread))); b.appendChild(rt);
      b.addEventListener("click", () => openThread(t.owner)); listEl.appendChild(b);
    }
  }
  async function openThread(o) { owner = o; rows = []; lastSig = ""; hasMore = false; showPane(); drawThreads(); await loadMsgs(true); inputEl.focus(); }
  async function loadMsgs(scroll, older) {
    if (!owner) return;
    let q = sb.from("staff_messages").select("*").eq("thread_owner", owner).order("created_at", { ascending: false }).limit(PAGE + 1);
    if (older && rows.length) q = q.lt("created_at", rows[0].created_at);
    const { data, error } = await q; if (error) { msgsEl.textContent = ""; msgsEl.appendChild(h("p", "knone", /relation|exist/i.test(error.message) ? "Messages are not set up yet. Run upgrade29.sql in Supabase." : error.message)); return; }
    let got = (data || []).slice(0, PAGE).reverse(); const more = (data || []).length > PAGE;
    if (older) { rows = got.concat(rows); hasMore = more; } else { const keep = rows.filter((r) => got.every((g) => g.id !== r.id) && new Date(r.created_at) < (got[0] ? new Date(got[0].created_at) : 0)); rows = keep.concat(got); if (!keep.length) hasMore = more; }
    const sig = rows.map((r) => r.id + r.read_by_admin + r.read_by_staff).join(",") + hasMore;
    if (older || sig !== lastSig) { lastSig = sig; draw(scroll, older); }
    markRead();
  }
  function draw(scroll, older) {
    const prevH = msgsEl.scrollHeight, atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80; msgsEl.textContent = "";
    if (hasMore) { moreBtn = h("button", "kmore", "Earlier messages"); moreBtn.type = "button"; moreBtn.addEventListener("click", () => loadMsgs(false, true)); msgsEl.appendChild(moreBtn); }
    if (!rows.length) msgsEl.appendChild(h("p", "knone", mode === "admin" ? "No messages yet." : "No messages yet. Write to the admin below, for example to ask for a deleted class or roll to be restored."));
    let day = "";
    for (const m of rows) {
      const dl = dayLabel(m.created_at); if (dl !== day) { day = dl; msgsEl.appendChild(h("div", "kday", dl)); }
      const mineMsg = mode === "admin" ? m.sender === "admin" : m.sender === "staff", b = h("div", "kmsg " + (mineMsg ? "me" : "them"));
      b.appendChild(h("span", "kbody", m.body)); const meta = h("span", "kt"); meta.textContent = hm(m.created_at);
      if (mineMsg) { const read = mode === "admin" ? m.read_by_staff : m.read_by_admin; const tk = h("span", "ktick" + (read ? " read" : ""), read ? "✓✓" : "✓"); tk.setAttribute("aria-label", read ? "Read" : "Sent"); meta.appendChild(tk); }
      b.appendChild(meta); msgsEl.appendChild(b);
    }
    if (older) msgsEl.scrollTop = msgsEl.scrollHeight - prevH; else if (scroll || atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  async function markRead() {
    if (!open) return;
    if (mode === "admin") { if (rows.some((m) => m.sender === "staff" && !m.read_by_admin)) { await sb.from("staff_messages").update({ read_by_admin: true }).eq("thread_owner", owner).eq("sender", "staff"); await loadThreads(); onChange && onChange(); } }
    else if (rows.some((m) => m.sender === "admin" && !m.read_by_staff)) { await sb.rpc("staff_mark_read"); setUnread(0); }
  }
  async function send() {
    const body = inputEl.value.trim(); if (body.length < 2 || !owner) return; sendBtn.disabled = true;
    const rec = mode === "admin" ? { thread_owner: owner, sender: "admin", body, read_by_admin: true } : { thread_owner: me, sender: "staff", body, read_by_staff: true };
    const { error } = await sb.from("staff_messages").insert(rec); sendBtn.disabled = false;
    if (error) { const e = h("p", "kerr", "Could not send: " + error.message); msgsEl.appendChild(e); setTimeout(() => e.remove(), 5000); return; }
    inputEl.value = ""; inputEl.style.height = "auto"; await loadMsgs(true); if (mode === "admin") { await loadThreads(); onChange && onChange(); }
  }
  function setUnread(n) { badge.hidden = !n; badge.textContent = n > 9 ? "9+" : n; fab.setAttribute("aria-label", n ? "Open messages, " + n + " unread" : "Open messages"); onUnread && onUnread(n); }
  async function refreshUnread() {
    if (mode === "admin") return loadThreads();
    const { data } = await sb.from("staff_messages").select("id").eq("thread_owner", me).eq("sender", "admin").eq("read_by_staff", false).limit(50); setUnread((data || []).length);
  }
  function startPoll() { clearInterval(poll); poll = setInterval(async () => { if (document.hidden) return; if (open) { if (mode === "admin") await loadThreads(); if (owner) await loadMsgs(false); } else refreshUnread(); }, open ? 8000 : 45000); }
  return {
    init(client, o) { sb = client; mode = o.mode; me = o.me; nameOf = o.nameOf || ((x) => String(x)); onChange = o.onChange; onUnread = o.onUnread; if (!root) build(); refreshUnread(); startPoll(); },
    open: (ownerId) => openPanel(ownerId), close, unread: () => (badge && !badge.hidden ? Number(badge.textContent) || 0 : 0),
  };
})();
