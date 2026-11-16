// Supabase Edge Function: staff-access
// Invites lecturers / teaching assistants by email, sends reset links, disables accounts,
// and powers "Forgot password?" on the login pages.
// The emails themselves are sent by Supabase Auth through the SMTP provider (Brevo) set in the dashboard.
// Deploy with "Verify JWT" turned OFF: the function checks the admin's sign-in itself, and "forgot" is public.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = Deno.env.get("SITE_URL") ?? "https://yankeytech.github.io/ktu-attendance";
const REDIRECT = SITE + "/set-password.html";
const cors = {
  "Access-Control-Allow-Origin": new URL(SITE).origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Always answer HTTP 200 so the page can read the message.
const reply = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

// Allow at most 2 emails per address per 10 minutes. Counted in checkin_attempts, which the app already clears out.
async function tooMany(key: string, max: number): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await admin.from("checkin_attempts").select("key", { count: "exact", head: true }).eq("key", key).gt("at", since);
  return (count ?? 0) >= max;
}
const note = (key: string) => admin.from("checkin_attempts").insert({ key });

async function sendReset(email: string) {
  return await admin.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  let b: any;
  try { b = await req.json(); } catch { return reply({ error: "Bad request." }); }
  const action = String(b.action || "");

  // ---- Public: forgot password. Mail is sent only if the email belongs to an active account. ----
  if (action === "forgot") {
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return reply({ error: "Enter a valid email address." });
    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    if (await tooMany("fi:" + ip, 15)) return reply({ ok: true });
    await note("fi:" + ip);
    const like = email.replace(/[\\%_]/g, (c) => "\\" + c);
    const { data: p } = await admin.from("profiles").select("id,active").ilike("email", like).maybeSingle();
    if (p && p.active !== false && !(await tooMany("fe:" + email, 2))) {
      await note("fe:" + email);
      await sendReset(email);
    }
    return reply({ ok: true }); // same answer whether or not the email exists
  }

  // ---- Everything below is admin only ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!u?.user) return reply({ error: "Please sign in again." });
  const { data: me } = await admin.from("profiles").select("role,active").eq("id", u.user.id).single();
  if (!me || me.role !== "admin" || me.active === false) return reply({ error: "Admin only." });

  if (action === "invite") {
    const email = String(b.email || "").trim().toLowerCase();
    const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 100);
    const role = b.role === "assistant" ? "assistant" : "lecturer";
    if (!EMAIL.test(email)) return reply({ error: "Enter a valid email address." });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: REDIRECT, data: name ? { full_name: name } : {} });
    if (error) {
      const m = error.message || "";
      if (/already|registered|exists/i.test(m)) return reply({ error: "That email already has an account. Use Send reset link on its row instead." });
      if (/rate limit/i.test(m)) return reply({ error: "Email limit reached for now. Wait a few minutes and try again." });
      return reply({ error: "Could not send the invite: " + m });
    }
    const row: Record<string, unknown> = { id: data.user.id, email, role, active: true, must_change: false };
    if (name.length >= 3) row.full_name = name;
    const up = await admin.from("profiles").upsert(row, { onConflict: "id" });
    if (up.error) return reply({ error: "Invite sent, but the account could not be saved: " + up.error.message });
    return reply({ ok: true, email });
  }

  if (action === "reset") {
    const { data: p } = await admin.from("profiles").select("email,role,active").eq("id", String(b.id || "")).maybeSingle();
    if (!p || !p.email) return reply({ error: "Account not found." });
    if (p.role === "admin") return reply({ error: "Use Forgot password on the sign-in page for the admin account." });
    if (p.active === false) return reply({ error: "This account is disabled. Enable it first." });
    const email = String(p.email).toLowerCase();
    if (await tooMany("fe:" + email, 2)) return reply({ error: "A link was just sent to that address. Wait a few minutes before sending another." });
    await note("fe:" + email);
    const { error } = await sendReset(email);
    if (error) return reply({ error: /rate limit/i.test(error.message) ? "Email limit reached for now. Wait a few minutes and try again." : "Could not send the link: " + error.message });
    return reply({ ok: true, email });
  }

  if (action === "active") {
    const id = String(b.id || ""), on = !!b.active;
    const { data: p } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
    if (!p) return reply({ error: "Account not found." });
    if (p.role === "admin") return reply({ error: "The admin account cannot be disabled." });
    const r1 = await admin.from("profiles").update({ active: on }).eq("id", id);
    if (r1.error) return reply({ error: r1.error.message });
    await admin.auth.admin.updateUserById(id, { ban_duration: on ? "none" : "876000h" });
    return reply({ ok: true });
  }

  return reply({ error: "Unknown action." });
});
