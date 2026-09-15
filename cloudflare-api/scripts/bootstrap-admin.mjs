#!/usr/bin/env node
/**
 * The first administrator on a database that has none.
 *
 * Production is a locked box by design and, until this existed, by accident: an
 * account can only be created from an invitation, an invitation can only be
 * created by an administrator, and `ensureSeeded` refuses to run in production
 * so that a copied staging deploy command cannot mint one. Correct, and it left
 * no way in.
 *
 * This is the way in, and it is deliberately not the pattern that was removed.
 * `ensureSeeded` ran on every sign-in attempt from environment variables that
 * might be set by accident; this runs once, by hand, from a password typed at
 * the prompt, and refuses outright if the database already has an
 * administrator. There is nothing here a mis-set variable can trigger.
 *
 *   node scripts/bootstrap-admin.mjs --env production --email you@example.com
 *
 * The password is read from the terminal without echoing and is never written
 * to a file, an argument, an environment variable or the shell history. The
 * hash is computed here in exactly the form `src/security.ts` writes, so the
 * account signs in through the ordinary login route like any other.
 *
 * Sign in immediately afterwards and change the password from inside the app.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { webcrypto as crypto } from "node:crypto";

const PBKDF2_ROUNDS_PER_CALL = 100_000;
const PASSWORD_STAGES = 6;
const STAGED_SCHEME = "pbkdf2_sha256_staged";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const environment = flag("env", "staging");
const email = (flag("email") ?? "").trim().toLowerCase();
const name = flag("name", "AIMZ Administrator");
const database = environment === "production" ? "aimz-production-db" : "aimz-staging-db";

if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/bootstrap-admin.mjs --env production --email you@example.com [--name \"Full Name\"]");
  process.exit(1);
}

const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** The same six chained rounds `hashPassword` performs, so the login route verifies it. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  let derived = new TextEncoder().encode(password);
  for (let stage = 0; stage < PASSWORD_STAGES; stage += 1) derived = await pbkdf2(derived, salt, PBKDF2_ROUNDS_PER_CALL);
  return `${STAGED_SCHEME}$${PASSWORD_STAGES}x${PBKDF2_ROUNDS_PER_CALL}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

/**
 * Runs a statement through wrangler, returning the rows it selected.
 *
 * `--command` rather than `--file`, because `--file` with `--json` reports
 * execution statistics instead of the rows — which reads as an empty result
 * and would quietly defeat the "does an administrator already exist" check
 * below. It has to survive the shell as a single argument, so it is passed
 * double-quoted; every literal inside it is single-quoted and escaped by
 * `quote()`, and a double quote can never reach here.
 *
 * `shell: true` because Node refuses to launch a `.cmd` without one on
 * Windows, which is what `npx` is there.
 */
function d1(sql) {
  const statement = sql.replace(/\s+/gu, " ").trim();
  if (statement.includes('"')) throw new Error("Double quotes cannot be passed through the shell here.");
  const result = spawnSync("npx",
    ["wrangler", "d1", "execute", database, "--config", "wrangler.jsonc",
      ...(environment === "production" ? ["--env", "production"] : []), "--remote", "--json", "--command", `"${statement}"`],
    { encoding: "utf8", shell: true });
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || result.stdout?.trim() || `wrangler exited with ${result.status ?? result.error?.code ?? "no status"}`);
    process.exit(1);
  }
  const at = result.stdout.indexOf("[");
  try {
    return JSON.parse(result.stdout.slice(at))[0]?.results ?? [];
  } catch {
    console.error("Could not read wrangler's answer.");
    process.exit(1);
  }
}

/**
 * Reads the password.
 *
 * From a terminal it is prompted for and masked. Piped — an operator running
 * this from a password manager, say — it is read from stdin, so the value never
 * becomes a shell argument or an environment variable either way.
 */
async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").trimEnd();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Everything but the newline is swallowed, so the password leaves no trace on
  // screen or in a scrollback buffer.
  rl._writeToOutput = (text) => { if (text.includes(String.fromCharCode(10))) rl.output.write(String.fromCharCode(10)); };
  const answer = await new Promise((resolve) => { rl.question(`Password for ${email} (not shown): `, resolve); });
  rl.close();
  return answer;
}

const existing = d1("SELECT COUNT(*) AS admins FROM users WHERE role='admin'");
const admins = Number(existing[0]?.admins ?? 0);
if (admins > 0) {
  // Refused rather than added to: a second administrator belongs to whoever
  // already holds the first, through the app, where it is audited.
  console.error(`${database} already has ${admins} administrator(s). Create further accounts from inside the app.`);
  process.exit(1);
}

const password = await readPassword();
if (password.length < 12) {
  console.error("Choose at least 12 characters. This account can read every family's records.");
  process.exit(1);
}

const hash = await hashPassword(password);
const id = crypto.randomUUID();
const now = new Date().toISOString();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

d1(`INSERT INTO users (id, name, email, password_hash, role, is_active, onboarding_status, created_at, updated_at)
    VALUES (${quote(id)}, ${quote(name)}, ${quote(email)}, ${quote(hash)}, 'admin', 1, 'approved', ${quote(now)}, ${quote(now)})`);

const check = d1(`SELECT role, is_active FROM users WHERE email=${quote(email)}`);
if (check[0]?.role !== "admin") {
  console.error("The account was not created. Check the output above.");
  process.exit(1);
}

console.log(`Administrator created on ${database}: ${email}`);
console.log("Sign in through the app now, and change the password from Settings.");
