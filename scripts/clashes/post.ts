// EVI_CLASH_TOKEN=... bun scripts/clashes/post.ts [clashes.json] [--api <url>]
// Sends the clash checker's report (scripts/clashes.ts) to evi.rest: PUT /v1/clashes. The token is only
// good for that. Prints evi.rest's answer, never the token. Run separately from the checker, which
// runs store plugins' code and so never gets the token.
import { existsSync, readFileSync } from "fs";

import { validateClashReport } from "../../src/shared/clashes";
import { DEFAULT_API_URL } from "../../src/shared/stars";

const args = process.argv.slice(2);
const at = args.indexOf("--api");
const API = String(at >= 0 ? args[at + 1] : process.env.EVI_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--api") ?? "clashes.json";
const token = process.env.EVI_CLASH_TOKEN;
if (!token) throw new Error("Set EVI_CLASH_TOKEN");
if (!existsSync(file)) {
    console.log(`No ${file}: the checker had nothing new, nothing to send`);
    process.exit(0);
}

const checked = validateClashReport(JSON.parse(readFileSync(file, "utf8")));
if ("error" in checked) throw new Error(`${file} isn't a valid report: ${checked.error}`);
const res = await fetch(`${API}/clashes`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "evi-clash-checker (+https://evi.rest)" },
    body: JSON.stringify(checked.report),
});
const text = await res.text();
console.log(`evi.rest answered ${res.status}: ${text.slice(0, 600)}`);
if (!res.ok) process.exit(1);
