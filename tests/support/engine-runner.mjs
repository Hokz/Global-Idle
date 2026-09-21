/**
 * The engine fixture body, written ONCE (§14.10, E1 and E2).
 *
 * Plain ESM rather than TypeScript because the restart case has to import it
 * from a brand-new node process, which has no transpiler. Copying these ten
 * lines into the child script instead would mean the fixture proves two copies
 * agree rather than that the engine is deterministic.
 */

/**
 * @param {{ createSeededRandom: Function, simulateActivity: Function }} engine
 * @param {{ seed: string, state: object, party: object[], content: object, elapsedMs: number }} input
 */
export function runFixture(engine, input) {
  const rng = engine.createSeededRandom(input.seed);
  const result = engine.simulateActivity(
    input.state,
    input.party,
    input.content,
    input.elapsedMs,
    rng,
  );

  // The RAW stream as well as the result, so the golden file pins the
  // ALGORITHM and not only the shape of what uses it.
  const floats = Array.from({ length: 5 }, () => rng.next());
  const ints = Array.from({ length: 5 }, () => rng.nextInt(6));
  const picks = Array.from({ length: 5 }, () => rng.pick(['a', 'b', 'c', 'd']));

  return { result, floats, ints, picks, drawCount: rng.drawCount };
}

/** Byte-identical comparison needs ONE serialisation, used on both sides. */
export function canonicalJson(value) {
  return JSON.stringify(value, null, 2);
}
