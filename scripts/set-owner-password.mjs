// One-off admin utility to set a user's password directly via the Supabase
// Admin API (service role). Use this to regain owner access when the in-app
// password-reset flow is unavailable.
//
// SECURITY:
// - Requires the PRODUCTION service-role key. Get it from:
//     Supabase Dashboard -> Project qwvlzcqmicedxhfafiar -> Project Settings ->
//     API -> "service_role" secret.
// - Never commit the key. Pass it via the environment for a single run, then
//   clear your shell history.
//
// USAGE (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<prod service_role key>"
//   node scripts/set-owner-password.mjs vtecoding@gmail.com "YourNewStrongPassword!"
//   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
//
// USAGE (bash):
//   SUPABASE_SERVICE_ROLE_KEY="<key>" node scripts/set-owner-password.mjs vtecoding@gmail.com "YourNewStrongPassword!"

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://qwvlzcqmicedxhfafiar.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const newPassword = process.argv[3];

function fail(message) {
  console.error(`\n[set-owner-password] ${message}\n`);
  process.exit(1);
}

if (!serviceKey) fail("Missing SUPABASE_SERVICE_ROLE_KEY in the environment.");
if (!email) fail("Usage: node scripts/set-owner-password.mjs <email> <newPassword>");
if (!newPassword || newPassword.length < 10) fail("Provide a new password of at least 10 characters as the 2nd argument.");

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`[set-owner-password] Target project: ${SUPABASE_URL}`);
console.log(`[set-owner-password] Looking up ${email} ...`);

// Find the user by email (paginate through the admin user list).
let user = null;
for (let page = 1; page <= 20 && !user; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`Could not list users: ${error.message}`);
  user = (data.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
  if ((data.users ?? []).length < 200) break;
}

if (!user) fail(`No user found with email ${email} in ${SUPABASE_URL}.`);

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
if (updateError) fail(`Failed to update password: ${updateError.message}`);

console.log(`[set-owner-password] OK. Password updated for ${email} (role in profiles unchanged).`);
console.log(`[set-owner-password] Now sign in at https://plaicetomeat-ops.vercel.app/login`);
