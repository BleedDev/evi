/**
 * Discord's typing dots (the chat's "is typing" line, avatars in the DM and member lists, thread
 * rows) are three SVG circles whose radius and opacity react-spring rewrites every frame, forever,
 * while Discord is focused. Each frame restyles and relayouts the page: four indicators kept the
 * main thread ~900ms/s busy in a 7000-element page. The same dots as HTML in a foreignObject,
 * animated with CSS scale and opacity, run on the compositor: ~1ms/s.
 *
 * Only the dots move to CSS. The spring that slides them in from the middle and fades them in and
 * out still runs, it's short. Same size, color, spacing and timing as Discord's; like Discord's,
 * they stand still while it isn't focused, and like Discord's own CSS dots, reduced motion slows them.
 */
import type { ComponentType } from "react";

import type { SourcePatch } from "./patching/source";
import { CORE_PATCH_SLOTS, registerPatches } from "./patching/source";
import { createStyle } from "./styles";

/** What react-spring's interpolations need: `dotPosition.to([0, 1], [from, to])` */
interface SpringValue { to(input: number[], output: number[]): unknown; }

export interface TypingDotsProps {
    dotRadius: number;
    /** 0 to 1 while the dots slide in from the middle or out to it */
    dotPosition?: SpringValue;
    focused: boolean;
    /** react-spring's `animated`, from Discord's module */
    animated?: { div: ComponentType<{ className?: string; style?: Record<string, unknown>; "data-evi-dot"?: number; }>; };
}

/** Discord's spacing between dot centers, in radii */
const SPACING = 2.5;

/**
 * Discord's indicator renders its dots component inside the SVG it sizes for them (7 radii wide, 2
 * high), inside a spring that fades it in and out:
 *     {focused:I}=(0,c.xb)();return(0,d.p)(a,{..._,key:...})((e,a,d)=>{...children:(0,i.jsx)(l.animated.g,
 *     {style:{opacity:c.to(...)},children:(0,i.jsx)(h,{dotRadius:t,dotPosition:c})})},_)})
 * That component is swapped for Evi's, given the focus Discord already read and react-spring. The
 * same dots component also draws into SVG masks elsewhere (as `U`), where HTML can't go: left alone.
 */
export const typingDotsPatch: SourcePatch = {
    find: "dotCycle:2.8}",
    optional: true,
    replace: {
        match: /(\{focused:(\i)\}=\(0,\i\.\i\)\(\);return\(0,\i\.\i\)\([^]*?children:\(0,\i\.jsx\)\((\i)\.animated\.g,[^]*?children:\(0,\i\.jsx\)\()(\i),\{dotRadius:(\i),dotPosition:(\i)\}\)/,
        with: "$1window.Evi?.typingDots??$4,{dotRadius:$5,dotPosition:$6,focused:$2,animated:$3.animated})",
    },
};

const STYLE = `
@keyframes evi-typing-dot { 0%, 20%, 80%, to { opacity: .3; scale: .8; } 40%, 60% { opacity: 1; scale: 1; } }
.evi-typing-dot { animation: evi-typing-dot 1.2s linear infinite; }
.evi-typing-dot[data-evi-dot="0"] { animation-delay: -1.2s; }
.evi-typing-dot[data-evi-dot="1"] { animation-delay: -1.05s; }
.evi-typing-dot[data-evi-dot="2"] { animation-delay: -.9s; }
.reduce-motion .evi-typing-dot { animation-duration: 2.4s; }
.reduce-motion .evi-typing-dot[data-evi-dot="0"] { animation-delay: -2.4s; }
.reduce-motion .evi-typing-dot[data-evi-dot="1"] { animation-delay: -2.1s; }
.reduce-motion .evi-typing-dot[data-evi-dot="2"] { animation-delay: -1.8s; }
`;

/** Where each dot's left edge is: its own place, or the middle of the three while sliding in */
export function dotLeft(radius: number, index: number, position?: SpringValue): unknown {
    const left = radius * SPACING * index;
    const middle = (2 * radius * 3 + radius / 2) / 2 - radius;
    return position ? position.to([0, 1], [middle, left]) : left;
}

/**
 * The dots, for Discord's indicator. The shape is inline so they're right even where Evi's style
 * isn't (a popout window): there they just stand still, like when Discord isn't focused.
 */
export function TypingDots({ dotRadius, dotPosition, focused, animated }: TypingDotsProps) {
    const Dot = (animated?.div ?? "div") as ComponentType<any>;
    const size = 2 * dotRadius;
    return (
        <foreignObject width="100%" height="100%" aria-hidden>
            {[0, 1, 2].map(i => {
                const style: Record<string, unknown> = {
                    position: "absolute", top: 0, left: dotLeft(dotRadius, i, animated && dotPosition), width: size, height: size,
                    borderRadius: "50%", backgroundColor: "currentColor",
                };
                return <Dot key={i} className={focused ? "evi-typing-dot" : undefined} data-evi-dot={i} style={style} />;
            })}
        </foreignObject>
    );
}

let installed = false;
/** From boot, before Discord's modules run */
export function installTypingDots() {
    if (installed) return;
    installed = true;
    createStyle(STYLE, "evi-typing-dots");
    registerPatches("evi", [typingDotsPatch], CORE_PATCH_SLOTS.typingDots);
}
