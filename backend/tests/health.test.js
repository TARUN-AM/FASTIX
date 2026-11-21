process.env.NODE_ENV = "test";
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET =
    "test_only_jwt_secret_key_for_fairticket_health_check_suite_123456";
}

const request = require("supertest");
const app = require("../src/app");

describe("FairTicket Backend Health & Error Handling", () => {
  test("GET /api/v1/health returns 200 with standard success shape and database status", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: "ok",
        service: "fairticket-backend",
        time: expect.any(String),
        database: "disconnected",
      },
      error: null,
    });
    expect(Number.isNaN(Date.parse(response.body.data.time))).toBe(false);
  });

  test("Unknown route returns 404 in standard error shape", async () => {
    const response = await request(app).get("/api/v1/unknown-route-check");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      data: null,
      error: {
        code: "NOT_FOUND",
        message: expect.stringContaining("/api/v1/unknown-route-check"),
      },
    });
  });
});
