/**
 * When each layer of a profile effect shows, the way Discord's effect player times them: a layer
 * starts `start` ms in, plays for `duration`, and when it loops waits `loopDelay` between plays.
 */
import type { EffectLayer } from "@shared/collectibles";

/** Which play of a layer is on at `time` ms (0 for the first), or undefined while it's off */
export function layerPlay(layer: Pick<EffectLayer, "start" | "duration" | "loop" | "loopDelay">, time: number): number | undefined {
    if (time < layer.start) return undefined;
    const into = time - layer.start;
    if (!layer.loop) return into < layer.duration ? 0 : undefined;
    const cycle = layer.duration + layer.loopDelay;
    const n = Math.floor(into / cycle);
    return into - n * cycle < layer.duration ? n : undefined;
}
