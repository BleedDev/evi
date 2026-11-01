import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Who Reacted, kept free of Discord so they can be tested.
 *
 * Discord keeps who reacted in MessageReactionsStore: getReactions(channelId, messageId, emoji, limit,
 * type) returns a Map of userId to user, and the first call for a reaction also asks Discord's API for
 * the first `limit` of them (later calls never ask again). That's one request per reaction, and Discord
 * draws every loaded message, not only those on screen: they go through a queue instead (queue.ts),
 * and only for reactions that are on screen.
 */

/** Discord's ReactionType: NORMAL 0, BURST 1 (super reactions), VOTE 2 (poll answers, not reactions) */
export const REACTION_VOTE = 2;

export interface ReactionEmoji {
    id?: string | null;
    name?: string | null;
}

/** One reaction on one message, the way the store keys it */
export const reactionKey = (messageId: string, emoji: ReactionEmoji, type: number) =>
    `${messageId}:${emoji.name ?? ""}:${emoji.id ?? ""}:${type}`;

/** What the pill shows: the count Discord draws next to the emoji */
export const shownCount = (props: { type?: number; count?: number; burst_count?: number; }) =>
    (props.type === 1 ? props.burst_count : props.count) ?? 0;

/**
 * The avatars to draw, in the order the store has them (who reacted first), without people you've
 * blocked, and how many more reacted than are drawn. `count` is Discord's, which blocked people are in.
 */
export function pickReactors<U extends { id: string; }>(users: Iterable<U>, count: number, max: number, hidden: (id: string) => boolean) {
    const shown: U[] = [];
    let known = 0, blocked = 0;
    for (const user of users) {
        known++;
        if (hidden(user.id)) blocked++;
        else if (shown.length < max) shown.push(user);
    }
    // The store can be a reaction ahead of the count for a moment
    return { shown, extra: Math.max(0, Math.max(count, known) - blocked - shown.length) };
}

/** "+12", and "+99+" past that, so a huge count doesn't stretch the pill */
export const extraLabel = (extra: number) => extra > 99 ? "+99+" : `+${extra}`;

/**
 * Discord's action that asks the API for who reacted (checked 2026-11-02), which getReactions calls
 * the first time and never again:
 *     async function O(e){...T.Rsh.POLL_ANSWER_VOTERS(n,i,t)...s.h.dispatch({type:"MESSAGE_REACTION_ADD_USERS",...
 * Hooked to get its promise, which the store drops: that's how the queue hears about a 429.
 */
export const FETCH_REACTORS = ['"MESSAGE_REACTION_ADD_USERS"', ".POLL_ANSWER_VOTERS("];

export const PATCHES = {
    /**
     * The reaction pill (checked 2026-09-28). Its children, after the emoji:
     *     b?null:(0,i.jsx)(E.A,{className:eU.reactionCount,value:e$,color:t,digitWidth:eD}),(0,i.jsx)(z,{count:e$,reactionRef:ep})
     * `z` is the confetti, which draws nothing in place. The avatars go between the count and it.
     * Everything between here and the pill's `function(e)` is an arrow function, so `arguments[0]`
     * is the pill's props: { message, emoji, count, burst_count, type, hideCount, ... }.
     */
    pill: {
        find: ".reactionCount,value:",
        replace: {
            match: /(?=\(0,\i\.jsx\)\(\i,\{count:\i,reactionRef:\i\}\))/,
            with: "$self?.renderUsers?.(arguments[0]),",
        },
    },
} satisfies Record<string, SourcePatch>;
