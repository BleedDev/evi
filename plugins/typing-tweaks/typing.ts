import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Typing Tweaks, kept free of Discord so they can be tested.
 *
 * TypingStore.getTypingUsers(channelId) is { userId: timeout } in the order they started typing, you
 * included (TYPING_START_LOCAL adds you). Discord's "is typing" line lists the same people, minus you,
 * people you've blocked or ignored, and users it doesn't know, in that order, and formats their names
 * with the i18n strings for one, two or three typers, each name its own bold element.
 */

/** Who's typing in a channel, in the order Discord names them */
export function typerIds(
    typing: Record<string, unknown> | undefined,
    selfId: string | undefined,
    hidden: (id: string) => boolean,
    known: (id: string) => boolean = () => true,
): string[] {
    return Object.keys(typing ?? {}).filter(id => id !== selfId && !hidden(id) && known(id));
}

/** Discord names up to three typers; past that it's "Several people are typing" */
export const MAX_NAMED = 3;

/** Indexes of the names in Discord's formatted line: every part that isn't plain text */
export function nameSlots(parts: readonly unknown[]): number[] {
    const slots: number[] = [];
    parts.forEach((part, i) => {
        if (part !== null && typeof part === "object") slots.push(i);
    });
    return slots;
}

/** The dots' tooltip on a channel: "Ada is typing", "Ada and Bo are typing", "Ada, Bo and 3 others are typing" */
export function typingLabel(names: string[]): string {
    if (!names.length) return "";
    if (names.length === 1) return `${names[0]} is typing`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
    if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing`;
}

export const PATCHES = {
    /**
     * The "is typing" line above the chat box (checked 2026-09-28). The visible text is `b`, the same
     * text measured in a hidden span is `N`; Discord swaps `b` for "Multiple people are typing" when
     * the names don't fit:
     *     (0,n.jsx)("span",{className:q.Qq,"aria-hidden":!0,children:b}),(0,n.jsx)("span",{className:q.Qq,style:{position:"absolute",visibility:"hidden"},"aria-hidden":!0,ref:f,children:N})
     * The span is in the component's own body, so arguments[0] is its props: { typingUsers, channel, guildId }.
     * The line screen readers get is another span, left alone.
     */
    typingLine: {
        find: "Q8lUnE,{})",
        replace: {
            match: /(?<="aria-hidden":!0,children:)(\i)(?=\}\),\(0,\i\.jsx\)\("span",\{className:\i\.\i,style:\{position:"absolute",visibility:"hidden"\},"aria-hidden":!0,ref:\i,children:(\i)\}\))/,
            with: "$self?.renderTypingText?.($1,$1===$2,arguments[0])??$1",
        },
    },
    /**
     * A channel in the server's channel list: text, voice, stage and announcement channels all use it.
     *     (0,s.jsx)(Z,{textVariant:"text-md/medium",channel:l,name:null!=a?a:eu})}),t.Children.count(F)>0?(0,s.jsx)("div",{...children:F}):null
     * The dots go between the name and the badges and buttons after it.
     */
    channel: {
        find: 'textVariant:"text-md/medium",channel:',
        replace: {
            match: /(?<=\(\i,\{textVariant:"text-md\/medium",channel:(\i),name:null!=\i\?\i:\i\}\)\}\),)(?=\i\.Children\.count\()/,
            with: "$self?.renderIndicator?.($1,\"channel\"),",
        },
    },
    /**
     * A thread under its channel, which isn't a channel row:
     *     (0,s.jsxs)("div",{className:n$.Y_,onClick:nD.dG,onKeyDown:nD.dG,children:[(0,s.jsx)(lK,{thread:t,countInVoice:_,...
     */
    thread: {
        find: "__invalid_threadMainContent",
        replace: {
            match: /(?<=children:\[)(?=\(0,\i\.jsx\)\(\i,\{thread:(\i),countInVoice:)/,
            with: "$self?.renderIndicator?.($1,\"channel\"),",
        },
    },
    /**
     * A DM or group DM in the DM list: first on its right side, before the close button (checked
     * 2026-10-28). It starts with an ongoing call's icon, when there is one, whose className is
     * now an object of its own:
     *     (0,i.jsxs)("div",{className:s()(eP._q,{[eP.EY]:eJ}),children:[null!=eZ&&(0,i.jsx)(eg,{callMessageId:eZ,className:s()(eP.R4,{[eP.jd]:eJ,...})}),e$?(0,i.jsx)(eB,{}):eK?(0,i.jsx)(eF,{}):ej?(0,i.jsx)(ek,{}):null,...
     * It's inside a render-prop arrow function, so arguments[0] is still the row's props.
     */
    dm: {
        find: "PrivateChannel.renderAvatar",
        replace: {
            match: /(?<=\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i\.\i,\{\[\i\.\i\]:\i\}\),children:\[)(?=(?:null!=\i&&\(0,\i\.jsx\)\(\i,\{callMessageId:[^;]{0,300}?\}\),)?\i\?\(0,\i\.jsx\)\(\i,\{\}\):\i\?\(0,\i\.jsx\)\(\i,\{\}\):\i\?\(0,\i\.jsx\)\(\i,\{\}\):null,)/,
            with: "$self?.renderIndicator?.(arguments[0]?.channel,\"dm\"),",
        },
    },
} satisfies Record<string, SourcePatch>;
