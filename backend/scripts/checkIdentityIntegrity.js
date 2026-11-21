const { connectDB, disconnectDB } = require("../src/config/db");
const User = require("../src/models/User.model");
const VerificationRecord = require("../src/models/VerificationRecord.model");
const {
  IDENTITY_STATUSES,
  VERIFICATION_TYPES,
  VERIFICATION_STATUSES,
} = require("../src/config/constants");

/**
 * Read-only integrity checker for identity verification records across MongoDB.
 * Uses MongoDB aggregations and cursors so large collections are never loaded
 * wholesale into memory.
 *
 * PRIVACY: Never returns or prints any identityHash, document number, or name —
 * only counts and document/user IDs.
 */
async function checkIdentityIntegrity() {
  // 1. Users with identityStatus VERIFIED (or identityVerified: true) but missing identityHash
  const verifiedWithoutHash = [];
  const verifiedWithoutHashCursor = User.find({
    $and: [
      {
        $or: [
          { identityStatus: IDENTITY_STATUSES.VERIFIED },
          { identityVerified: true },
        ],
      },
      {
        $or: [
          { identityHash: { $exists: false } },
          { identityHash: null },
          { identityHash: "" },
        ],
      },
    ],
  })
    .select("_id")
    .lean()
    .cursor();

  for await (const doc of verifiedWithoutHashCursor) {
    verifiedWithoutHash.push(String(doc._id));
  }

  // 2. Users with an identityHash present but identityStatus !== VERIFIED
  const hashWithoutVerifiedStatus = [];
  const hashWithoutVerifiedCursor = User.find({
    identityHash: { $type: "string", $ne: "" },
    identityStatus: { $ne: IDENTITY_STATUSES.VERIFIED },
  })
    .select("_id")
    .lean()
    .cursor();

  for await (const doc of hashWithoutVerifiedCursor) {
    hashWithoutVerifiedStatus.push(String(doc._id));
  }

  // 3. Duplicate identityHash values across Users (should be prevented by unique index)
  // Project away _id (the hash value) so no hash ever leaves MongoDB.
  const duplicateHashGroups = await User.aggregate([
    {
      $match: {
        identityHash: { $type: "string", $ne: "" },
      },
    },
    {
      $group: {
        _id: "$identityHash",
        count: { $sum: 1 },
        userIds: { $push: "$_id" },
      },
    },
    {
      $match: {
        count: { $gt: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        count: 1,
        userIds: 1,
      },
    },
  ]);

  const duplicateIdentityHashes = duplicateHashGroups.map((group) => ({
    count: group.count,
    userIds: group.userIds.map((id) => String(id)),
  }));

  // 4a. VerificationRecords with MOCK_KYC + status VERIFIED whose userId has no matching VERIFIED User
  const orphanedRecordRows = await VerificationRecord.aggregate([
    {
      $match: {
        verificationType: VERIFICATION_TYPES.MOCK_KYC,
        status: VERIFICATION_STATUSES.VERIFIED,
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        let: { uid: "$userId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$uid"] },
              identityStatus: IDENTITY_STATUSES.VERIFIED,
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "verifiedUser",
      },
    },
    {
      $match: {
        verifiedUser: { $size: 0 },
      },
    },
    {
      $project: {
        _id: 1,
        userId: 1,
      },
    },
  ]);

  const orphanedVerifiedRecords = orphanedRecordRows.map((row) => ({
    recordId: String(row._id),
    userId: String(row.userId),
  }));

  // 4b. Reverse: Users with identityStatus VERIFIED who have no matching MOCK_KYC VERIFIED record
  const verifiedUsersMissingRecordRows = await User.aggregate([
    {
      $match: {
        identityStatus: IDENTITY_STATUSES.VERIFIED,
      },
    },
    {
      $lookup: {
        from: VerificationRecord.collection.name,
        let: { uid: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$userId", "$$uid"] },
              verificationType: VERIFICATION_TYPES.MOCK_KYC,
              status: VERIFICATION_STATUSES.VERIFIED,
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "verifiedRecords",
      },
    },
    {
      $match: {
        verifiedRecords: { $size: 0 },
      },
    },
    {
      $project: {
        _id: 1,
      },
    },
  ]);

  const verifiedUsersWithoutRecord = verifiedUsersMissingRecordRows.map((row) =>
    String(row._id)
  );

  // 5. Users with identityStatus VERIFIED whose phone is not verified
  const verifiedIdentityWithUnverifiedPhone = [];
  const unverifiedPhoneCursor = User.find({
    identityStatus: IDENTITY_STATUSES.VERIFIED,
    phoneVerified: { $ne: true },
  })
    .select("_id")
    .lean()
    .cursor();

  for await (const doc of unverifiedPhoneCursor) {
    verifiedIdentityWithUnverifiedPhone.push(String(doc._id));
  }

  // 6. Users with a linked walletAddress whose identityStatus is not VERIFIED
  // PRIVACY: Only user IDs are returned; full wallet addresses are never output.
  const walletWithoutVerifiedIdentity = [];
  const walletWithoutVerifiedCursor = User.find({
    walletAddress: { $type: "string", $ne: "" },
    identityStatus: { $ne: IDENTITY_STATUSES.VERIFIED },
  })
    .select("_id")
    .lean()
    .cursor();

  for await (const doc of walletWithoutVerifiedCursor) {
    walletWithoutVerifiedIdentity.push(String(doc._id));
  }

  const summary = {
    verifiedWithoutHash: verifiedWithoutHash.length,
    hashWithoutVerifiedStatus: hashWithoutVerifiedStatus.length,
    duplicateIdentityHashes: duplicateIdentityHashes.length,
    orphanedVerifiedRecords: orphanedVerifiedRecords.length,
    verifiedUsersWithoutRecord: verifiedUsersWithoutRecord.length,
    verifiedIdentityWithUnverifiedPhone:
      verifiedIdentityWithUnverifiedPhone.length,
    walletWithoutVerifiedIdentity: walletWithoutVerifiedIdentity.length,
  };

  const totalIssues = Object.values(summary).reduce((acc, n) => acc + n, 0);

  return {
    ok: totalIssues === 0,
    totalIssues,
    summary,
    issues: {
      verifiedWithoutHash,
      hashWithoutVerifiedStatus,
      duplicateIdentityHashes,
      orphanedVerifiedRecords,
      verifiedUsersWithoutRecord,
      verifiedIdentityWithUnverifiedPhone,
      walletWithoutVerifiedIdentity,
    },
  };
}

async function runCli() {
  let exitCode = 0;
  try {
    await connectDB();
    const report = await checkIdentityIntegrity();

    console.log("FairTicket Identity Integrity Check");
    console.log("-----------------------------------");
    console.log(JSON.stringify(report, null, 2));

    if (!report.ok) {
      exitCode = 1;
    }
  } catch (err) {
    console.error("Identity integrity check failed:", err.message);
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
  checkIdentityIntegrity,
};
