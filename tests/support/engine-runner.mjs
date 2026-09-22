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

/**
 * The PHASE 2 fixture body (§12, SIM10). Same reasoning as above: written
 * once, imported by both the in-process case and the fresh-process one.
 *
 * `simulateActivity`'s fixture is left exactly as it was. Phase 0B's E1/E2 pin
 * it against a committed golden file, and a new phase does not get to move a
 * VERIFIED line.
 *
 * @param {{ createSeededRandom: Function, initialState: Function, simulateHunt: Function }} engine
 * @param {{ seed: string, profile: object, plan: object, charges: number, ticks: number }} input
 */
export function runHuntFixture(engine, input) {
  const start = engine.initialState(input.profile, input.plan, input.charges);
  const rng = engine.createSeededRandom(input.seed);
  const step = engine.simulateHunt(start, input.profile, input.plan, input.ticks, rng);

  // The raw stream after the run, so the golden file pins WHERE the generator
  // ended up as well as what the simulation did with it. A change that
  // consumed one extra draw somewhere in the middle would otherwise be
  // invisible whenever it happened not to change a rounded outcome.
  const tail = Array.from({ length: 5 }, () => rng.next());

  return { start, step, tail, drawCount: rng.drawCount };
}
