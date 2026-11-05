/**
 * The epoch a stream boundary belongs to (M4): the server generation plus the generation of the Pi
 * instance that produced the events. A boundary from an older instance cannot describe a newer one,
 * so the reader is told to resync instead of being fed a mixed history.
 */
export function epochOf(params: { serverEpoch: number; instanceGeneration: number }): string {
  return `${params.serverEpoch}:${params.instanceGeneration}`;
}
