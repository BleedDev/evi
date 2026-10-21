import { definePlugin, filters } from "@evi/api";

import { cleanMessage, DEFAULT_PARAMS } from "./clean";
import { t } from "./strings";

export default definePlugin({
    settings: {
        extraParams: {
            type: "string",
            get label() { return t("settings.extraParams"); },
            get description() { return t("settings.extraParams.description"); },
            get placeholder() { return t("settings.extraParams.placeholder"); },
            default: "",
        },
    },

    start(ctx) {
        const clean = (content: string) => {
            if (!content?.includes("http")) return content;
            const extra = ctx.settings.get("extraParams").split(",").map(s => s.trim()).filter(Boolean);
            const params = new Set([...DEFAULT_PARAMS, ...extra]);

            return cleanMessage(content, params);
        };

        // Export hooks: the message actions module is found whenever it loads, and unhooked on stop
        const actions = filters.byProps("sendMessage", "editMessage");

        // sendMessage(channelId, message, ...)
        ctx.hookExport("before", actions, "sendMessage", ({ args }) => {
            if (args[1]?.content) args[1].content = clean(args[1].content);
        });
        // editMessage(channelId, messageId, { content })
        ctx.hookExport("before", actions, "editMessage", ({ args }) => {
            if (args[2]?.content) args[2].content = clean(args[2].content);
        });
    },
});
