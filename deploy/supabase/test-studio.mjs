// Run from this directory; see README. Creates and deletes only disposable users.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const password = process.env.STUDIO_PASSWORD_FILE
  ? readFileSync(process.env.STUDIO_PASSWORD_FILE, "utf8").trim()
  : process.env.STUDIO_PASSWORD;
assert(password, "Set STUDIO_PASSWORD_FILE or STUDIO_PASSWORD");
assert(process.env.ANON_KEY, "Run node with --env-file=.env");
const studio =
  process.env.STUDIO_URL || `http://127.0.0.1:${process.env.STUDIO_PUBLISH_PORT || 8001}`;
const auth = process.env.SUPABASE_PUBLIC_URL || "http://localhost:8000";
const basic = `Basic ${Buffer.from(`${process.env.STUDIO_USERNAME || "admin"}:${password}`).toString("base64")}`;
const usersPath = "/api/platform/auth/default/users";
const queryPath = "/api/platform/pg-meta/default/query";

async function request(base, path, { method = "GET", body, authorization, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}`);
  return response;
}

async function studioRequest(path, options = {}) {
  return request(studio, path, { authorization: basic, ...options });
}

async function query(sql) {
  const response = await studioRequest(queryPath, { method: "POST", body: { query: sql } });
  return response.json();
}

async function login(email, userPassword) {
  return fetch(`${auth}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.ANON_KEY },
    body: JSON.stringify({ email, password: userPassword }),
    signal: AbortSignal.timeout(10000),
  });
}

const composeFiles = ["-f", "docker-compose.yaml"];
const minimal = JSON.parse(
  execFileSync("docker", ["compose", ...composeFiles, "config", "--format", "json"])
);
assert.deepEqual(Object.keys(minimal.services).sort(), ["auth", "db", "gateway"]);
const optional = JSON.parse(
  execFileSync("docker", [
    "compose",
    ...composeFiles,
    "-f",
    "docker-compose.studio.yaml",
    "config",
    "--format",
    "json",
  ])
);
assert.equal(Object.keys(optional.services).length, 6);
for (const service of ["studio", "meta"]) assert(!optional.services[service].ports);
assert(optional.services["studio-gateway"].ports.every((port) => port.host_ip === "127.0.0.1"));
console.log("PASS: minimal/optional services and port exposure");

for (const [path, method] of [
  ["/", "GET"],
  [usersPath, "POST"],
  [queryPath, "POST"],
]) {
  await request(studio, path, { method, expected: 401 });
  await request(studio, path, {
    method,
    expected: 401,
    authorization: "Basic aW52YWxpZDppbnZhbGlk",
  });
}
await studioRequest("/api/platform/profile");
console.log("PASS: pages and privileged APIs reject missing/incorrect credentials");

const created = [];
try {
  for (let index = 0; index < 2; index++) {
    const email = `studio-smoke-${randomUUID()}@local.test`;
    const userPassword = randomUUID();
    const response = await studioRequest(usersPath, {
      method: "POST",
      body: { email, password: userPassword, email_confirm: true },
    });
    const user = await response.json();
    assert.match(user.id, /^[0-9a-f-]{36}$/i);
    created.push({ id: user.id, email, password: userPassword });
    const signedIn = await login(email, userPassword);
    assert.equal(signedIn.status, 200);
    created[index].token = (await signedIn.json()).access_token;
  }
  const first = created[0];
  const listed = await query(`select id from auth.users where id = '${first.id}'`);
  assert.equal(listed[0].id, first.id);
  // Studio's Users panel only edits ban status; its SQL Editor can update profile metadata.
  await query(
    `update auth.users set raw_user_meta_data = raw_user_meta_data || '{"display_name":"Studio smoke"}'::jsonb where id = '${first.id}'`
  );
  const updated = await query(
    `select raw_user_meta_data->>'display_name' as name from auth.users where id = '${first.id}'`
  );
  assert.equal(updated[0].name, "Studio smoke");
  console.log("PASS: create, list, profile metadata update, and Auth sign-in");

  if (process.env.HINDSIGHT_URL) {
    const bank = `studio-smoke-${randomUUID()}`;
    await request(process.env.HINDSIGHT_URL, `/v1/default/banks/${bank}`, {
      method: "PUT",
      body: { name: "Studio smoke" },
      authorization: `Bearer ${first.token}`,
    });
    const own = await request(process.env.HINDSIGHT_URL, `/v1/default/banks?q=${bank}`, {
      authorization: `Bearer ${first.token}`,
    });
    assert((await own.json()).banks.some((item) => item.bank_id === bank));
    const other = await request(process.env.HINDSIGHT_URL, `/v1/default/banks?q=${bank}`, {
      authorization: `Bearer ${created[1].token}`,
    });
    assert(!(await other.json()).banks.some((item) => item.bank_id === bank));
    await request(process.env.HINDSIGHT_URL, `/v1/default/banks/${bank}`, {
      method: "DELETE",
      authorization: `Bearer ${first.token}`,
    });
    console.log("PASS: Hindsight authenticated bank creation and two-user isolation");
  } else {
    console.log("SKIP: Hindsight isolation (set HINDSIGHT_URL to the running API)");
  }

  await studioRequest(`${usersPath}/${first.id}`, {
    method: "PATCH",
    body: { ban_duration: "24h" },
  });
  assert.equal((await login(first.email, first.password)).status, 400);
  const tokenStatus = async () => {
    const response = await fetch(`${auth}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${first.token}`, apikey: process.env.ANON_KEY },
      signal: AbortSignal.timeout(10000),
    });
    return response.status;
  };
  console.log(
    `OBSERVED: already-issued token at GoTrue /user after ban: HTTP ${await tokenStatus()}`
  );
  await studioRequest(`${usersPath}/${first.id}`, {
    method: "PATCH",
    body: { ban_duration: "none" },
  });
  assert.equal((await login(first.email, first.password)).status, 200);
  await studioRequest(`${usersPath}/${first.id}`, { method: "DELETE" });
  first.deleted = true;
  assert.equal((await login(first.email, first.password)).status, 400);
  assert.equal((await query(`select id from auth.users where id = '${first.id}'`)).length, 0);
  console.log(
    `OBSERVED: already-issued token at GoTrue /user after deletion: HTTP ${await tokenStatus()}`
  );
  if (process.env.HINDSIGHT_URL) {
    const schema = `user_${first.id.replaceAll("-", "_")}`;
    const retained = await query(
      `select schema_name from information_schema.schemata where schema_name = '${schema}'`
    );
    assert.equal(retained[0].schema_name, schema);
    console.log("PASS: deleting an Auth account preserves its Hindsight schema");
  }
  console.log("PASS: ban/unban and account deletion");
} finally {
  for (const user of created.filter((item) => !item.deleted)) {
    await studioRequest(`${usersPath}/${user.id}`, { method: "DELETE" });
  }
}
