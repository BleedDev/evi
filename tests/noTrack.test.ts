import { describe, expect, test } from "bun:test";

import type { Replacement } from "../src/renderer/patching/source";
import { canonicalizeMatch, matchesFind } from "../src/renderer/patching/source";
import { isTracking } from "../plugins/no-track/native";
import { PATCHES } from "../plugins/no-track/patches";

// Verbatim from Discord's web build (2026-10-02), trimmed to the patched spots
const SOURCES = {
    trackMaker: 'let eg=e=>{let{addBreadcrumb:t,analyticEventConfigs:i,dispatcher:r,TRACK_ACTION_NAME:a}=e,s=function(e,t,n){return new Promise(i=>{r.dispatch({type:a,event:e,properties:t,flush:n?.flush??!1,fingerprint:n?.fingerprint,resolve:i})})};return function(e,r){let a=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};if(null!=n.g.isServerRendering&&!0===n.g.isServerRendering)return Promise.resolve();let l=r??{},o=i[e];if("function"==typeof o&&(o=o(l)??null),null!=o)if("throttlePeriod"in o){let t=[e,...o.throttleKeys(l)].join("_");if(em(t)||"number"==typeof o.throttlePercent&&Math.random()>o.throttlePercent)return Promise.resolve();if(o.deduplicate){let e=eT[t];if(_()(e,l))return Promise.resolve();eT[t]=l}ep[t]=Date.now()+o.throttlePeriod}else if("throttlePercent"in o){if(Math.random()>o.throttlePercent)return Promise.resolve()}else A()(!1,`Unsupported analytics event config: ${o}`);return t?.(e),s(e,r,a)}};',
    handleTrack: "Y.handleTrack=function(e){let{event:t,properties:n,flush:i,fingerprint:l,resolve:o}=e;return s().then(e=>{let{sessionId:s}=e,d={type:t,fingerprint:l,properties:{client_track_timestamp:Date.now(),client_heartbeat_session_id:s,event_sequence_number:++y,...n},resolve:o},c=function(e){if(null!=r)return r;let t=e.fingerprint??a();return null!=t?(0,p.d)(t):null}(d);if(null!=c&&(d.properties.client_uuid=W.generate(c)),K.push(d),K.length>1e4){let e=K.length-1e4;D=H(D,e),K=K.slice(-1e4)}i?h({shouldFlushOnNextTick:!0}):h({shouldFlushOnNextTick:!1})}),!1};",
    submit: "function g(e,t){let n=Date.now(),r=e.map(e=>({...e,properties:{...e.properties,client_send_timestamp:n}}));if(null!=_)return _(r,i);let a={};return F||(V=(0,f.A)(),a[C]=V,F=!0),m.Bo.post({url:t??l,headers:a,body:{token:i,events:r},retries:3,rejectWithError:!1}).then(e=>(a[C]&&(B=e?.headers?.[C]??null),e))}",
    store: 'class q extends T.Ay.Store{static displayName="AnalyticsTrackingStore";',
    metrics: '_flush(){if(this._metrics.length>0){let e=[...this._metrics];r.Bo.post({url:o.Rsh.METRICS_V2,body:{metrics:e,client_info:{built_at:"1790925679146",build_number:"627798"}},retries:1,rejectWithError:!0}).catch(t=>{this._metrics.length+e.length<100&&(this._metrics=[...this._metrics,...e])})}this._metrics=[]}_metrics;_intervalId}',
    sentry: 'window.DiscordSentry=function(){t.Ts({tunnel:"/error-reporting-proxy/web",dsn:"https://fa97a90475514c03a42f80cd36d147c4@sentry.io/140984",autoSessionTracking:!1,environment:window.GLOBAL_ENV.RELEASE_CHANNEL,integrations:[n.L({onerror:!0,onunhandledrejection:!0}),i.F({console:!0,dom:!0,fetch:!0,history:!0,sentry:!0,xhr:!0}),l.S()]});return d}();',
};

// The gateway socket's READY branch, verbatim from the 2026-10-21 build, up to the dispatch
const READY = '"READY"===r){let e,n,d=function(e){let t=Date.now(),{guilds:n,merged_presences:i,merged_members:r,read_state:a,private_channels:s,user_guild_settings:l,user_settings:o,user_settings_proto:d,experiments:c,guild_experiments:u,relationships:_,users:E,...A}=e,h=[],f=[],I=[],p=[],T=[],m=[],g=[],S=[];return n.forEach(e=>{if(e.unavailable)return;let{features:t,...n}=e.properties??{},{threads:i,guild_scheduled_events:r,...a}=e;h.push("partial"===e.data_mode?e.partial_updates.channels:e.channels),f.push("partial"===e.data_mode?e.partial_updates.roles:e.roles),I.push("partial"===e.data_mode?e.partial_updates.emojis:e.emojis),p.push(i),T.push("partial"===e.data_mode?e.partial_updates.stickers:e.stickers),m.push(t),g.push(r),S.push(a,n)}),{presences_size:JSON.stringify(i?.friends??[]).length,users_size:JSON.stringify(E).length,read_states_size:JSON.stringify(a).length,private_channels_size:JSON.stringify(s).length,user_settings_size:JSON.stringify(o??"").length+(d??"").length,experiments_size:JSON.stringify(c??[]).length+JSON.stringify(u??[]).length,user_guild_settings_size:JSON.stringify(l).length,relationships_size:JSON.stringify(_).length,remaining_data_size:JSON.stringify(A??{}).length,guild_channels_size:JSON.stringify(h).length,guild_members_size:JSON.stringify(r??[]).length,guild_presences_size:JSON.stringify(i?.guilds??[]).length,guild_roles_size:JSON.stringify(f).length,guild_emojis_size:JSON.stringify(I).length,guild_threads_size:JSON.stringify(p).length,guild_stickers_size:JSON.stringify(T).length,guild_events_size:JSON.stringify(g).length,guild_features_size:JSON.stringify(m).length,guild_remaining_data_size:JSON.stringify(S).length,size_metrics_duration_ms:Date.now()-t}}(i);';

type AnyPatch = { find: string; replace: Replacement | Replacement[]; };

function replacements(patch: AnyPatch) {
    return ([] as Replacement[]).concat(patch.replace);
}

/** Applies one replacement, checking it matches exactly once */
function apply(r: Replacement, code: string, self = "S") {
    const re = canonicalizeMatch(r.match) as RegExp;
    expect(code.match(new RegExp(re.source, "g"))?.length).toBe(1);
    const next = code.replace(re, (r.with as string).replaceAll("$self", self));
    expect(next).not.toBe(code);
    return next;
}

describe("analytics", () => {
    const [track, handleTrack, submit] = replacements(PATCHES.analytics);
    const module = Object.values(SOURCES).join("");

    test("finds the analytics module only by its store's name", () => {
        expect(matchesFind(module, PATCHES.analytics.find)).toBe(true);
        expect(matchesFind(SOURCES.metrics + SOURCES.sentry, PATCHES.analytics.find)).toBe(false);
        for (const r of replacements(PATCHES.analytics)) apply(r, module);
    });

    test("each replacement matches Discord's own functions once, and the batch match stays inside its function", () => {
        let code = module;
        for (const r of replacements(PATCHES.analytics)) code = apply(r, code);
        expect(code).toContain("return function(e,r){return S?.dropped?.(),Promise.resolve();");
        expect(code).toContain("function g(e,t){return Promise.resolve();let n=Date.now()");

        // A few statements before `let` still match, but never across a brace into another function
        apply(submit, SOURCES.submit.replace("{let n=", "{e=e.slice();let n="));
        const across = SOURCES.submit.replace("function g(e,t){", "function g(e,t){}function h(e){");
        expect(across.match(new RegExp((canonicalizeMatch(submit.match) as RegExp).source, "g"))).toBeNull();
    });

    test("track resolves straight away: no breadcrumb, no dispatch, counted", async () => {
        const code = apply(track, SOURCES.trackMaker);
        let dropped = 0;
        let dispatched = 0;
        let breadcrumbs = 0;
        const eg = new Function("S", `${code} return eg;`)({ dropped: () => dropped++ });
        const trackEvent = eg({ addBreadcrumb: () => breadcrumbs++, analyticEventConfigs: {}, dispatcher: { dispatch: () => dispatched++ }, TRACK_ACTION_NAME: "TRACK" });
        await expect(trackEvent("channel_opened", { channel_id: "1" }, { flush: true })).resolves.toBeUndefined();
        expect({ dropped, dispatched, breadcrumbs }).toEqual({ dropped: 1, dispatched: 0, breadcrumbs: 0 });
    });

    test("a TRACK from elsewhere isn't queued, and whoever waits on it is let go", () => {
        const code = apply(handleTrack, SOURCES.handleTrack);
        let dropped = 0;
        let resolved = 0;
        const Y: any = {};
        new Function("Y", "S", "s", code)(Y, { dropped: () => dropped++ }, () => { throw new Error("queued"); });
        expect(Y.handleTrack({ event: "x", properties: {}, resolve: () => resolved++ })).toBe(false);
        expect(Y.handleTrack({ event: "x", properties: {} })).toBe(false);
        expect({ dropped, resolved }).toEqual({ dropped: 2, resolved: 1 });
    });

    test("batches are never posted, so nothing is retried", async () => {
        const code = apply(submit, SOURCES.submit);
        let posted = 0;
        const g = new Function("m", "_", `${code} return g;`)({ Bo: { post: () => (posted++, Promise.resolve()) } }, null);
        await expect(g([{ type: "x", properties: {} }])).resolves.toBeUndefined();
        expect(posted).toBe(0);
    });
});

describe("metrics", () => {
    test("flushing empties the list without posting", () => {
        expect(matchesFind(SOURCES.metrics, PATCHES.metrics.find)).toBe(true);
        const [r] = replacements(PATCHES.metrics);
        const code = apply(r, SOURCES.metrics);
        let posted = 0;
        const Metrics = new Function("r", "o", `return class{${code};`)({ Bo: { post: () => (posted++, Promise.resolve()) } }, { Rsh: { METRICS_V2: "/metrics/v2" } });
        const metrics = new Metrics();
        metrics._metrics = [{ name: "a" }, { name: "b" }];
        metrics._flush();
        expect(posted).toBe(0);
        expect(metrics._metrics).toEqual([]);
    });
});

describe("sentry", () => {
    test("Sentry starts disabled, without integrations, and DiscordSentry stays", () => {
        expect(matchesFind(SOURCES.sentry, PATCHES.sentry.find)).toBe(true);
        const [r] = replacements(PATCHES.sentry);
        const code = apply(r, SOURCES.sentry);
        let options: any;
        const window: any = { GLOBAL_ENV: { RELEASE_CHANNEL: "stable" } };
        const integration = () => ({});
        new Function("window", "t", "n", "i", "l", "d", code)(window, { Ts: (o: any) => (options = o) }, { L: integration }, { F: integration }, { S: integration }, { captureException() { } });
        expect(options.enabled).toBe(false);
        expect(options.defaultIntegrations).toBe(false);
        expect(options.tunnel).toBe("/error-reporting-proxy/web");
        expect(typeof window.DiscordSentry.captureException).toBe("function");
    });
});

describe("ready size report", () => {
    const [r] = replacements(PATCHES.readySize);
    /** The size report itself, as the function expression the READY branch calls */
    const report = (code: string) => new Function(`return ${code.slice(code.indexOf("function(e){"), code.lastIndexOf("(i);"))}`)() as (ready: unknown) => object;
    const ready = {
        guilds: [{ id: "1", channels: [{ id: "2" }], roles: [] }], merged_presences: { friends: [] }, users: [{ id: "3" }],
        read_state: [], private_channels: [], user_guild_settings: [], relationships: [],
    };

    test("finds only the gateway socket's READY branch", () => {
        expect(matchesFind(READY, PATCHES.readySize.find)).toBe(true);
        expect(matchesFind("ready_guild_remaining_data_size:this.readyProperties.guild_remaining_data_size,", PATCHES.readySize.find)).toBe(false);
        expect(matchesFind(Object.values(SOURCES).join(""), PATCHES.readySize.find)).toBe(false);
        for (const patch of [PATCHES.analytics, PATCHES.metrics, PATCHES.sentry]) expect(matchesFind(READY, patch.find)).toBe(false);
    });

    test("READY isn't stringified for its sizes anymore", () => {
        expect(report(READY)(ready)).toHaveProperty("users_size", JSON.stringify(ready.users).length);
        expect(report(apply(r, READY))(ready)).toEqual({});
    });
});

describe("main process filter", () => {
    test("blocks analytics, metrics and error reports", () => {
        for (const url of [
            "https://discord.com/api/v9/science",
            "https://ptb.discord.com/api/v10/metrics/v2",
            "https://discord.com/error-reporting-proxy/web?sentry_key=x",
            "https://canary.discord.com/error-reporting-proxy/web",
            "https://o64374.ingest.sentry.io/api/146342/envelope/",
            "https://sentry.io/api/140984/store/",
        ]) expect(isTracking(url)).toBe(true);
    });

    test("leaves everything else alone", () => {
        for (const url of [
            "https://discord.com/api/v9/channels/1/messages",
            "https://discord.com/api/v9/users/@me/science-settings",
            "https://cdn.discordapp.com/attachments/1/2/sentry.io.png",
            "https://notsentry.io/api",
            "https://discord.com/app",
            "https://example.com/error-reporting-proxy/web",
        ]) expect(isTracking(url)).toBe(false);
    });
});
