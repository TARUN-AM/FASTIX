const { connectDB, disconnectDB } = require("../src/config/db");
const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const {
  VERIFICATION_TYPES,
  VERIFICATION_STATUSES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
} = require("../src/config/constants");
const { normalizeEmail } = require("../src/utils/normalize");
const { maskAddress } = require("../src/utils/maskAddress");
const { logSecurityEvent } = require("../src/services/securityLog.service");

/**
 * Local development helper to unlink a MetaMask wallet from a test user account
 * so developers can re-test wallet linking without manually editing MongoDB.
 *
 * PRODUCTION NOTE:
 * This script intentionally refuses to run when NODE_ENV === "production".
 * A production wallet-change feature requires a formal support workflow with
 * identity re-verification, mandatory waiting periods, revocation of prior
 * on-chain wallet bindings, and blocking unlinking while the user holds any
 * active tickets, pending bookings, or open resale listings.
 */
async function devUnlinkWallet(emailInput) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "devUnlinkWallet is a local development tool and refuses to run when NODE_ENV=production."
    );
  }

  if (typeof emailInput !== "string" || !emailInput.trim()) {
    throw new Error("A user email address is required (e.g. npm run dev:unlink-wallet -- user@example.com).");
  }

  const email = normalizeEmail(emailInput);
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error(`No user account found with email "${email}".`);
  }

  const previousWallet = user.walletAddress || null;
  const maskedAddress = previousWallet ? maskAddress(previousWallet) : null;

  await User.updateOne(
    { _id: user._id },
    {
      $set: { walletLinked: false },
      $unset: {
        walletAddress: 1,
        walletLinkedAt: 1,
        walletLinkTxHash: 1,
      },
    }
  );

  await VerificationRecord.updateOne(
    {
      userId: user._id,
      verificationType: VERIFICATION_TYPES.WALLET_PROOF,
    },
    {
      $set: {
        status: VERIFICATION_STATUSES.PENDING,
        walletChallengeAttempts: 0,
      },
      $unset: {
        walletAddress: 1,
        verifiedAt: 1,
        walletChallengeNonce: 1,
        walletChallengeAddress: 1,
        walletChallengeChainId: 1,
        walletChallengeIssuedAt: 1,
        walletChallengeExpiresAt: 1,
        walletChallengeConsumedAt: 1,
      },
    }
  );

  await logSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.DEV_WALLET_UNLINKED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: user._id,
    details: {
      maskedAddress,
      hadLinkedWallet: Boolean(previousWallet),
    },
  });

  return {
    unlinked: true,
    userId: String(user._id),
    email: user.email,
    maskedAddress,
    hadLinkedWallet: Boolean(previousWallet),
  };
}

async function runCli() {
  let exitCode = 0;
  try {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "dev:unlink-wallet is disabled when NODE_ENV=production."
      );
    }

    const emailArg = process.argv[2];
    if (!emailArg) {
      console.error("Usage: npm run dev:unlink-wallet -- <user-email>");
      process.exit(1);
    }

    await connectDB();
    const result = await devUnlinkWallet(emailArg);

    if (result.hadLinkedWallet) {
      console.log(
        `Unlinked wallet ${result.maskedAddress} from ${result.email} (${result.userId}). You can now re-link a wallet in development.`
      );
    } else {
      console.log(
        `Account ${result.email} (${result.userId}) had no linked wallet; cleared any pending wallet challenge.`
      );
    }
  } catch (err) {
    console.error("dev:unlink-wallet failed:", err.message);
    exitCode = 1;
  } finally {
    await disconnectDB();
    process.exit(exitCode);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  devUnlinkWallet,
};
