/**
 * Evi's plugin CLI: make a plugin, check it, and send it to the store from the terminal.
 *
 *   bun run plugin new <id> [--name "My Plugin"] [--author "You"]   start one in userplugins/
 *   bun run plugin check <id> [--open]                              build it, run the store's checks and the safety check
 *   bun run plugin login [--no-browser]                             link this terminal to your evi.rest account
 *   bun run plugin whoami | logout
 *   bun run plugin upload <id> [--beta] [--yes]                     check it, then upload it for review
 *   bun run plugin status [id]                                      your uploads and what reviewers said
 *
 * Logging in is the link an Evi does (Evi settings, Account): this terminal gets an install id of its
 * own, you confirm a short code on evi.rest, and from then on it acts as your account. The id is kept
 * in Evi's data folder (plugin-cli.json, only yours to read); `logout` forgets it, and evi.rest lists it
 * under your linked Evis to unlink from anywhere. Nothing else is stored, and no other dependencies:
 * new and check are new-plugin.ts and preview-plugin.ts, and upload runs check before it sends.
 *
 * --api <url> (or EVI_API_URL) talks to another evi.rest, like a local server on :8795.
 */
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "util";

import { APP_DATA } from "../src/cli/paths";
import { reviewCode } from "../src/shared/codeReview";
import { DEFAULT_API_URL, isInstallId } from "../src/shared/stars";
import { isPluginId } from "../src/shared/store";

const ROOT = resolve(import.meta.dir, "..");
const LOGIN_FILE = join(APP_DATA, "Evi", "plugin-cli.json");
const FILES = ["manifest.json", "index.js", "native.js"] as const;

const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
        api: { type: "string" },
        beta: { type: "boolean" },
        yes: { type: "boolean" },
        open: { type: "boolean" },
        "no-browser": { type: "boolean" },
        help: { type: "boolean", short: "h" },
    },
});
const [command, target] = positionals;
const API = String(flags.api ?? process.env.EVI_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");

const dim = (s: string) => process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s;
const bold = (s: string) => process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
function fail(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(1);
}

// ---- login -------------------------------------------------------------------------------------

interface Login { install: string; api: string; user?: string; }

function readLogin(): Login | undefined {
    try {
        const saved = JSON.parse(readFileSync(LOGIN_FILE, "utf8")) as Login;
        return isInstallId(saved.install) && saved.api === API ? saved : undefined;
    } catch {
        return undefined;
    }
}

function saveLogin(login: Login) {
    mkdirSync(join(APP_DATA, "Evi"), { recursive: true });
    writeFileSync(LOGIN_FILE, JSON.stringify(login, null, 2), { mode: 0o600 });
}

async function api<T>(method: string, path: string, install: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(API + path, {
            method,
            headers: { "X-Evi-Install": install, ...body !== undefined && { "Content-Type": "application/json" } },
            body: JSON.stringify(body),
        });
    } catch (err) {
        fail(`Couldn't reach ${API}: ${(err as Error).message}`);
    }
    const data = await res.json().catch(() => ({})) as { error?: string; };
    if (!res.ok) fail(data.error ?? `${API} answered ${res.status}`);
    return data as T;
}

/** Opens a link in the default browser; only http(s), so nothing the server sends can run a program */
function openInBrowser(url: string) {
    if (!/^https?:\/\/[^\s"]+$/.test(url)) return;
    Bun.spawnSync(process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url]
        : [process.platform === "darwin" ? "open" : "xdg-open", url]);
}

async function login() {
    const existing = readLogin();
    if (existing) {
        const status = await api<{ linked: boolean; user: { username: string; } | null; }>("GET", "/link", existing.install);
        if (status.linked) return console.log(`✓ Already logged in as ${bold(status.user!.username)}. ${dim("bun run plugin logout to switch")}`);
    }
    const install = existing?.install ?? randomUUID();
    saveLogin({ install, api: API });
    const start = await api<{ code: string; url: string; expiresIn: number; }>("POST", "/link/start", install);
    console.log(`Confirm this code on evi.rest: ${bold(start.code)}`);
    if (flags["no-browser"]) console.log(`  ${start.url}`);
    else {
        console.log(dim(`  ${start.url}  (opening it in your browser)`));
        openInBrowser(start.url);
    }

    const until = Date.now() + start.expiresIn * 1000;
    while (Date.now() < until) {
        await Bun.sleep(2000);
        const status = await api<{ linked: boolean; user: { username: string; } | null; }>("GET", "/link", install);
        if (status.linked) {
            saveLogin({ install, api: API, user: status.user!.username });
            return console.log(`✓ Logged in as ${bold(status.user!.username)}`);
        }
    }
    fail("The code expired. Run bun run plugin login again.");
}

function requireLogin(): Login {
    return readLogin() ?? fail("Not logged in. Run bun run plugin login first.");
}

// ---- plugins -----------------------------------------------------------------------------------

/** Where a plugin's source is, and the id its build is named after */
function findPlugin(id: string | undefined) {
    if (!id) fail("Which plugin? Give its id, like bun run plugin upload my-plugin");
    const source = ["userplugins", "plugins"].map(root => join(ROOT, root, id)).find(dir => existsSync(join(dir, "manifest.json")));
    if (!source) fail(`No plugin called ${id} in userplugins/ or plugins/`);
    const built: string = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")).id ?? id;
    if (!isPluginId(built)) fail(`manifest.json's id "${built}" isn't a plugin id: lowercase letters, digits and dashes`);
    return { source, out: join(ROOT, "dist", "plugins", built), id: built };
}

function run(script: string, args: string[]) {
    return Bun.spawnSync([process.execPath, join(ROOT, "scripts", script), ...args], { stdio: ["inherit", "inherit", "inherit"] }).exitCode;
}

/** The built files, as evi.rest would get them */
function builtFiles(out: string) {
    const files: Partial<Record<typeof FILES[number], Buffer>> = {};
    for (const name of FILES) if (existsSync(join(out, name))) files[name] = readFileSync(join(out, name));
    if (!files["manifest.json"] || !files["index.js"]) fail(`${out} has no manifest.json and index.js: did the build work?`);
    return files as Record<"manifest.json" | "index.js", Buffer> & { "native.js"?: Buffer; };
}

/** What the Review page's safety check will show reviewers, printed; how many dangerous flags it found */
function safetyCheck(out: string) {
    const files = builtFiles(out);
    const review = reviewCode({
        code: files["index.js"].toString("utf8"),
        nativeCode: files["native.js"]?.toString("utf8"),
        manifest: JSON.parse(files["manifest.json"].toString("utf8")),
    });
    const mark = { danger: "✗", warn: "!", note: "·" } as const;
    console.log(`\n${bold("Safety check")} ${dim("(what reviewers see first)")}: ${review.headline}`);
    for (const flag of review.flags.filter(f => f.severity !== "note")) {
        console.log(`  ${mark[flag.severity]} ${flag.title}${flag.details.length ? dim(` (${flag.details.slice(0, 4).join(", ")})`) : ""}`);
        for (const hit of flag.hits.slice(0, 2)) console.log(dim(`      ${hit.file}:${hit.line}  ${hit.text.slice(0, 100)}`));
    }
    const notes = review.flags.filter(f => f.severity === "note").length;
    if (notes) console.log(dim(`  and ${notes} ${notes === 1 ? "note" : "notes"} that are usually fine`));
    return review.flags.filter(f => f.severity === "danger").length;
}

async function upload(id: string | undefined) {
    const plugin = findPlugin(id);
    const { install } = requireLogin();
    // check first: it builds, and exits 1 when evi.rest would refuse the upload
    if (run("preview-plugin.ts", [plugin.id]) !== 0) fail("Fix what the checks found above, then upload again");
    const dangers = safetyCheck(plugin.out);

    const files = builtFiles(plugin.out);
    const manifest = JSON.parse(files["manifest.json"].toString("utf8"));
    const channel = flags.beta ? "beta" : "stable";
    const what = `${manifest.name ?? plugin.id} ${manifest.version}${channel === "beta" ? " (beta)" : ""}`;
    if (!flags.yes) {
        if (!process.stdin.isTTY) fail("Add --yes to upload without being asked");
        const extra = dangers ? ` The safety check found ${dangers === 1 ? "something" : `${dangers} things`} reviewers will ask about.` : "";
        const answer = prompt(`\nUpload ${what} for review?${extra} [y/N]`);
        if (!/^y(es)?$/i.test(answer?.trim() ?? "")) fail("Not uploaded");
    }
    const body = { channel, files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, data.toString("base64")])) };
    await api("POST", "/me/submissions", install, body);
    console.log(`✓ Uploaded ${what}. Evi's team reads every version before it goes in the store; bun run plugin status shows how it's going.`);
}

const STATUS: Record<string, string> = { pending: "waiting for review", approved: "published", rejected: "not approved", withdrawn: "replaced by a newer upload" };

function ago(at: number) {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

async function status(id: string | undefined) {
    const { install } = requireLogin();
    const { submissions } = await api<{ submissions: { plugin: string; version: string; channel: string; status: string; reviewNote: string; createdAt: number; }[]; }>("GET", "/me/submissions", install);
    const list = submissions.filter(s => !id || s.plugin === id).slice(0, 20);
    if (!list.length) return console.log(id ? `No uploads of ${id} yet` : "No uploads yet. bun run plugin upload <id> sends one.");
    for (const s of list) {
        console.log(`${bold(s.plugin)} ${s.version}${s.channel === "beta" ? " beta" : ""}  ${STATUS[s.status] ?? s.status}  ${dim(ago(s.createdAt))}`);
        if (s.reviewNote) console.log(`    ${s.reviewNote}`);
    }
}

// ---- commands ----------------------------------------------------------------------------------

const HELP = `Evi's plugin CLI

  bun run plugin new <id> [--name "My Plugin"] [--author "You"]   start a plugin in userplugins/
  bun run plugin check <id> [--open]                              build it, run the store's checks and the safety check
  bun run plugin login [--no-browser]                             link this terminal to your evi.rest account
  bun run plugin whoami | logout
  bun run plugin upload <id> [--beta] [--yes]                     check it, then upload it for review
  bun run plugin status [id]                                      your uploads and what reviewers said

Writing plugins: docs/plugins.md`;

switch (flags.help ? "help" : command) {
    case "new":
        process.exit(run("new-plugin.ts", process.argv.slice(3)));
    case "check": {
        const plugin = findPlugin(target);
        const code = run("preview-plugin.ts", [plugin.id, ...flags.open ? ["--open"] : []]);
        if (existsSync(join(plugin.out, "index.js"))) safetyCheck(plugin.out);
        process.exit(code);
    }
    case "login":
        await login();
        break;
    case "whoami": {
        const saved = requireLogin();
        const s = await api<{ linked: boolean; user: { username: string; } | null; }>("GET", "/link", saved.install);
        console.log(s.linked ? `Logged in as ${bold(s.user!.username)} ${dim(`on ${API}`)}` : "Not linked any more. Run bun run plugin login.");
        break;
    }
    case "logout":
        rmSync(LOGIN_FILE, { force: true });
        console.log(`✓ Logged out. ${dim("To end it on evi.rest too, unlink it under your linked Evis")}`);
        break;
    case "upload":
        await upload(target);
        break;
    case "status":
        await status(target);
        break;
    case undefined:
    case "help":
        console.log(HELP);
        break;
    default:
        fail(`No command "${command}"\n\n${HELP}`);
}
