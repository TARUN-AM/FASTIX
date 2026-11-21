const {
  deterministicShuffle,
  generateShuffleSeed,
  computeShuffleHash,
  verifyShuffle,
} = require("../../src/utils/deterministicShuffle");

const SEED = "a".repeat(64);
const ids = Array.from({ length: 50 }, (_, i) => `entry${String(i).padStart(3, "0")}`);

describe("deterministicShuffle", () => {
  test("same seed + same input always gives the same order", () => {
    expect(deterministicShuffle(ids, SEED)).toEqual(deterministicShuffle(ids, SEED));
  });

  test("output is a permutation (nothing lost or duplicated) and input is not mutated", () => {
    const copy = ids.slice();
    const out = deterministicShuffle(ids, SEED);
    expect(ids).toEqual(copy);
    expect(out.slice().sort()).toEqual(ids.slice().sort());
    expect(out).not.toEqual(ids);
  });

  test("different seeds give different orders", () => {
    expect(deterministicShuffle(ids, SEED)).not.toEqual(deterministicShuffle(ids, "b".repeat(64)));
  });

  test("rejects weak seeds and non-arrays", () => {
    expect(() => deterministicShuffle(ids, "short")).toThrow();
    expect(() => deterministicShuffle("nope", SEED)).toThrow();
  });

  test("verifyShuffle accepts the honest order and rejects a tampered one", () => {
    const order = deterministicShuffle(ids, SEED);
    const hash = computeShuffleHash(SEED, order);
    expect(verifyShuffle(ids, order, SEED, hash)).toBe(true);
    const tampered = order.slice();
    [tampered[0], tampered[1]] = [tampered[1], tampered[0]];
    expect(verifyShuffle(ids, tampered, SEED, hash)).toBe(false);
  });

  test("generateShuffleSeed returns 64 hex chars", () => {
    expect(generateShuffleSeed()).toMatch(/^[0-9a-f]{64}$/);
  });
});
