/**
 * Local development & demo seed script for FairTicket staff accounts
 * (ADMIN, ORGANIZER, GATE_STAFF).
 *
 * Production note: This script intentionally refuses to run when
 * NODE_ENV=production. Production staff accounts should be provisioned through
 * an admin invitation workflow (planned in Prompt 29), never via static seeding.
 */
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const { USER_ROLES } = require("../src/config/constants");
const { connectDB, disconnectDB } = require("../src/config/db");
const User = require("../src/models/User.model");
const { validatePassword } = require("../src/utils/validators");

const BCRYPT_COST = 10;

const DEMO_STAFF_ACCOUNTS = [
  {
    fullName: "FairTicket Demo Admin",
    email: "admin@fairticket.demo",
    phone: "+919000000001",
    role: USER_ROLES.ADMIN,
  },
  {
    fullName: "FairTicket Demo Organizer",
    email: "organizer@fairticket.demo",
    phone: "+919000000002",
    role: USER_ROLES.ORGANIZER,
  },
  {
    fullName: "FairTicket Demo Gate Staff",
    email: "gate@fairticket.demo",
    phone: "+919000000003",
    role: USER_ROLES.GATE_STAFF,
  },
];

function generateStrongDemoPassword() {
  return `FairTicket-${crypto.randomBytes(9).toString("base64url")}9`;
}

async function seedStaff() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[FairTicket seed:staff] Refusing to run in NODE_ENV=production. Use admin invitations for production staff accounts."
    );
    process.exit(1);
  }

  let rawPassword = process.env.SEED_STAFF_PASSWORD;
  let generatedPassword = false;

  if (rawPassword) {
    const check = validatePassword(rawPassword);
    if (!check.valid) {
      console.error(
        `[FairTicket seed:staff] SEED_STAFF_PASSWORD does not meet password policy: ${check.message}`
      );
      process.exit(1);
    }
  } else {
    rawPassword = generateStrongDemoPassword();
    generatedPassword = true;
  }

  await connectDB();

  try {
    const passwordHash = await bcrypt.hash(rawPassword, BCRYPT_COST);
    const results = [];

    for (const account of DEMO_STAFF_ACCOUNTS) {
      const existing = await User.findOne({ email: account.email })
        .select("_id role email")
        .lean();

      if (existing) {
        results.push({
          email: account.email,
          role: existing.role,
          status: "ALREADY EXISTS",
        });
        continue;
      }

      await User.create({
        fullName: account.fullName,
        email: account.email,
        phone: account.phone,
        passwordHash,
        role: account.role,
        phoneVerified: true,
      });

      results.push({
        email: account.email,
        role: account.role,
        status: "CREATED",
      });
    }

    console.log("\nFairTicket Demo Staff Seed Summary");
    console.log("-----------------------------------");
    for (const item of results) {
      console.log(`  [${item.status}] ${item.role.padEnd(10)} ${item.email}`);
    }

    if (generatedPassword && results.some((r) => r.status === "CREATED")) {
      console.log("\nWARNING: Generated one-time password for newly created demo staff accounts.");
      console.log("Save it now — it is not written to disk and will not be shown again:");
      console.log(`  Password: ${rawPassword}\n`);
    } else if (results.every((r) => r.status === "ALREADY EXISTS")) {
      console.log("\nAll demo staff accounts already exist. No records were modified.\n");
    }
  } finally {
    await disconnectDB();
  }
}

if (require.main === module) {
  seedStaff().catch((err) => {
    console.error("[FairTicket seed:staff] Failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  DEMO_STAFF_ACCOUNTS,
  seedStaff,
};
