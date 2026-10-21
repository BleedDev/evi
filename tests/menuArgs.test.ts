import { describe, expect, test } from "bun:test";

import { findMenuArgSites, injectMenuArgs } from "../src/renderer/toolkit/menuArgs";

const rewrite = (code: string) => code.replace(/(?<=[{,])navId:/g, injectMenuArgs as any);

/** Rewrites a factory like Discord's, runs it, and returns its exports */
function run(factory: string) {
    const code = rewrite(factory);
    const fn = (0, eval)(`0,${code}`);
    const module = { exports: {} as any };
    fn(module, module.exports);
    return { code, exports: module.exports };
}

describe("menu args patch", () => {
    test("a function component passes its props to the menu, like the message menu", () => {
        const { exports } = run(`function(e,t){const W=p=>p;
            function tP(e){let{message:m,navId:ni}=e;return W({"data-menu-migrated":!0,navId:ni,onClose:()=>{}})}
            t.open=function(e){return tP({message:e.message,channel:e.channel,navId:"message"})}}`);
        const props = exports.open({ message: { id: "1" }, channel: { id: "2" } });
        expect(props.navId).toBe("message");
        expect(props.eviMenuArgs.message.id).toBe("1");
        expect(props.eviMenuArgs.channel.id).toBe("2");
    });

    test("an arrow inside a function uses the function's arguments", () => {
        const { exports } = run(`function(e,t){t.C=function(e){return [1].map(()=>({navId:"user-context"}))[0]}}`);
        expect(exports.C({ user: 5 }).eviMenuArgs).toEqual({ user: 5 });
    });

    test("destructuring patterns stay untouched", () => {
        const code = `function(e,t){function M(e){let{navId:t,variant:n="flexible"}=e;return t}const f=({navId:a})=>a;function g({navId:b}){return b}t.x=[M,f,g]}`;
        expect(findMenuArgSites(code).size).toBe(0);
        const { exports } = run(code);
        expect(exports.x.map((fn: any) => fn({ navId: "a" }))).toEqual(["a", "a", "a"]);
    });

    test("class fields and module scope get nothing, and still compile", () => {
        const { code, exports } = run(`function(e,t){const W=p=>p;
            class H{onMenu=e=>W({...e,navId:"favorites"});static s=W({navId:"static"})}
            const A=e=>W({navId:"module-arrow"});
            t.h=new H;t.A=A}`);
        expect(code).not.toContain("eviMenuArgs");
        expect(exports.h.onMenu({}).navId).toBe("favorites");
        expect(exports.A().navId).toBe("module-arrow");
    });

    test("strings, templates and regexes with braces don't confuse the scanner", () => {
        const { exports } = run(`function(e,t){const W=p=>p;t.C=function(e){let s="{",r=/[{(]\\}/g,u=\`\${"}"}{\`;
            if(r.test("{}")){}return W({label:s+u,navId:"guild-context"})}}`);
        expect(exports.C({ guild: 1 }).eviMenuArgs).toEqual({ guild: 1 });
    });

    test("the same module rewritten again later, after the last one's analysis was let go, comes out the same", async () => {
        const source = `function(e,t){t.C=function(e){return {navId:"user-context",a:{navId:"x"}}}}`;
        const first = rewrite(source);
        await Promise.resolve();
        rewrite(`function(e,t){t.D=function(e){return {navId:"other"}}}`);
        await Promise.resolve();
        expect(rewrite(source)).toBe(first);
        expect(first.match(/eviMenuArgs/g)?.length).toBe(2);
    });
});
