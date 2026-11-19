// Supabase Edge Function: notify-report
// Emails every admin when someone files a problem report. Called by the database (see upgrade34.sql).
// Deploy with "Verify JWT" turned OFF. The caller must send the header x-notify-secret.
// Secrets to set (Edge Functions > Secrets):
//   BREVO_API_KEY  - an API key (v3) from Brevo: SMTP & API > API Keys
//   MAIL_FROM      - a sender address you verified in Brevo (for example the one used for Auth emails)
//   NOTIFY_SECRET  - any long random text; the same text is saved in the admin page (Tools > Email alerts)
import { createClient } from "npm:@supabase/supabase-js@2";

const reply = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return reply({ error: "Not allowed." });
  const key = Deno.env.get("BREVO_API_KEY"), from = Deno.env.get("MAIL_FROM");
  if (!key || !from) return reply({ error: "BREVO_API_KEY or MAIL_FROM is not set." });
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admins } = await admin.from("profiles").select("email").eq("role", "admin").is("deleted_at", null);
  const to = (admins ?? []).map((a: any) => ({ email: a.email })).filter((a: any) => a.email);
  if (!to.length) return reply({ error: "No admin email found." });
  const test = b.kind === "test";
  const subject = test ? "KTU check-in: test email" : "KTU check-in: new problem report";
  const html = test
    ? "<p>This is a test. Email alerts for problem reports are working.</p>"
    : `<h3>New problem report</h3><p style="white-space:pre-wrap">${esc(b.message)}</p><p><b>Page:</b> ${esc(b.page)}<br><b>Contact:</b> ${esc(b.contact || "none given")}<br><b>Time:</b> ${esc(b.at)}</p><details><summary>Technical details</summary><pre style="white-space:pre-wrap">${esc(b.details)}</pre></details><p>Open the admin page, Reports tab, to mark it resolved.</p>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "KTU check-in", email: from }, to, subject, htmlContent: html }),
  });
  if (!r.ok) return reply({ error: "Brevo refused the email: " + (await r.text()).slice(0, 300) });
  return reply({ ok: true, sent: to.length });
});
