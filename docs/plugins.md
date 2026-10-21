# Writing Evi plugins

A complete guide to building an Evi plugin, from an empty folder to a store release. It's written so a person or an AI assistant can follow it start to finish. [Developing Evi](development.md)'s [Writing a plugin](development.md#writing-a-plugin) section is the short version.

- [0. Start in a minute](#0-start-in-a-minute)
- [1. Anatomy](#1-anatomy)
- [2. The manifest](#2-the-manifest)
- [3. The plugin definition](#3-the-plugin-definition)
- [4. Settings](#4-settings)
- [5. Finding Discord's code](#5-finding-discords-code)
- [6. Export hooks](#6-export-hooks)
- [7. Source patches](#7-source-patches)
- [8. Flux](#8-flux)
- [9. UI: toasts, menus, commands, components, CSS](#9-ui-toasts-menus-commands-components-css)
- [10. Native code](#10-native-code)
- [11. Storage](#11-storage)
- [12. Testing](#12-testing)
- [13. Publishing to the store](#13-publishing-to-the-store)
- [14. Rules and pitfalls](#14-rules-and-pitfalls)
- [15. Generating a plugin with Claude](#15-generating-a-plugin-with-claude)
- [16. DevTools and API changes](#16-devtools-and-api-changes)

## 0. Start in a minute

```sh
bun run new-plugin my-plugin          # userplugins/my-plugin/, ready to run
bun run dev                           # builds it, and reloads it in Discord as you save
bun test userplugins/my-plugin        # its test
bun run preview-plugin my-plugin --open   # its store page, and what the store would say about it
```

`new-plugin` writes a manifest (with a `locales` example), an `index.tsx` with a setting, a keyboard shortcut and a slash command, a `strings.ts` with its text in every language Evi speaks (see "Translations"), a pure `greeting.ts` and its test, all following this guide. Turn it on in Evi (`Ctrl+Shift+D`, Plugins), try its command, then make it yours. Options: `--name "My Plugin"`, `--author "You"`, and `--official` for a plugin in `plugins/` with its test in `tests/`.

## 1. Anatomy

A plugin is a folder. Official plugins live in `plugins/`, your own in `userplugins/` (gitignored). Both are built the same way.

```
plugins/my-plugin/
  manifest.json    required
  index.ts(x)      renderer code, required
  native.ts        main-process code, optional
  logic.ts         anything else you import, bundled into index.js
```

`bun run build` (or `bun run dev` to rebuild on save) bundles each plugin into `dist/plugins/<id>/`:

- `index.ts(x)` becomes `index.js`: CommonJS, browser target. `@evi/api`, `react`, `react-dom` and the JSX runtimes are provided at runtime, **everything else is bundled in**. A plugin that `require`s anything else at runtime fails with *"Only @evi/api and react are provided, bundle anything else."*
- `native.ts` becomes `native.js`: CommonJS, Node target, `electron` external.
- The manifest is written last, with `main` and `native` filled in. The running client reloads the plugin when the manifest changes.

With `bun run dev` running, saving a plugin file stops the plugin, evaluates the new code and starts it again. Discord doesn't reload. Native code changes need a Discord restart.

Multiple files are normal. The convention is: Discord-facing code in `index.tsx`, pure logic in a sibling file (`track.ts`, `snippets.ts`, `filter.ts`...) with no Discord or DOM access, so it can be unit tested.

## 2. The manifest

```json
{
    "id": "my-plugin",
    "name": "My Plugin",
    "description": "One or two plain sentences on what it does for the user.",
    "version": "1.0.0",
    "authors": ["You"],
    "tags": ["messages"],
    "permissions": { "readMessages": true },
    "changelog": [{ "version": "1.0.0", "notes": ["First release."] }],
    "enabledByDefault": false
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Lowercase letters, digits and dashes. It's the folder name and the settings key. Defaults to the folder name at build time |
| `name` | yes | Shown in the Plugins tab and the store |
| `description` | | Shown in the Plugins tab and the store. Say what the user gets, not how it works |
| `version` | | Semver. The store offers an update when the registry's is newer (`1.10.0` > `1.9.0`, `1.0.0` > `1.0.0-beta`) |
| `authors` | | |
| `tags` | | Store search keywords and categories. Existing ones: `privacy`, `messages`, `social`, `developer`... |
| `changelog` | | Newest first. Shown in the plugin's details and store page |
| `source` | | `https` link to the source, published to the registry |
| `screenshots` | | `https` image links, published to the registry |
| `preview` | | `https` link to a short `.mp4`, `.webm`, `.gif` or `.webp` of it in use, played at the top of its store page (12 MB at most) |
| `minEviVersion` | | Oldest Evi it works with. Defaults to the current Evi version when published |
| `enabledByDefault` | | On when first installed. Official plugins are off unless they're safe and broadly wanted |
| `chromiumSwitches` | | `{ "switch-name": "value" }` or `true` for bare flags. Applied at Discord start while the plugin is on, so changes need a restart. Makes the plugin *native* in the store |
| `permissions` | for the store | What it needs from Discord's page, see below. Evi blocks the rest. Required for store uploads |

`main` and `native` are set by the build; don't write them yourself.

### Permissions

Say what the plugin needs, and Evi holds it to that: anything else it tries through Evi fails and shows as **Blocked** in its Activity. The store page, the install question and the plugin's details list it in plain words.

```json
"permissions": {
    "network": ["api.example.com", "cdn.discordapp.com"],
    "readMessages": true,
    "sendMessages": false,
    "changeSettings": false
}
```

| Key | Covers |
|---|---|
| `network` | Sites it contacts, Discord's own included. Just the host (`api.example.com`, no `https://`, port, path or `*`); a host covers its subdomains, so `discordapp.com` covers `cdn.discordapp.com`. Relative URLs are `discord.com` |
| `readMessages` | Subscribing to message events (`MESSAGE_CREATE`, `LOAD_MESSAGES_SUCCESS`, `DRAFT_CHANGE`...), looking up message stores by name (`MessageStore`, `ReferencedMessageStore`, `DraftStore`...), hooking the Flux dispatcher's `dispatch`, Discord's message actions (`sendMessage`, `editMessage`...) or a message store |
| `sendMessages` | A slash command that returns `{ content }`, and posting, editing or deleting through Discord's message, interaction and webhook endpoints |
| `changeSettings` | Changing your account or settings through Discord's settings endpoints, and your Evi badges (`Badges.setPrefs`, `Badges.manage`) |

Anything left out is no, so `"permissions": {}` asks for nothing. A refused `fetch` rejects with a `PluginPermissionError`; everything else throws one, with a message that says what to add.

What Evi can hold a plugin to is what goes through Evi: the `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` its code sees, its `ctx`, and its own copy of `@evi/api`. Plugins share Discord's page, so code that reaches around those (`window.fetch`, a finder by props that returns `MessageStore`, a source patch, Discord's own send function) can still do more; that's why store plugins are still reviewed, and declarations are checked against the code. A full-access part (`native.ts`) isn't limited at all: list the sites it contacts in `network` anyway, so people know.

A plugin without `permissions` isn't held to anything and is labelled *Doesn't declare its permissions*. An update that asks for more than the installed version (a new site, a new yes, or dropping `permissions`) asks the user before it's installed, and background updates wait for them.

## 3. The plugin definition

`index.ts(x)` default-exports `definePlugin({...})`:

```tsx
import { definePlugin, filters } from "@evi/api";

export default definePlugin({
    settings: { /* §4 */ },
    patches: [ /* §7 */ ],
    css: `/* applied while the plugin runs */`,
    flux: { MESSAGE_CREATE(action) { /* subscribed while the plugin runs */ } },

    start(ctx) {
        // Register everything through ctx: it's all undone on stop and hot reload
    },
    stop(ctx) {
        // Only for what ctx can't track. ctx's own cleanup runs after this
    },
    settingsPanel(ctx) {
        return null; // extra React UI under the generated settings
    },

    // Any other member is reachable from source patches as $self
    renderThing() { },
});
```

`start` runs once Discord's core modules are available, when the plugin is turned on, and after every hot reload. It may be `async`.

### The context (`ctx`)

Everything registered through `ctx` is undone automatically when the plugin stops. **Use it for everything**: that's what makes turning a plugin off and hot-reloading it safe without a Discord reload.

| Member | What it does |
|---|---|
| `ctx.id`, `ctx.manifest` | The plugin's id and manifest |
| `ctx.logger` | `.info / .warn / .error(...)`, prefixed with the plugin's name |
| `ctx.settings` | Typed settings, see §4 |
| `ctx.hook.before / after / instead(obj, key, cb)` | Hook a function on an object you already have |
| `ctx.hookExport(kind, filter, [method], cb)` | Hook a webpack export as soon as its module loads, even if it's lazy |
| `ctx.waitFor(filter, cb)` | Called back once a matching export exists (immediately if it already does) |
| `ctx.flux.subscribe(type, handler)` / `ctx.flux.dispatch(action)` | Flux actions. Handler errors are caught and logged |
| `ctx.native.call(method, ...args)` | Call a function exported by `native.ts`. Returns a Promise |
| `ctx.toast(message, options?)` | One of Discord's toasts |
| `ctx.contextMenu(navId, cb)` | Add items to a Discord menu |
| `ctx.command(definition)` | A local slash command |
| `ctx.addStyle(css)` | A stylesheet. Returns a handle you can update or remove |
| `ctx.keybind(key, handler)` | Run `handler` when the shortcut in the `keybind` setting `key` is pressed, see §4 |
| `ctx.setInterval / setTimeout` | Timers cleared on stop |
| `ctx.onDispose(fn)` | Run `fn` on stop. For anything else you set up |

Module-level state is common (`let context: PluginContext<Settings> | undefined`), since source patches and React components live outside `start`. Set it in `start` and clear it with `ctx.onDispose(() => void (context = undefined))`.

## 4. Settings

Declare a schema and Evi renders the settings UI for you. Declare it `as const` so `ctx.settings` is fully typed:

```ts
type Settings = typeof settings;
const settings = {
    enabled: { type: "boolean", label: "Enabled", description: "Optional helper text.", default: true },
    greeting: { type: "string", label: "Greeting", default: "hi", placeholder: "Say something", multiline: false },
    limit: { type: "number", label: "Limit", default: 100, min: 10, max: 1000, step: 10 },
    mode: {
        type: "select", label: "Mode", default: "send",
        options: [{ label: "Send it", value: "send" }, { label: "Insert it", value: "insert" }],
    },
    shortcut: { type: "keybind", label: "Shortcut", description: "Does the thing from anywhere in Discord.", default: "" },
} as const;
```

The Plugins tab's search finds settings too, by label, description and option: write them so someone looking for what the setting does would find it.

### Keyboard shortcuts

A `keybind` setting is a field people set by pressing the keys, like Discord's own keybinds. `ctx.keybind` runs something when they're pressed, anywhere in Discord:

```ts
ctx.keybind("shortcut", () => toggle());
```

- The value is stored as physical keys, `"Ctrl+Shift+KeyS"` (modifiers, then the key's [`code`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code)), and `""` for none. The field shows it as keycaps, `⌘` and `⌥` on macOS.
- It's read on every key press, so a new shortcut works at once. It's removed when the plugin stops.
- A shortcut needs Ctrl, Alt or Meta (Shift+G is just a capital G while typing); F1 to F24 work alone. `Ctrl+Shift+D` is Evi's.
- Leave the default `""` unless the plugin is about the shortcut: people pick their own, and the field says when two plugins want the same keys.
- The keys don't reach Discord, so a shortcut that's also Discord's runs yours instead.
- Needs Evi 1.0.0: set `"minEviVersion": "1.0.0"`.

| Call | What it does |
|---|---|
| `ctx.settings.get("limit")` | The value, or its default |
| `ctx.settings.set("limit", 50)` | Saves it. Settings are flushed to disk, also on unload |
| `ctx.settings.all` | Every value with defaults filled in |
| `ctx.settings.use()` | React hook: the values, re-renders on change |
| `ctx.settings.onChange(values => …)` | Called when any of this plugin's settings change. Removed on stop |

Read settings when you need them (`ctx.settings.get` inside the hook), not once in `start`, so changes apply live.

## 5. Finding Discord's code

Discord's code is minified webpack modules whose names change on every build. You find things by what they *have* (property names) or what their code *contains* (strings that survive minification: action types, CSS class names, i18n keys, error messages).

```ts
import { filters, find, findByProps, findByCode, findComponent, findStore, getStore, waitFor } from "@evi/api";

filters.byProps("startTyping", "stopTyping")       // objects with all these properties
filters.byCode(".currentToastMap.has(")            // functions whose source contains all snippets (string or RegExp)
filters.componentByCode("CHAT_INPUT_BUTTON_NOTIFICATION")  // React components, memo/forwardRef unwrapped
filters.byStoreName("UserStore")                   // Flux stores
```

| Finder | Returns |
|---|---|
| `find(filter)`, `findAll(filter)` | The first / every loaded match |
| `findByProps`, `findByCode`, `findComponent`, `findStore` | Shorthands for the filters above |
| `findExport(filter)` / `findAllExports` | `{ id, exports, key, value }`: where the value lives, for hooking |
| `findLazy`, `findByPropsLazy`, `findComponentLazy`, `findStoreLazy`... | A proxy that resolves on first use. Safe at module top level |
| `waitFor(filter, cb)`, `waitForExport(filter)` | Called back / resolved once it loads. Prefer `ctx.waitFor` in plugins |
| `getStore("SelectedChannelStore")` | A Flux store by name |
| `findModuleIds(...code)`, `requireModule(id)` | Raw module access |
| `React`, `ReactDOM`, `createRoot`, `Dispatcher` | Discord's own instances |

`find` only sees modules that have already run. Much of Discord loads lazily, so for anything you'll hook, use `ctx.hookExport` or `ctx.waitFor`, which fire whenever the module shows up.

To discover what to search for, open DevTools in Discord (`Ctrl+Shift+I`) and search the sources, or use the **Patch Helper** tab (`Ctrl+Shift+D`), which shows which modules a string hits. Pick strings that are specific to one module and unlikely to change.

## 6. Export hooks

Hooks wrap a function without touching its source. They survive most Discord updates, so **prefer a hook to a source patch** whenever the function you need is exported.

```ts
// Change arguments before the call
ctx.hookExport("before", filters.byProps("sendMessage", "editMessage"), "sendMessage", ({ args }) => {
    args[1].content = args[1].content.trim();
});

// Change or read the result after the call. A non-undefined return value replaces the result
ctx.hookExport("after", filters.byProps("getUser"), "getUser", ({ result }) => { /* ... */ });

// Replace the call. Call callOriginal to continue down the chain
ctx.hookExport("instead", filters.byProps("startTyping", "stopTyping"), "startTyping", call => {
    if (!ctx.settings.get("enabled")) return call.callOriginal(...call.args);
});

// Hook the matched export itself (a component or function export) instead of a method on it
ctx.hookExport("after", filters.componentByCode("some-unique-string"), ({ result }) => { /* ... */ });

// An object you already have
ctx.hook.after(getStore("UserStore"), "getCurrentUser", ({ result }) => { /* ... */ });
```

The hook callback gets `{ self, args, result, isConstruct, original, callOriginal }`. Hooks from several plugins chain; errors in one hook are isolated and logged. `getUnhooked(fn)` returns the original of a hooked function.

## 7. Source patches

A source patch rewrites a module's code right before it first runs. It can change anything, but it's tied to Discord's minified code, so it's the first thing to break on a Discord update. Use one when there's no export to hook: code inside a component's render, a local variable, an inline callback.

```ts
patches: [{
    // A string or RegExp found in exactly the module you want
    find: "\"ChannelTextAreaButtons\"",
    replace: {
        // \i matches any minified identifier
        match: /(?<=[,(])0===(\i)\.length(?=\)\?null:)/,
        // $1.. are capture groups, $self is your plugin's definition object
        with: "($self?.injectButton?.($1,arguments[0]),0===$1.length)",
    },
}],
injectButton(buttons: unknown[], props: any) { /* ... */ },
```

| Field | What it does |
|---|---|
| `find` | String or RegExp that only the target module's source contains |
| `replace` | `{ match, with }` or an array of them. `with` follows `String.prototype.replace` (string or function) |
| `all` | Patch every module that matches `find`, not only the first |
| `group` | If one replacement fails, apply none |
| `optional` | Don't report as broken when nothing matches |
| `predicate` | Skip the patch when it returns false. Checked when the module loads |
| `live` | Force (`true`) or forbid (`false`) re-running an already-loaded module when the patch changes |

Rules for patches that don't break Discord:

- **Call `$self` optionally**: `$self?.fn?.(...)`. The patched code keeps running after the plugin is turned off, and then `$self` is gone.
- **Fall back to Discord's own value**: `$self?.filter?.(x) ?? x`. If your code throws or is missing, Discord behaves as if the patch weren't there.
- **Keep the patched code a valid expression or statement in place.** Each patch is compiled on its own and reverted if the module no longer compiles, but a patch that compiles and does the wrong thing isn't caught.
- **Wrap your `$self` functions in `try/catch`** and log with `ctx.logger`. An exception there throws inside Discord's render.
- **Match on structure, not names.** Use `\i` for every minified identifier, lookbehind/lookahead to anchor without consuming, and short, stable strings.
- **Write a comment above the patch** with what the original code looks like and when you checked it. It's what the next person needs when it breaks.

Build patches in the **Patch Helper** tab: it shows as you type which modules `find` hits, what `match` catches with context, the before and after code, and whether the result compiles, then gives you the finished patch to paste. The **Patches** tab reports every patch as `applied`, `waiting` (lazy chunk not loaded yet), `broken` or `ambiguous`.

Changing a patch hot-reloads in most cases: the module is re-run with the new patch set (*live module replacement*). Modules that can't safely run twice (Flux stores, bare-function exports, modules that subscribe to Flux when they run) get a reload banner instead.

When a Discord update breaks a store plugin's patch, Evi's team can fix it on every install without a new version (a *hotfix*). It finds the patch by its place in `patches` and the `find` it has, and a lookup by what the Patches tab shows for it, so keep your patches in the same order between versions. The plugin's details then say Evi fixed it. A hotfix covers the versions Evi's team picks, usually the ones that broke, so your next version runs as you wrote it.

## 8. Flux

Discord's state changes go through its Flux dispatcher as actions like `MESSAGE_CREATE`, `PRESENCE_UPDATES`, `CHANNEL_SELECT`.

```ts
flux: {
    MESSAGE_CREATE({ message }) { /* ... */ },
},

start(ctx) {
    ctx.flux.subscribe("PRESENCE_UPDATES", action => { /* ... */ });
    ctx.flux.dispatch({ type: "SOME_ACTION", /* ... */ });
}
```

Read state from stores (`getStore("UserStore").getCurrentUser()`, `getStore("SelectedChannelStore").getChannelId()`) rather than keeping your own copy when a store already has it. To see which actions fire, subscribe with a logger temporarily, or hook `Dispatcher.dispatch`.

## 9. UI: toasts, menus, commands, components, CSS

All of these use Discord's own systems, so they look and behave like Discord's.

### Toasts

```ts
ctx.toast("Copied", { type: "success" }); // "info" (default), "success", "failure", "message", "link", "clock", "bookmark", "favorite"
ctx.toast("Saved", { duration: 5000, position: "bottom" });
```

Toasts queue: one shows at a time.

### Menu items

```tsx
import { findMenuGroup, Menu } from "@evi/api";

ctx.contextMenu("message", (children, { message }) => {
    if (!message) return;
    (findMenuGroup(children, "copy-text") ?? children).push(
        <Menu.Item id="my-plugin-copy" label="Copy Content" action={() => navigator.clipboard.writeText(message.content)} />,
    );
});
```

- `navId` is Discord's menu name: `"message"`, `"user-context"`, `"guild-context"`, `"channel-context"`, `"gdm-context"`... or `"*"` for every menu, or an array.
- `children` is a fresh copy on every render. Push, splice, or use `findMenuGroup(children, itemId)` to add next to one of Discord's items.
- Only Discord's own components work: `Menu.Item`, `Menu.Group`, `Menu.Separator`, `Menu.CheckboxItem`, `Menu.RadioItem`, `Menu.SwitchItem`, `Menu.ControlItem`.
- Item `id`s must be unique in the menu. Prefix them with your plugin id.
- The second argument holds what the menu was rendered with (message, channel, user, guild...), or `{}` where it couldn't be captured. Always check before using it.

### Slash commands

```ts
ctx.command({
    name: "roll",                    // lowercase, no spaces
    description: "Roll a die",
    options: [{ name: "sides", description: "How many sides", type: "integer", required: true }],
    predicate: ({ channel, guild }) => true,   // hide where it doesn't apply
    execute(args, { channel, guild, reply }) {
        return { ephemeral: `Rolled ${1 + Math.floor(Math.random() * args.sides)}` };
    },
});
```

- Option `type`: `"string"` (default), `"integer"`, `"number"`, `"boolean"`, `"user"`, `"channel"`, `"role"`, `"mentionable"`, `"attachment"`. `choices: [{ name, value }]` gives a fixed list. User, channel and role options give ids.
- Return `{ ephemeral: "..." }` for an "Only you can see this" reply, `{ content: "..." }` to send a message as the user, or nothing. `reply(text)` sends an ephemeral reply at any point.
- A thrown error shows a failure toast.

### React and Discord's components

Plugins can use JSX and `import` React; both resolve to Discord's own React. For settings panels and your own UI, `Components` gives Discord's form controls:

```tsx
import { Components } from "@evi/api";

function ClearPanel() {
    const Button = Components.Button as any;
    if (!Button) return null; // undefined if Discord renamed it
    return <Button onClick={clear}>Clear</Button>;
}
```

Available: `Switch`, `TextField`, `TextArea`, `Select`, `Slider`, `Button`, `Tooltip`. Each can be undefined after a Discord update, so check first and render a fallback.

For a dropdown, use Evi's own `Dropdown` (Evi 2.0.0 and newer) rather than a `<select>`, whose list is the system's own, with its scrollbar. It looks and moves like Discord's, its list is never cut off by a dialog, it has no scrollbar, works from the keyboard, and gets a filter box once there are more than 12 options:

```tsx
import { Dropdown } from "@evi/api";

<Dropdown
    label="Server"                 // names it for screen readers
    value={guildId}
    onChange={setGuildId}
    options={guilds.map(g => ({ value: g.id, label: g.name, disabled: g.full }))}
/>
```

Optional: `id`, `labelledBy` (the id of a visible label), `disabled`, `className` (added to the button, to size it). Set `"minEviVersion": "2.0.0"`, or check `Dropdown` exists and fall back to a `<select>` on older Evi.

Put injected UI into Discord's tree through a source patch that calls a `$self` render function (see Silent Typing's chat bar button), or through an `after` hook on a component export that edits `result`. `findInTree(tree, predicate)` searches a React element tree.

### CSS

`css` in the definition, or `ctx.addStyle(css)` for styles you add or change at runtime.

- Prefix your class names with `evi-<plugin-id>-` so nothing collides with Discord or other plugins.
- Use Discord's CSS variables (`var(--interactive-normal)`, `var(--text-normal)`, `var(--background-secondary)`...) so it works with every theme.
- Don't target Discord's hashed class names (`buttonContainer_a1b2c3`) directly in CSS; they change. If you need one, find it at runtime from its CSS module (see `getContainerClass` in `plugins/silent-typing/index.tsx`) or target stable attributes (`[aria-label]`, `[data-list-item-id]`).

### Translations

Evi's own UI follows Discord's language (the one picked in Discord's Language settings) and switches live when it changes, and so does every plugin in the store.

**The store requires every string in every language Evi speaks:** English, German (`de`), Spanish (`es`), French (`fr`), Japanese (`ja`), Polish (`pl`), Portuguese (`pt-BR`), Russian (`ru`) and Turkish (`tr`). An upload is refused, with what's missing, when:

- the code's text isn't in `defineStrings`: settings labels and descriptions written as plain strings count as English only;
- a `defineStrings` language lacks a key `en` has, or a language is missing altogether;
- `manifest.json`'s `locales` lacks a language's `name`, `description`, or this version's changelog notes.

`bun run preview-plugin` runs the same check (`src/shared/pluginTranslations.ts`) before you upload. Reviewers also look for text the check can't see, like a toast written as a plain string, and send it back.

```tsx
import { defineStrings, useLocale } from "@evi/api";

const t = defineStrings({
    en: { copied: "Copied {name}", messages: { one: "{count} message", other: "{count} messages" } },
    es: { copied: "Se copió {name}", messages: { one: "{count} mensaje", other: "{count} mensajes" } },
    "pt-BR": { copied: "{name} copiado" },
    ru: { messages: { one: "{count} сообщение", few: "{count} сообщения", many: "{count} сообщений", other: "{count} сообщения" } },
});

ctx.toast(t("copied", { name: user.username }));

function Counter({ n }: { n: number; }) {
    useLocale(); // re-renders when Discord's language changes
    return <span>{t("messages", { count: n })}</span>;
}
```

- Keys come from `en`; other languages can only use those keys (TypeScript checks it), and for the store each one needs all of them.
- `{name}` is filled from the second argument. A plural is an object keyed by [plural category](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html) (`one`, `few`, `many`, `other`...), picked by `count`; `other` is required.
- Languages are Discord's tags. `pt-BR` matches exactly; `es` also covers `es-ES` and `es-419`. `I18n.discordLocale` is Discord's tag, `I18n.locale` the one Evi uses for its own UI.
- Settings are read when they're drawn, so give them getters: `{ type: "boolean", get label() { return t("settings.sound"); }, default: true }`.
- Your manifest's `name`, `description` and `changelog` stay in English; translations go in `locales`, and the Plugins tab and the store show whichever matches Discord's language:

```json
"locales": {
    "de": { "name": "Symbole ansehen", "description": "…", "changelog": { "1.0.0": ["Erste Version."] } },
    "tr": { "description": "…" }
}
```

## 10. Native code

`native.ts` runs in Discord's main process with full Node and Electron access. Use it only for what the renderer can't do:

- **Network outside Discord.** Discord's Content-Security-Policy blocks `fetch` to anything but its own hosts, and Evi doesn't loosen it. Make the request in native with Electron's `net`.
- **Files and the OS**, or **blocking/redirecting Discord's own requests**.

```ts
import type { NativePlugin } from "@evi/api/native";
import { net } from "electron";

export default {
    start(ctx) {
        // ctx.pluginId, ctx.pluginDir, ctx.dataDir
        // The patterns keep every other request out of main's JS; the filter still checks the URL
        ctx.onBeforeRequest(({ url }) => url.includes("/science") ? { cancel: true } : undefined, ["https://*.discord.com/api/*"]);
        ctx.onDispose(() => { /* ... */ });
    },
    stop() { },

    // Every other exported function is callable from the renderer
    async lookup(query: unknown) {
        if (typeof query !== "string") throw new Error("Bad query");
        const res = await net.fetch(`https://api.example.com/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
} satisfies NativePlugin;
```

```ts
// index.tsx
const result = await ctx.native.call<{ text: string }>("lookup", "hello");
```

- **Validate every argument.** Native methods are called with data from Discord's page; treat it as untrusted.
- Arguments and results cross IPC, so they must be structured-cloneable (plain objects, arrays, strings, numbers).
- Keep native code minimal and put the logic in a shared pure file (Inline Translate's `translate.ts` is imported by both sides).
- A native plugin is marked **full access** in the store and needs an explicit confirmation to install. Only add `native.ts` when you must.

## 11. Storage

- **Small data**: `ctx.settings`. A key that isn't in the schema is stored but not shown in the settings UI (Snippets keeps its list this way).
- **Larger data**: IndexedDB with a database named `evi-<plugin-id>`. Discord removes `window.localStorage`. Throttle writes and flush on stop.
- **Files**: through `native.ts`, under `ctx.dataDir`.
- Cap anything that grows (per channel, per user) and drop the oldest past the cap.

## 12. Testing

Put the logic in a pure module and test it with `bun test`:

```
plugins/last-seen/track.ts      pure: no Discord, DOM or storage access
tests/lastSeen.test.ts          imports ../plugins/last-seen/track
```

```ts
import { expect, test } from "bun:test";
import { observePresence } from "../plugins/last-seen/track";

test("going offline records the transition", () => {
    const t = new Map();
    observePresence(t, "a", "online", 1000);
    expect(observePresence(t, "a", "offline", 5000)).toBe(true);
    expect(t.get("a")).toEqual({ online: false, seen: 5000 });
});
```

Then check it for real:

1. `bun run typecheck`
2. `bun run test:unit`
3. `bun run dev` with Discord injected (`bun run inject`), turn the plugin on, and use it.
4. Check the **Patches** tab: every patch should be `applied` (or `waiting` until its screen is opened).
5. Turn the plugin off and on again, and edit a file while it runs. Everything it added should disappear and come back cleanly.

`test:web` runs plugins against the live discord.com bundle in headless Chrome; see `scripts/test-web.ts` for how official plugins are covered there.

## 13. Publishing to the store

### Your own plugin

Check it first:

```sh
bun run preview-plugin my-plugin --open
```

It builds, runs the checks evi.rest runs on an upload (a missing or malformed `permissions`, an id or name that's Evi's, a version that isn't newer than the store's, invisible characters, a `native.js` the manifest doesn't mention...) and the app's own checks on the store entry it would make, and says what a reviewer would ask about: a site the code contacts that `network` doesn't list, message events or stores without `readMessages`, no changelog entry for this version. It also writes `dist/preview/my-plugin.html`, the plugin's store page as people would see it, with what it asks for and what its code can reach. It exits 1 when an upload would be refused, so it can run in CI. `--offline` skips comparing with the store's version, `--no-build` uses what's already in `dist/`.

Then upload `manifest.json` and `index.js` (and `native.js`) from `dist/plugins/my-plugin/` on your dashboard on evi.rest. Evi's team reads every version before it goes in.

### Betas, notes and numbers

- **Betas.** Once a plugin is in the store, upload a newer version with the **Beta** channel. After review it's published next to the stable version: only people who turn on *Get beta versions* on its store page get it. A stable version at or above the beta's replaces it. Give betas prerelease versions like `1.2.0-beta.1`.
- **A note on a version.** Your dashboard's analytics has a note per version ("Known issue with voice, fix in 1.2.1"). It shows on the plugin's store page, under *From the author*.
- **Numbers.** Your dashboard shows installs, active installs and the crash rate per version for the last 30 days. They come from Evi's anonymous daily check-in: plugin ids, versions and Evi's version, nothing about people. People can turn it off, so they're a floor, not a census.
- **Reviews** of your plugins land in your inbox, on the dashboard and in Evi. You can't review your own.

### Official plugins

```sh
bun run build
bun scripts/registry.ts --only my-plugin
```

This copies the built plugin into `store/plugins/my-plugin/` and adds it to `registry.json` with sha256 hashes. Name, description, authors, version, tags and the rest come from the manifest. Commit `store/` and `registry.json` together: the hashes only match files from the same run. Bump `version` and add a `changelog` entry for every release, or installed copies won't be offered the update.

Store installs are limited to `manifest.json`, `index.js` and `native.js`, so everything else must be bundled into those.

## 14. Rules and pitfalls

- **Everything through `ctx`.** A hook, listener, timer, style or DOM node that isn't registered through `ctx` (or `ctx.onDispose`) survives turning the plugin off.
- **Hooks over patches.** A hook on an export survives updates; a patch on minified code doesn't.
- **Never let your code break Discord.** Wrap patch callbacks and render code in `try/catch`, fall back to Discord's own behaviour, and log with `ctx.logger`.
- **Expect things to be missing.** A finder can return undefined, a component can be renamed, a menu's props can be `{}`. Check and degrade gracefully.
- **Don't use `find` at module top level** for anything lazy; use a `*Lazy` finder or `ctx.waitFor`.
- **No `fetch` to outside hosts** from the renderer; it's blocked. Use `native.ts`.
- **No `eval` or `new Function`.** The plugin's permissions report flags dynamic code, and users see it.
- **Only request what you need.** Declare it in `permissions` (§2): the store shows it, and Evi blocks the rest. The Plugins tab and the store also show what each plugin can touch (network, clipboard, patches, hooks, native...), read from its code.
- **Keep it fast.** Hooks on hot paths (message rendering, store getters) run constantly: do the cheap check first and bail out.
- **Respect privacy.** Keep data on the device unless the plugin's purpose is to send it somewhere, and say so in the description.

## 15. Generating a plugin with Claude

Claude Code can write a plugin end to end in this repo. Give it the idea and point it at this guide:

```
Read docs/plugins.md, then write a new official plugin in plugins/<id>/ that <what it should do>.
Look at plugins/silent-typing and plugins/last-seen for the house style. Put the logic in a pure
file with tests in tests/, prefer export hooks over source patches, and run bun run typecheck and
bun test when done.
```

A good brief says:

- **What the user sees**: where it shows up (message menu, chat bar, profile, settings) and what happens.
- **Settings**: what should be configurable and the defaults.
- **Anything external**: an API it calls (this means `native.ts`), data it keeps and for how long.

What to expect back, and what to check:

- `manifest.json`, `index.tsx`, and a pure logic file with a test.
- A header comment in `index.tsx` explaining how it hooks into Discord, and a comment above each patch describing the code it matches.
- Source patches are the part most likely to be wrong, because they depend on Discord's current minified code. Paste each one into the Patch Helper, or check the Patches tab after `bun run dev`, before trusting it.
- Try the plugin in Discord, then turn it off and back on to confirm it cleans up.

## 16. DevTools and API changes

Evi's **DevTools** tab (Advanced) is for plugin authors: a live Flux log with every action as a tree, Discord's stores and what their getters return, how often your patched code calls into your plugin through `$self`, the plugins taking the most time, and a searchable reference of `@evi/api` and `ctx`. Patch Helper shows the same reference when you hover a name in its code. The reference is generated from Evi's source with `bun scripts/api-docs.ts` (into `src/shared/apiDocs.json`), and a test fails when it's out of date.

The plugin API's changes, version by version, are in [`src/shared/apiChangelog.ts`](../src/shared/apiChangelog.ts) and on evi.rest. DevTools shows them under *What's new in the API*.
