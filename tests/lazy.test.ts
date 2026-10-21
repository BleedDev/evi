import { describe, expect, test } from "bun:test";

import { lazy, unlazy } from "../src/renderer/utils/lazy";

class Store {
    constructor(readonly name = "default") { }
    getName() {
        return this.name;
    }
}

describe("lazy values", () => {
    test("a lazy class can be constructed and extended", () => {
        const Lazy = lazy(() => Store);
        const made = new Lazy("made");
        expect(made).toBeInstanceOf(Store);
        expect(made.getName()).toBe("made");
        expect(made).toBeInstanceOf(Lazy);

        class Sub extends Lazy {
            shout() {
                return this.getName().toUpperCase();
            }
        }
        const sub = new Sub("sub");
        expect(sub).toBeInstanceOf(Sub);
        expect(sub).toBeInstanceOf(Store);
        expect(sub.shout()).toBe("SUB");
    });

    test("a lazy object still reads, lists and calls through", () => {
        const fn = lazy(() => Object.assign((x: number) => x * 2, { extra: 1 }));
        expect(fn(2)).toBe(4);
        expect(fn.extra).toBe(1);
        const obj = lazy(() => ({ a: 1, b: 2 }));
        expect(Object.keys(obj)).toEqual(["a", "b"]);
        expect({ ...obj }).toEqual({ a: 1, b: 2 });
        expect(unlazy(obj)).toEqual({ a: 1, b: 2 });
    });
});
