/**
 * The chunks one of Discord's lazy routes loads, read from the source of the module that declares it,
 * plus the route's own module. test-web loads them to get what opening that page would, logged out.
 * Self-contained (no imports, no closures): test-web runs its source in the page.
 *
 * Up to early October 2026 the loader was inline:
 *   createPromise:()=>Promise.all([n.e("1"),…]).then(n.bind(n,466249)),webpackId:466249,name:"Channel"
 * Since then the chat's is a named async function that also starts native markdown:
 *   async function bh(){let e=…,t=await Promise.all([n.e("1"),…]).then(n.bind(n,284055));return await e,t}
 *   …createPromise:bh,webpackId:284055,name:"Channel",…
 * Both load the route's module with .then(n.bind(n,<webpackId>)) after their chunks, so that's what's looked for.
 */
export function routeChunks(source: string, name: string): { module: string; chunkIds: string[]; } | undefined {
    const module = source.match(new RegExp(`webpackId:(\\d+),name:"${name}"[,}]`))?.[1];
    if (!module) return undefined;
    // Several chunks (Promise.all([n.e("1"),n.e("2")])) or a single one (n.e("1"))
    const loads = source.match(new RegExp(`(?:Promise\\.all\\(\\[((?:[\\w$]+\\.e\\("\\d+"\\),?)+)\\]\\)|[\\w$]+\\.e\\(("\\d+")\\))\\.then\\([\\w$]+\\.bind\\([\\w$]+,${module}\\)\\)`));
    if (!loads) return undefined;
    return { module, chunkIds: [...(loads[1] ?? loads[2]).matchAll(/"(\d+)"/g)].map(m => m[1]) };
}
