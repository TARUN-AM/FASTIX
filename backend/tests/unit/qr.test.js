const { generateQrToken, verifyQrToken } = require("../../src/services/qr.service");

const SECRET = "unit_test_qr_secret_at_least_16";
const T0 = 1_800_000_000_000;

describe("QR tokens", () => {
  test("a fresh token verifies and carries no personal data", () => {
    const t = generateQrToken({ onChainTicketId: 7, onChainEventId: 3, now: T0, secret: SECRET });
    expect(t.ttlSeconds).toBe(30);
    const res = verifyQrToken(t.qrPayloadString, { now: T0 + 5000, secret: SECRET });
    expect(res.valid).toBe(true);
    expect(Object.keys(res.payload).sort()).toEqual(["eid", "exp", "iat", "n", "tid"]);
    expect(res.payload.tid).toBe(7);
  });

  test("expires after 30 seconds", () => {
    const t = generateQrToken({ onChainTicketId: 1, onChainEventId: 1, now: T0, secret: SECRET });
    expect(verifyQrToken(t.qrPayloadString, { now: T0 + 30_000, secret: SECRET }).valid).toBe(true);
    const late = verifyQrToken(t.qrPayloadString, { now: T0 + 31_500, secret: SECRET });
    expect(late.valid).toBe(false);
    expect(late.code).toBe("QR_EXPIRED");
  });

  test("tampering with the ticket id is rejected as an invalid signature", () => {
    const t = generateQrToken({ onChainTicketId: 1, onChainEventId: 1, now: T0, secret: SECRET });
    const env = JSON.parse(Buffer.from(t.qrPayloadString, "base64url").toString());
    env.payload = env.payload.replace('"tid":1', '"tid":2');
    const forged = Buffer.from(JSON.stringify(env)).toString("base64url");
    expect(verifyQrToken(forged, { now: T0, secret: SECRET }).code).toBe("QR_INVALID_SIGNATURE");
  });

  test("a token signed with a different secret is rejected", () => {
    const t = generateQrToken({ onChainTicketId: 1, onChainEventId: 1, now: T0, secret: "other_secret_value_12345" });
    expect(verifyQrToken(t.qrPayloadString, { now: T0, secret: SECRET }).code).toBe("QR_INVALID_SIGNATURE");
  });

  test("garbage input never throws", () => {
    for (const junk of ["", "%%%", "e30", null, undefined, 42]) {
      expect(verifyQrToken(junk, { now: T0, secret: SECRET }).valid).toBe(false);
    }
  });

  test("two tokens for the same ticket differ (nonce)", () => {
    const a = generateQrToken({ onChainTicketId: 1, onChainEventId: 1, now: T0, secret: SECRET });
    const b = generateQrToken({ onChainTicketId: 1, onChainEventId: 1, now: T0, secret: SECRET });
    expect(a.qrPayloadString).not.toBe(b.qrPayloadString);
  });
});
