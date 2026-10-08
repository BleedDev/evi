// Evi Setup's window. The Rust side (src/main.rs) does the work: scan, latest_release and run.
"use strict";

const tauri = window.__TAURI__;
const invoke = tauri.core.invoke;
const appWindow = tauri.window.getCurrentWindow();

const $ = id => document.getElementById(id);
const state = { scan: null, selected: new Set(), busy: false };

const ICONS = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};

function describe(install) {
    switch (install.state) {
        case "evi":
            if (install.devBuild) return t("devBuild");
            return install.eviVersion ? t("installedVersion", { version: install.eviVersion }) : t("installed");
        case "clean":
            return t("notInstalled");
        case "other-mod":
            return t("otherMod");
        default:
            return t("notFound");
    }
}

const selectable = install => install.state === "clean" || install.state === "evi";

/** Evi's installs stay picked, plus Stable; otherwise the first one Evi can go into */
function defaultSelection(installs) {
    const usable = installs.filter(selectable);
    const picked = usable.filter(i => i.state === "evi" || i.flavor === "stable");
    return new Set((picked.length ? picked : usable.slice(0, 1)).map(i => i.flavor));
}

function renderInstalls(animate) {
    const list = $("installs");
    list.replaceChildren();
    state.scan.installs.forEach((install, index) => {
        const row = document.createElement("label");
        row.className = `install state-${install.state}`;
        if (!selectable(install)) row.classList.add("unavailable");
        if (animate) {
            row.classList.add("entering");
            row.style.setProperty("--i", index);
        }
        if (install.path) row.title = install.path;

        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "check";
        box.disabled = !selectable(install);
        box.checked = state.selected.has(install.flavor);
        box.addEventListener("change", () => {
            if (box.checked) state.selected.add(install.flavor);
            else state.selected.delete(install.flavor);
            updateButtons();
        });

        const text = document.createElement("span");
        text.className = "install-text";
        const name = document.createElement("span");
        name.className = "install-name";
        name.textContent = `Discord ${install.label}`;
        const status = document.createElement("span");
        status.className = "install-state";
        const dot = document.createElement("span");
        dot.className = "dot";
        status.append(dot, describe(install));
        text.append(name, status);

        row.append(box, text);
        if (install.discordVersion && install.discordVersion !== "?") {
            const version = document.createElement("span");
            version.className = "install-version";
            version.textContent = install.discordVersion;
            row.append(version);
        }
        list.append(row);
    });

    const found = state.scan.installs.some(i => i.state !== "missing");
    $("hint").textContent = found ? t("hint") : t("hintMissing");
    updateButtons();
}

function chosen() {
    return state.scan ? state.scan.installs.filter(i => state.selected.has(i.flavor) && selectable(i)) : [];
}

function updateButtons() {
    const picked = chosen();
    $("install").disabled = state.busy || !picked.length;
    $("uninstall").disabled = state.busy || !picked.some(i => i.state === "evi");
    $("close").disabled = state.busy;
}

function show(view) {
    for (const id of ["choose", "working"]) {
        const el = $(id);
        el.hidden = id !== view;
        el.classList.remove("entering");
        if (id === view) {
            void el.offsetWidth;
            el.classList.add("entering");
        }
    }
}

function setStatus(kind, title, text) {
    const icon = $("status-icon");
    icon.className = `status-icon ${kind}`;
    icon.innerHTML = kind === "done" ? ICONS.check : kind === "failed" ? ICONS.cross : "";
    $("status-title").textContent = title;
    $("status-text").textContent = text ?? "";
}

function listOutcomes(outcomes) {
    const list = $("outcomes");
    list.replaceChildren(...outcomes.map(o => {
        const item = document.createElement("li");
        item.className = `outcome ${o.ok ? "ok" : "failed"}`;
        item.innerHTML = o.ok ? ICONS.check : ICONS.cross;
        item.append(o.message);
        return item;
    }));
}

async function scan(animate) {
    state.scan = await invoke("scan");
    if (!state.selected.size) state.selected = defaultSelection(state.scan.installs);
    renderInstalls(animate);
}

async function run(action) {
    const flavors = chosen().map(i => i.flavor);
    if (!flavors.length || state.busy) return;
    state.busy = true;
    updateButtons();
    listOutcomes([]);
    $("status-actions").hidden = true;
    const verb = action === "install" ? t("installing") : t("removing");
    setStatus("busy", verb, action === "install" ? t("gettingReady") : "");
    show("working");

    let report;
    try {
        report = await invoke("run", { action, flavors });
    } catch (err) {
        report = { ok: false, error: String(err), outcomes: [], restarted: [], startByHand: [] };
    }
    state.busy = false;
    updateButtons();

    if (report.error) {
        setStatus("failed", action === "install" ? t("installFailed") : t("removeFailed"), report.error);
    } else if (report.ok) {
        const restarting = report.restarted.length > 0;
        const title = restarting ? t("doneRestarting") : action === "install" ? t("doneInstalled") : t("doneRemoved");
        let text = action === "install"
            ? t("isInstalled", { version: report.version }) + (restarting ? t("opensShortly") : "")
            : t("backToNormal");
        if (report.startByHand.length) text += t("openYourself", { list: joinList(report.startByHand) });
        setStatus("done", title, text);
        if (report.outcomes.length > 1) listOutcomes(report.outcomes);
    } else {
        setStatus("failed", t("someFailed"), t("whatHappened"));
        listOutcomes(report.outcomes);
    }
    $("status-actions").hidden = false;
    $("finish").focus();
    // What's installed now, for Back
    scan(false).catch(() => { });
}

/** The Evi an install lays down: always the latest release */
async function showLatest() {
    try {
        const latest = await invoke("latest_release");
        if (latest.version) $("version").textContent = `· v${latest.version}`;
    } catch { }
}

$("install").addEventListener("click", () => run("install"));
$("uninstall").addEventListener("click", () => run("uninstall"));
$("back").addEventListener("click", () => show("choose"));
$("finish").addEventListener("click", () => appWindow.close());
$("minimize").addEventListener("click", () => appWindow.minimize());
$("close").addEventListener("click", () => {
    if (!state.busy) appWindow.close();
});

tauri.event.listen("progress", event => {
    if (state.busy) $("status-text").textContent = event.payload;
});

// No browser context menu or reload shortcuts in an installer
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) e.preventDefault();
});

translatePage();
scan(true).catch(err => {
    $("installs").textContent = t("scanFailed", { error: err });
});
showLatest();
