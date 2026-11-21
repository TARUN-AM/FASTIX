const crypto = require("crypto");

/**
 * Auditable, deterministic Fisher-Yates shuffle (ARCHITECTURE.md section 9.2).
 *
 * Anyone holding the published seed and the canonical input order can re-run
 * this function and reproduce the exact same ordering, so a fan can prove their
 * queue position was not rigged.
 *
 * PRNG: for each step i, take SHA-256(`${seed}:${i}`), read the first 6 bytes
 * (48 bits) as an integer and reduce modulo (i + 1). 48 bits makes modulo bias
 * negligible for any realistic queue size (< 2^20 entries).
 */
function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomIndex(seed, step, upperExclusive) {
  const digest = crypto.createHash("sha256").update(`${seed}:${step}`).digest();
  return digest.readUIntBE(0, 6) % upperExclusive;
}

function deterministicShuffle(items, seed) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }
  if (typeof seed !== "string" || seed.length < 16) {
    throw new TypeError("seed must be a string of at least 16 characters");
  }
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomIndex(seed, i, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateShuffleSeed() {
  return crypto.randomBytes(32).toString("hex");
}

/** Commitment published next to the seed: SHA-256(seed + ":" + ids.join(",")). */
function computeShuffleHash(seed, orderedIds) {
  return sha256Hex(`${seed}:${orderedIds.map(String).join(",")}`);
}

/**
 * Independent verification helper used by the audit endpoint and tests:
 * re-shuffles the canonical (ascending) list and compares with the published order.
 */
function verifyShuffle(canonicalIds, publishedOrder, seed, publishedHash) {
  const expected = deterministicShuffle(canonicalIds.map(String), seed);
  const sameOrder =
    expected.length === publishedOrder.length &&
    expected.every((id, idx) => id === String(publishedOrder[idx]));
  return sameOrder && computeShuffleHash(seed, expected) === publishedHash;
}

module.exports = {
  deterministicShuffle,
  generateShuffleSeed,
  computeShuffleHash,
  verifyShuffle,
};
