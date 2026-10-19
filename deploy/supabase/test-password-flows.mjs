// Integration test against a LOCAL SMTP capture server, never a real recipient.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const mailbox = process.env.MAILPIT_URL;
assert(mailbox, "Set MAILPIT_URL to the local SMTP test mailbox");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(mailbox).hostname));
assert(process.env.ANON_KEY && process.env.SERVICE_ROLE_KEY, "Run node with --env-file=.env");
const authUrl = process.env.SUPABASE_PUBLIC_URL || "http://localhost:8000";
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(authUrl).hostname));
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient(authUrl, process.env.SERVICE_ROLE_KEY, clientOptions);
const userClient = () => createClient(authUrl, process.env.ANON_KEY, clientOptions);
const email = `password-flow-${randomUUID()}@local.test`;
const firstPassword = randomUUID();
const secondPassword = randomUUID();
const recoveredPassword = randomUUID();
const messages = new Set();
let userId;

async function emailLink(type) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const listing = await fetch(`${mailbox}/api/v1/messages`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(listing.status, 200);
    for (const message of (await listing.json()).messages) {
      if (messages.has(message.ID) || !message.To.some((recipient) => recipient.Address === email))
        continue;
      const detail = await fetch(`${mailbox}/api/v1/message/${message.ID}`, {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(detail.status, 200);
      const html = (await detail.json()).HTML;
      const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
      assert(href, "Email must contain a link");
      const link = new URL(href);
      assert.equal(link.origin, new URL(process.env.SITE_URL).origin);
      assert.equal(
        link.pathname,
        `${new URL(process.env.SITE_URL).pathname.replace(/\/$/, "")}/auth/set-password`
      );
      assert.equal(link.searchParams.get("type"), type);
      assert(link.searchParams.get("token_hash"));
      messages.add(message.ID);
      // Merely opening the page must not consume an invitation/recovery grant.
      const page = await fetch(link, { signal: AbortSignal.timeout(30000) });
      assert.equal(page.status, 200);
      return link.searchParams.get("token_hash");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("No email received by the local mailbox; check GoTrue's SMTP configuration");
}

try {
  const invitation = await admin.auth.admin.inviteUserByEmail(email);
  assert.ifError(invitation.error);
  userId = invitation.data.user.id;
  const inviteToken = await emailLink("invite");
  const invited = userClient();
  const accepted = await invited.auth.verifyOtp({ token_hash: inviteToken, type: "invite" });
  assert.ifError(accepted.error);
  assert.equal(accepted.data.user.id, userId);
  const firstUpdate = await invited.auth.updateUser({ password: firstPassword });
  assert.ifError(firstUpdate.error);
  const replay = await userClient().auth.verifyOtp({ token_hash: inviteToken, type: "invite" });
  assert(replay.error, "An invitation must be single-use");
  console.log(
    "PASS: SMTP invitation links to Hindsight; first-password setup succeeds; replay is rejected"
  );

  const signedIn = userClient();
  const login = await signedIn.auth.signInWithPassword({ email, password: firstPassword });
  assert.ifError(login.error);
  const missing = await signedIn.auth.updateUser({ password: secondPassword });
  assert(missing.error, "The server must require the current password outside recovery");
  const wrong = await signedIn.auth.updateUser({
    password: secondPassword,
    current_password: "wrong-password",
  });
  assert(wrong.error, "The server must reject an incorrect current password");
  const changed = await signedIn.auth.updateUser({
    password: secondPassword,
    current_password: firstPassword,
  });
  assert.ifError(changed.error);
  assert((await userClient().auth.signInWithPassword({ email, password: firstPassword })).error);
  const newLogin = await userClient().auth.signInWithPassword({ email, password: secondPassword });
  assert.ifError(newLogin.error);
  console.log(
    "PASS: missing/wrong current password rejected; new password works and old password fails"
  );

  const recovery = await userClient().auth.resetPasswordForEmail(email);
  assert.ifError(recovery.error);
  const recoveryToken = await emailLink("recovery");
  const recovered = userClient();
  const verified = await recovered.auth.verifyOtp({ token_hash: recoveryToken, type: "recovery" });
  assert.ifError(verified.error);
  const reset = await recovered.auth.updateUser({ password: recoveredPassword });
  assert.ifError(reset.error);
  assert((await userClient().auth.signInWithPassword({ email, password: secondPassword })).error);
  const recoveredLogin = await userClient().auth.signInWithPassword({
    email,
    password: recoveredPassword,
  });
  assert.ifError(recoveredLogin.error);
  console.log(
    "PASS: recovery email links to Hindsight; recovery can set a password without the old password"
  );
} finally {
  if (userId) {
    const deletion = await admin.auth.admin.deleteUser(userId);
    assert.ifError(deletion.error);
  }
}
