/**
 * Channels you can't view are listed like any other, with a lock (or muted, with a crossed-out eye).
 * Opening one shows the lock screen (LockScreen.tsx) instead of the chat. Nothing is fetched from
 * a hidden channel: its messages stay out of reach, this only shows what Discord already sends.
 *
 * - Listing: GuildChannelStore keeps hidden channels instead of dropping them, and getChannels
 *   filters them back out (resolveGuildChannels) except where we ask for them with an extra `true`:
 *   the channel list, the guild tooltip and the #channel autocomplete.
 * - The channel list's render levels treat hidden channels like visible ones.
 * - Opening one: the chat, sidebar and header buttons are swapped for the lock screen. Voice and
 *   stage channels show it too instead of connecting. Message fetches and keyboard navigation skip
 *   hidden channels.
 * - The lock screen's allowed users and roles list is Discord's own, captured from its module.
 *
 * Message keys like `.t.IzZTIe` are Discord's hashed intl keys (CHANNEL_TOOLTIP_DIRECTORY here).
 */
import { Components, definePlugin, React } from "@evi/api";

import { lockScreenCss, renderLockScreen, setChannelBeginHeader } from "./LockScreen";
import { settings } from "./settings";
import { canConnect, cssClasses, isHiddenChannel, permissionChanges, Permissions, setContext, setting, store, watchPermissions } from "./shared";
import { t } from "./strings";

const channelListClasses = cssClasses("modeSelected", "modeMuted", "unread", "icon");

const mutedStyle = (channel: any) => setting("showMode") === "muted" && isHiddenChannel(channel);

function LockIcon() {
    return (
        <svg className={channelListClasses().icon} height="18" width="20" viewBox="0 0 24 24" aria-hidden role="img">
            <path fill="currentColor" fillRule="evenodd" d="M17 11V7C17 4.243 14.756 2 12 2C9.242 2 7 4.243 7 7V11C5.897 11 5 11.896 5 13V20C5 21.103 5.897 22 7 22H17C18.103 22 19 21.103 19 20V13C19 11.896 18.103 11 17 11ZM12 18C11.172 18 10.5 17.328 10.5 16.5C10.5 15.672 11.172 15 12 15C12.828 15 13.5 15.672 13.5 16.5C13.5 17.328 12.828 18 12 18ZM15 11H9V7C9 5.346 10.346 4 12 4C13.654 4 15 5.346 15 7V11Z" />
        </svg>
    );
}

function HiddenIcon() {
    const icon = (props: object) => (
        <svg {...props} className={[channelListClasses().icon, "evi-shc-hidden-icon"].filter(Boolean).join(" ")} width="24" height="24" viewBox="0 0 24 24" aria-label={t("hidden.channel")} role="img">
            <path fill="currentColor" fillRule="evenodd" d="m19.8 22.6-4.2-4.15q-.875.275-1.762.413Q12.95 19 12 19q-3.775 0-6.725-2.087Q2.325 14.825 1 11.5q.525-1.325 1.325-2.463Q3.125 7.9 4.15 7L1.4 4.2l1.4-1.4 18.4 18.4ZM12 16q.275 0 .512-.025.238-.025.513-.1l-5.4-5.4q-.075.275-.1.513-.025.237-.025.512 0 1.875 1.312 3.188Q10.125 16 12 16Zm7.3.45-3.175-3.15q.175-.425.275-.862.1-.438.1-.938 0-1.875-1.312-3.188Q13.875 7 12 7q-.5 0-.938.1-.437.1-.862.3L7.65 4.85q1.025-.425 2.1-.638Q10.825 4 12 4q3.775 0 6.725 2.087Q21.675 8.175 23 11.5q-.575 1.475-1.512 2.738Q20.55 15.5 19.3 16.45Zm-4.625-4.6-3-3q.7-.125 1.288.112.587.238 1.012.688.425.45.613 1.038.187.587.087 1.162Z" />
        </svg>
    );
    const Tooltip = Components.Tooltip as any;
    return Tooltip ? <Tooltip text={t("hidden.channel")}>{icon}</Tooltip> : icon({});
}

const isUncategorized = (entry: { channel: any; comparator: number; }) =>
    entry.channel.id === "null" && entry.channel.name === "Uncategorized" && entry.comparator === -1;

/**
 * getChannels without hidden channels, per result of the original. Discord calls it constantly and
 * compares results by reference, so a new copy each time would re-render the channel list every time.
 *
 * A permission change can hide or reveal channels without GuildChannelStore handing out a new
 * object, so each result also remembers the permissions it was made under: a counter bumped on
 * every PermissionStore change, and that server's permission versions. After a change in one
 * server the others still match and are handed back untouched. When a server's do change, its
 * channels are filtered again, and if the same ones come out, the old object is kept.
 */
interface Filtered {
    /** permissionChanges when last checked */
    stamp: number;
    /** The server's permission versions, or undefined when PermissionStore doesn't have them */
    key: string | undefined;
    result: Record<string, any>;
}
const filteredChannels = new WeakMap<object, Filtered>();

/** The server a getChannels result is for */
function guildOf(channels: Record<string, any>): string | undefined {
    if (typeof channels.id === "string") return channels.id;
    for (const entries of Object.values(channels)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const id = entry?.channel?.guild_id;
            if (typeof id === "string") return id;
        }
    }
}

/**
 * PermissionStore's own change counters for a server (its roles and member) and for channel
 * overwrites. Only trusted when it has both.
 */
function permissionKey(guildId: string | undefined): string | undefined {
    const permissions = store("PermissionStore");
    if (!guildId || typeof permissions?.getGuildVersion !== "function" || typeof permissions?.getChannelsVersion !== "function") return;
    return `${permissions.getGuildVersion(guildId)}:${permissions.getChannelsVersion()}`;
}

function filterChannels(channels: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, entries] of Object.entries(channels)) {
        if (!Array.isArray(entries)) {
            result[key] = entries;
            continue;
        }
        result[key] = entries.filter(entry => isUncategorized(entry) || entry.channel.id === null || !isHiddenChannel(entry.channel));
    }
    return result;
}

/** Same lists, entry for entry */
function sameChannels(a: Record<string, any>, b: Record<string, any>): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        const x = a[key], y = b[key];
        if (x === y) continue;
        if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
    return true;
}

const css = `
.evi-shc-hidden-icon { cursor: not-allowed; margin-left: 6px; z-index: 0; }
${lockScreenCss}
`;

export default definePlugin({
    settings,
    css,

    patches: [
        {
            // Render levels decide whether a channel is listed, collapsed in its category, etc.
            find: '"placeholder-channel-id"',
            replace: [
                {
                    // Drop the special case for channels without VIEW_CHANNEL
                    match: /if\(!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL.+?{if\(this\.id===\i\).+?threadIds:\[\]}}/,
                    with: "",
                },
                {
                    // A hidden channel's unread state doesn't affect its render level
                    match: /(?<=&&)(?=!\i\.\i\.hasUnread\(this\.record\.id\))/,
                    with: "$self.isHiddenChannel(this.record)||",
                },
                {
                    // Hidden channels get the same render level as visible ones
                    match: /(this\.record\)\?{renderLevel:(.+?),threadIds.+?renderLevel:).+?(?=,threadIds)/g,
                    with: (_, rest, defaultRenderLevel) => `${rest}${defaultRenderLevel}`,
                },
                {
                    match: /(getRenderLevel\(\i\){.+?return)!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,this\.record\)\|\|/,
                    with: (_, rest) => `${rest} `,
                },
            ],
        },
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            replace: [
                {
                    // No "switch voice channel?" confirmation for a hidden one
                    match: /(?<=getIgnoredUsersForVoiceChannel\((\i)\.id\)[^;]{0,300}?;return\()/,
                    with: (_, channel) => `!$self.isHiddenChannel(${channel})&&`,
                },
                {
                    // Never try to connect to a hidden voice channel
                    match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/,
                    with: (_, channel) => `||$self.isHiddenChannel(${channel})`,
                },
                {
                    // Open the channel (and its lock screen) instead
                    match: /!__OVERLAY__&&\((?<=selectVoiceChannel\((\i)\.id\).+?)/,
                    with: (m, channel) => `${m}$self.isHiddenChannel(${channel},true)||`,
                },
            ],
        },
        {
            // Never try to connect to a hidden stage channel
            find: ".AUDIENCE),{isSubscriptionGated",
            replace: {
                match: /(\i)\.isRoleSubscriptionTemplatePreviewChannel\(\)/,
                with: (m: string, channel: string) => `${m}||$self.isHiddenChannel(${channel})`,
            },
        },
        {
            // No edit or invite buttons on hidden channels. Discord declares these more than once
            find: 'tutorialId:"instant-invite"',
            replace: ["renderEditButton", "renderInviteButton"].map(fn => ({
                match: new RegExp(`(?<=${fn}\\(\\){)`, "g"),
                with: "if($self.isHiddenChannel(this?.props?.channel))return null;",
            })),
        },
        {
            find: "VoiceChannel.renderPopout: There must always be something to render",
            all: true,
            replace: {
                match: /(?<=renderOpenChatButton(?:",|=)\(\)=>{)/,
                with: "if($self.isHiddenChannel(this?.props?.channel))return null;",
            },
        },
        {
            // The channel icon: a lock for hidden channels (CHANNEL_TOOLTIP_DIRECTORY)
            find: ".t.IzZTIe",
            replace: {
                match: /(?<=(\i)\.isNSFW\(\);)switch\(\i\.type\).{0,15}\.GUILD_ANNOUNCEMENT/,
                with: (m: string, channel: string) => `if($self.showLockIcon(${channel}))return $self.LockIcon;${m}`,
            },
        },
        {
            find: "UNREAD_IMPORTANT:",
            replace: [
                {
                    // Muted style for hidden channels
                    match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,muted:(\i).+?;)/,
                    with: (m, channel, muted) => `${m}${muted}=$self.mutedStyle(${channel})?true:${muted};`,
                },
                {
                    // The crossed-out eye after the name
                    match: /\.Children\.count.+?:null(?<=,channel:(\i).+?)/,
                    with: (m, channel) => `${m},$self.mutedStyle(${channel})?$self.HiddenChannelIcon():null`,
                },
            ],
        },
        {
            // Voice channels only get the muted class if they return early, apply it alongside the others.
            // Before the unreads patch below, which changes the same code
            find: "UNREAD_IMPORTANT:",
            predicate: () => setting("showMode") === "muted",
            replace: {
                match: /(?<=\?\i\.\i:\i\.\i,)(.{0,150}?)if\((\i)(?:\)return |\?)(\i\.MUTED)/,
                with: (_: string, otherClasses: string, isMuted: string, mutedClass: string) => `${isMuted}?${mutedClass}:"",${otherClasses}if(${isMuted})return ""`,
            },
        },
        {
            find: "UNREAD_IMPORTANT:",
            replace: [
                {
                    // With unreads kept, a muted-style hidden channel can still show as unread
                    match: /(?<=\.LOCKED;if\()(?<={channel:(\i).+?)/,
                    with: (_, channel) => `!$self.showUnreadWhileMuted(${channel})&&`,
                },
                {
                    match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,.+?unread:(\i).+?)/,
                    with: (m, channel, unread) => `${m}${unread}=$self.hideUnread(${channel})?false:${unread};`,
                },
            ],
        },
        {
            // The unreads bar at the top and bottom of the channel list
            find: '"ChannelListUnreadsStore"',
            replace: {
                match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/,
                with: (_: string, channel: string) => `&&!$self.isHiddenChannel(${channel})`,
            },
        },
        {
            find: "renderBottomUnread(){",
            replace: {
                match: /(?<=!0\))(?=&&\(0,\i\.\i\)\((\i\.record)\))/,
                with: "&&!$self.isHiddenChannel($1)",
            },
        },
        {
            find: "GUILD_EVENT)}),[",
            replace: {
                match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/,
                with: "&&!$self.isHiddenChannel($1)",
            },
        },
        {
            // A hidden channel's page: just the header, the notification button and the lock screen
            find: "Missing channel in Channel.renderHeaderToolbar",
            replace: [
                {
                    match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_TEXT:(?=.+?(\i\.push.{0,50}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/,
                    with: (m, pushNotifications, channel, isLurking) => `${m}if(!${isLurking}&&$self.isHiddenChannel(${channel})){${pushNotifications};break;}`,
                },
                {
                    match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_MEDIA:(?=.+?(\i\.push.{0,40}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/,
                    with: (m, pushNotifications, channel, isLurking) => `${m}if(!${isLurking}&&$self.isHiddenChannel(${channel})){${pushNotifications};break;}`,
                },
                {
                    match: /renderMobileToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_DIRECTORY:(?<=let{channel:(\i).+?)/,
                    with: (m, channel) => `${m}if($self.isHiddenChannel(${channel}))break;`,
                },
                {
                    match: /(?<=renderHeaderBar(?:",|=)\(\)=>{.+?hideSearch:(\i)\.isDirectory\(\))/,
                    with: (_, channel) => `||$self.isHiddenChannel(${channel})`,
                },
                {
                    match: /(?<=renderSidebar\(\){)/,
                    with: "if($self.isHiddenChannel(this?.props?.channel))return null;",
                },
                {
                    match: /(?<=renderChat\(\){)/,
                    with: "if($self.isHiddenChannel(this?.props?.channel))return $self.HiddenChannelLockScreen(this?.props?.channel);",
                },
            ],
        },
        {
            // Don't ask for a hidden channel's messages
            find: '"MessageManager"',
            replace: {
                match: /forceFetch:\i,isPreload:.+?}=\i;(?=.+?getChannel\((\i)\))/,
                with: (m: string, channelId: string) => `${m}if($self.isHiddenChannel({channelId:${channelId}}))return;`,
            },
        },
        {
            // Alt+Shift+Up/Down (next unread) skips hidden channels
            find: '"alt+shift+down"',
            replace: {
                match: /(?<=getChannel\(\i\);return null!=(\i))(?=.{0,200}?>0\)&&\(0,\i\.\i\)\(\i\))/,
                with: (_: string, channel: string) => `&&!$self.isHiddenChannel(${channel})`,
            },
        },
        {
            // Alt+Up/Down (next channel) skips hidden channels
            find: ".APPLICATION_STORE&&null!=",
            replace: {
                match: /getState\(\)\.channelId.+?(?=\.map\(\i=>\i\.id)/,
                with: "$&.filter(e=>!$self.isHiddenChannel(e))",
            },
        },
        {
            // The allowed users and roles list (ROLE_REQUIRED_SINGLE_USER_MESSAGE)
            find: ".t.rt0ERW",
            replace: [
                {
                    // Roles need CONNECT, not VIEW_CHANNEL, on a locked voice channel
                    match: /(forceRoles:.+?)(\i\.\i\(\i\.\i\.ADMINISTRATOR,\i\.\i\.VIEW_CHANNEL\))(?<=context:(\i)}.+?)/,
                    with: (_, rest, mergedPermissions, channel) => `${rest}$self.swapViewChannelWithConnectPermission(${mergedPermissions},${channel})`,
                },
                {
                    // Same for permission overwrites
                    match: /permissionOverwrites\[.+?\i=(?<=context:(\i)}.+?)(?=(.+?)VIEW_CHANNEL)/,
                    with: (m, channel, permCheck) => `${m}!$self.canConnect(${channel})?${permCheck}CONNECT):`,
                },
                {
                    // Include @everyone in the allowed roles of a hidden channel
                    match: /getSortedRoles.+?\.filter\(\i=>(?=!)/,
                    with: m => `${m}$self.isHiddenChannel(arguments[0]?.channel)?true:`,
                },
                {
                    // If @everyone is allowed, it's the only role worth listing
                    match: /forceRoles:.+?.value\(\)(?<=channel:(\i).+?)/,
                    with: (m, channel) => `${m}.reduce(...$self.makeAllowedRolesReduce(${channel}.guild_id))`,
                },
                {
                    // On hidden and locked channels (the lock screen), render only the allowed users and roles
                    match: /return\(0,\i\.jsxs?\)\(\i\.\i,{channelId:(\i)\.id,children:\[(?=.{0,1000}?(\(0,\i\.jsxs?\)\("div",{className:\i\.\i,children:\[.{0,100}\i\.length>0.+?\]}\)),)/,
                    with: (m, channel, allowedUsersAndRoles) => `if($self.isHiddenChannel(${channel},true)){return${allowedUsersAndRoles};}${m}`,
                },
                {
                    // Pass the channel on to the users component, patched below
                    match: /maxUsers:\d+?,users:\i(?<=channel:(\i).+?)/,
                    with: (m, channel) => `${m},shcChannel:${channel}`,
                },
                {
                    // Always use the component for several users
                    match: /1!==\i\.length(?=\|\|)/,
                    with: "true",
                },
            ],
        },
        {
            find: '="interactive-text-default",overflowCountClassName:',
            replace: [
                {
                    match: /let{users:\i,maxUsers:\i,/,
                    with: "let{shcChannel}=arguments[0];$&",
                },
                {
                    // Always show the + button on the lock screen
                    match: /\i>0(?=&&!\i&&!\i)/,
                    with: m => `($self.isHiddenChannel(typeof shcChannel!=="undefined"?shcChannel:void 0,true)?true:${m})`,
                },
                {
                    // Just "+" without a count when nothing overflows, on the lock screen
                    match: /(?<=`\+\$\{)\i(?=\})/,
                    with: overflow => `$self.isHiddenChannel(typeof shcChannel!=="undefined"?shcChannel:void 0,true)&&(${overflow}-1)<=0?"":${overflow}`,
                },
            ],
        },
        {
            // No open chat button on a voice channel's lock screen (CHANNEL_CALL_CURRENT_SPEAKER)
            find: ".t.JjdizN",
            replace: {
                match: /(?<=&&)\i\.push\(.{0,120}"chat-spacer"/,
                with: "(arguments[0]?.inCall||!$self.isHiddenChannel(arguments[0]?.channel,true))&&$&",
            },
        },
        {
            // Voice channels (EMBEDDED_ACTIVITIES_DEVELOPER_ACTIVITY_SHELF_FETCH_ERROR)
            find: '.t["AlJyI+"]',
            replace: [
                {
                    // The lock screen instead of the call
                    match: /renderContent\(\i\){.+?this\.renderVoiceChannelEffects.+?children:/,
                    with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?$self.HiddenChannelLockScreen(this?.props?.channel):",
                },
                {
                    match: /renderContent\(\i\){.+?disableGradients:/,
                    with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)||",
                },
                {
                    // None of the call controls
                    match: /(?:{|,)render(?!Header|ExternalHeader).{0,30}?:/g,
                    with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?()=>null:",
                },
                {
                    // A class that breaks the lock screen's layout
                    match: /(?=\i\|\|\i!==\i\.\i\.FULL_SCREEN.{0,100}?this\._callContainerRef)/,
                    with: '$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?"":',
                },
            ],
        },
        {
            // Stage channels
            find: ".STAGE_CHANNEL_CALL)",
            replace: [
                {
                    match: /screenMessage:(\i)\?.+?children:(?=!\1)(?<=let \i,{channel:(\i).+?)/,
                    with: (m, _isPopoutOpen, channel) => `${m}$self.isHiddenChannel(${channel})?$self.HiddenChannelLockScreen(${channel}):`,
                },
                {
                    // Arrow functions, or a function that returns (renderChatToasts)
                    match: /render(?:BottomLeft|BottomCenter|BottomRight|ChatToasts):(?:\(\)=>|function\(\){return)(?<=let \i,{channel:(\i).+?)/g,
                    with: (m, channel) => `${m} $self.isHiddenChannel(${channel})?null:`,
                },
                {
                    match: /"124px".+?disableGradients:(?<=let \i,{channel:(\i).+?)/,
                    with: (m, channel) => `${m}$self.isHiddenChannel(${channel})||`,
                },
                {
                    match: /"124px".+?style:(?<=let \i,{channel:(\i).+?)/,
                    with: (m, channel) => `${m}$self.isHiddenChannel(${channel})?void 0:`,
                },
            ],
        },
        {
            // Stage channel header
            find: "numRequestToSpeak:",
            replace: [
                {
                    // No divider and listener count on the lock screen
                    match: /(?<={channel:(\i),toggleRequestToSpeakSidebar:.+?)\(0,\i\.jsx\)\(\i\.\i\.Divider.+?}\)]}\)/,
                    with: (m, channel) => `...$self.isHiddenChannel(${channel})?[]:[${m}]`,
                },
                {
                    match: /(?<=numRequestToSpeak:\i\}\)\}\):null,!\i&&)\(0,\i\.jsxs?\).{0,280}?iconClassName:/,
                    with: "!$self.isHiddenChannel(arguments[0]?.channel,true)&&$&",
                },
            ],
        },
        {
            // #channel autocomplete in the chat bar lists hidden channels too
            find: ",queryStaticRouteChannels(",
            replace: [
                {
                    match: /(?<=queryChannels\(\i\){.+?getChannels\(\i)(?=\))/,
                    with: ",true",
                },
                {
                    match: /(?<=queryChannels\(\i\){.+?\)\((\i)\.type\))(?=&&!\i\.\i\.can\()/,
                    with: "&&!$self.isHiddenChannel($1)",
                },
            ],
        },
        {
            // Mentions of hidden channels are clickable
            find: '"^/guild-stages/(\\\\d+)(?:/)?(\\\\d+)?"',
            replace: {
                match: /\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,\i\)/,
                with: "true",
            },
        },
        {
            // Clicking a hidden voice channel's mention opens it instead of joining
            find: 'getConfig({location:"channel_mention"})',
            replace: {
                match: /(?<=getChannel\(\i\);if\(null!=(\i)).{0,200}?return void (?=\i\.default\.selectVoiceChannel)/,
                with: (m: string, channel: string) => `${m}!$self.isHiddenChannel(${channel})&&`,
            },
        },
        {
            find: '"GuildChannelStore"',
            replace: [
                {
                    // Keep hidden channels in the store
                    match: /isChannelGated\(.+?\)(?=&&)/,
                    with: m => `${m}&&false`,
                },
                {
                    // getChannels leaves them out unless asked with an extra `true`
                    match: /(?<=getChannels\(\i)(\){.*?)return (.+?)}/,
                    with: (_, rest, channels) => `,shouldIncludeHidden${rest}return $self.resolveGuildChannels(${channels},shouldIncludeHidden??arguments[0]==="@favorites");}`,
                },
            ],
        },
        {
            find: "GuildTooltip - ",
            replace: {
                match: /(?<=getChannels\(\i)(?=\))/,
                with: ",true",
            },
        },
        {
            // Active Now shows people in hidden voice channels
            find: '"NowPlayingViewStore"',
            replace: {
                match: /(getVoiceStateForUser.{0,150}?)&&\i\.\i\.canWithPartialContext.{0,20}VIEW_CHANNEL.+?}\)(?=\?)/,
                with: "$1",
            },
        },
        {
            // Capture Discord's allowed users and roles component for the lock screen
            find: ".t.rt0ERW",
            replace: {
                match: /(?=function (\i)\(\i\){let{channel:.{0,200}?getSortedRoles\()/,
                with: "$self.ChannelBeginHeader=$1;",
            },
        },
        {
            // Discord's experiment that scrambles hidden channels' data
            find: "2026-02-private-channel-hiding",
            replace: {
                match: /(?<=enableObfuscation|enableIntegrityCheck):!0/g,
                with: ":false",
            },
        },
    ],

    set ChannelBeginHeader(component: any) {
        setChannelBeginHeader(component);
    },

    isHiddenChannel,
    mutedStyle,

    showLockIcon: (channel: any) => setting("showMode") === "lock" && isHiddenChannel(channel),
    hideUnread: (channel: any) => setting("hideUnreads") && isHiddenChannel(channel),
    showUnreadWhileMuted: (channel: any) => !setting("hideUnreads") && mutedStyle(channel),
    canConnect,

    swapViewChannelWithConnectPermission(mergedPermissions: bigint, channel: any) {
        if (!canConnect(channel)) {
            mergedPermissions &= ~Permissions.VIEW_CHANNEL;
            mergedPermissions |= Permissions.CONNECT;
        }
        return mergedPermissions;
    },

    resolveGuildChannels(channels: Record<string, any>, includeHidden: boolean) {
        if (includeHidden || !channels || typeof channels !== "object") return channels;
        const cached = filteredChannels.get(channels);
        const stamp = permissionChanges();
        if (cached?.stamp === stamp) return cached.result;
        const key = permissionKey(guildOf(channels));
        if (cached && key !== undefined && cached.key === key) {
            cached.stamp = stamp;
            return cached.result;
        }
        const fresh = filterChannels(channels);
        const result = cached && sameChannels(cached.result, fresh) ? cached.result : fresh;
        filteredChannels.set(channels, { stamp, key, result });
        return result;
    },

    makeAllowedRolesReduce(guildId: string) {
        return [
            (prev: any[], _role: any, index: number, roles: any[]) => {
                if (index !== 0) return prev;
                const everyone = roles.find(role => role.id === guildId);
                return everyone ? [everyone] : roles;
            },
            [] as any[],
        ];
    },

    HiddenChannelLockScreen: renderLockScreen,
    LockIcon,
    HiddenChannelIcon: () => <HiddenIcon />,

    start(ctx) {
        setContext(ctx);
        // A permission change can hide or reveal channels without GuildChannelStore handing out a new
        // object: cached results are checked again (see filteredChannels and isHiddenChannel)
        ctx.onDispose(watchPermissions());
    },

    stop() {
        setContext(undefined);
    },
});
