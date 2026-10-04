import { definePlugin, Dispatcher, filters, find, findAllExports, getStore, showToast } from "@evi/api";

import { Abilities, canDelete, canEdit, canReply, ClickSettings, decide, IGNORE, isDrag, MessageLike, Modifier, parseRowId } from "./rules";
import { t } from "./strings";

/**
 * Double-click your message to edit it, someone else's to reply, Shift+click to delete. A
 * double-click on the words themselves is left alone, so they can still be selected to copy. One
 * listener on the page, no patches: it finds the message row under the click
 * (<li id="chat-messages-<channel>-<message>">), checks what Discord itself would allow with
 * Discord's own rules (rules.ts), and then does it with Discord's own actions:
 *   edit    startEditMessageRecord(channelId, message), what the Edit button calls
 *   reply   CREATE_PENDING_REPLY, then focusing the chat box, what the Reply button does
 *   delete  deleteMessage(channelId, messageId), what Shift+clicking the Delete button does (no confirm)
 */

const settings = {
    doubleClickEdit: {
        type: "boolean",
        get label() { return t("settings.edit"); },
        get description() { return t("settings.edit.description"); },
        default: true,
    },
    editModifier: {
        type: "select",
        get label() { return t("settings.editModifier"); },
        get description() { return t("settings.editModifier.description"); },
        default: "none",
        options: [
            { get label() { return t("settings.editModifier.none"); }, value: "none" },
            { get label() { return t("settings.editModifier.ctrl"); }, value: "ctrl" },
            { get label() { return t("settings.editModifier.alt"); }, value: "alt" },
        ],
    },
    doubleClickReply: {
        type: "boolean",
        get label() { return t("settings.reply"); },
        get description() { return t("settings.reply.description"); },
        default: true,
    },
    replyPing: {
        type: "boolean",
        get label() { return t("settings.replyPing"); },
        get description() { return t("settings.replyPing.description"); },
        default: true,
    },
    shiftClickDelete: {
        type: "boolean",
        get label() { return t("settings.delete"); },
        get description() { return t("settings.delete.description"); },
        default: true,
    },
    deleteOthers: {
        type: "boolean",
        get label() { return t("settings.deleteOthers"); },
        get description() { return t("settings.deleteOthers.description"); },
        default: false,
    },
} as const;

const SEND_MESSAGES = 1n << 11n;
const MANAGE_MESSAGES = 1n << 13n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;

const messageActions = filters.byProps("startEditMessageRecord", "deleteMessage", "sendMessage");

/** ComponentDispatch: the event bus chat boxes listen on. The one with a FOCUS_CHANNEL_TEXT_AREA listener. */
let bus: any;
function componentDispatch() {
    const listening = (d: any) => {
        try {
            return d?.emitter?.listeners?.("FOCUS_CHANNEL_TEXT_AREA")?.length > 0;
        } catch {
            return false;
        }
    };
    if (listening(bus)) return bus;
    const all = findAllExports(filters.byProps("dispatchToLastSubscribed", "emitter")).map(f => f.value);
    bus = all.find(listening) ?? all[0];
    return bus;
}

/**
 * Whether (x, y) is on a letter, not the empty space around the text: double-clicking a word is
 * selecting it to copy. The caret lands between two characters, so both are measured.
 */
function onText(x: number, y: number) {
    const caret = document.caretRangeFromPoint?.(x, y);
    const node = caret?.startContainer;
    if (!caret || !(node instanceof Text)) return false;
    const glyph = document.createRange();
    for (const at of [caret.startOffset - 1, caret.startOffset]) {
        if (at < 0 || at >= node.length) continue;
        glyph.setStart(node, at);
        glyph.setEnd(node, at + 1);
        for (const r of glyph.getClientRects()) {
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
        }
    }
    return false;
}

function abilities(message: MessageLike, channel: any): Abilities {
    const me: string = getStore("UserStore")?.getCurrentUser?.()?.id ?? "";
    const perms = getStore("PermissionStore");
    const inGuild = !!channel?.guild_id;
    const can = (flag: bigint) => !inGuild || !!perms?.can?.(flag, channel);
    const canSend = can(channel?.isThread?.() ? SEND_MESSAGES_IN_THREADS : SEND_MESSAGES);
    return {
        mine: message.author?.id === me,
        edit: canEdit(message, me),
        reply: canReply(message, canSend),
        delete: canDelete(message, me, inGuild && can(MANAGE_MESSAGES)),
    };
}

export default definePlugin({
    settings,

    start(ctx) {
        const read = (): ClickSettings => ({
            doubleClickEdit: ctx.settings.get("doubleClickEdit"),
            editModifier: ctx.settings.get("editModifier") as Modifier,
            doubleClickReply: ctx.settings.get("doubleClickReply"),
            shiftClickDelete: ctx.settings.get("shiftClickDelete"),
            deleteOthers: ctx.settings.get("deleteOthers"),
        });

        // Where the button went down, and whether text was already selected then: a drag selects
        // text, and Shift+click with a selection extends it. Neither is a click action.
        let down: { x: number; y: number; selected: boolean; } | undefined;
        const selection = () => {
            const s = window.getSelection();
            return !!s && !s.isCollapsed && s.toString().length > 0;
        };

        // Every press anywhere in Discord lands here: the selection is only read for a Shift press,
        // the only kind where it matters, so a big selection isn't turned into text on each click
        const onDown = (e: MouseEvent) => {
            if (e.button === 0) down = { x: e.clientX, y: e.clientY, selected: e.shiftKey && selection() };
        };

        const onClick = (e: MouseEvent) => {
            if (e.button !== 0 || !(e.target instanceof Element)) return;
            const kind = e.type === "dblclick" ? "dblclick" : "click";
            // A single click only matters with Shift; a triple click is selecting a paragraph
            if ((kind === "click" && (!e.shiftKey || e.detail > 1)) || e.detail > 2) return;
            if (down && isDrag(down, { x: e.clientX, y: e.clientY })) return;
            if (kind === "click" && down?.selected) return;

            const row = e.target.closest('li[id^="chat-messages-"]');
            const ids = parseRowId(row?.id);
            if (!row || !ids || e.target.closest(IGNORE)) return;
            // The row being edited: clicks belong to the editor
            if (row.querySelector("[contenteditable=true]")) return;
            // Double-clicking a word selects it to copy: only the space around the text replies or edits
            if (kind === "dblclick" && onText(e.clientX, e.clientY)) return;

            const message = getStore("MessageStore")?.getMessage?.(ids.channelId, ids.messageId);
            const channel = getStore("ChannelStore")?.getChannel?.(ids.channelId);
            if (!message || !channel) return;

            const action = decide(
                { kind, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
                read(),
                abilities(message, channel),
            );
            if (!action) return;

            e.preventDefault();
            e.stopPropagation();
            // Double-click selected a word, Shift+click may have started a selection: neither was wanted
            window.getSelection()?.removeAllRanges();

            const actions = find(messageActions);
            if (!actions) return ctx.logger.warn("Discord's message actions weren't found");

            switch (action) {
                case "edit":
                    actions.startEditMessageRecord(ids.channelId, message);
                    break;
                case "reply": {
                    const mine = message.author?.id === getStore("UserStore")?.getCurrentUser?.()?.id;
                    Dispatcher.dispatch({
                        type: "CREATE_PENDING_REPLY",
                        message,
                        channel,
                        shouldMention: ctx.settings.get("replyPing") && !mine,
                        showMentionToggle: !channel.isPrivate?.() && !mine,
                    });
                    componentDispatch()?.dispatch?.("FOCUS_CHANNEL_TEXT_AREA", { channelId: ids.channelId });
                    break;
                }
                case "delete":
                    Promise.resolve(actions.deleteMessage(ids.channelId, ids.messageId)).catch((err: unknown) => {
                        ctx.logger.error("Couldn't delete", err);
                        showToast(t("toast.deleteFailed"), { type: "failure" });
                    });
                    break;
            }
        };

        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("click", onClick);
        document.addEventListener("dblclick", onClick);
        ctx.onDispose(() => {
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("click", onClick);
            document.removeEventListener("dblclick", onClick);
        });
    },
});
