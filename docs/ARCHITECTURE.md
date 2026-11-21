# FairTicket — System Architecture Specification

> **Tagline:** "Every Fan Deserves a Fair Ticket."
> **Hackathon Track:** Cybersecurity and Blockchain — Problem B2: Fair Tickets
> **Document Role:** Single Source of Truth for Build Prompts 2 through 37. Every route path, MongoDB field name, enum value, constant, Solidity function signature, error code, and file path defined in this document must be implemented verbatim in subsequent prompts.

---

## 1. Summary and requirement map

FairTicket solves concert and live-event ticket scalping, bot hoarding, and counterfeit ticket fraud using four cooperating layers: verified off-chain identity linked to an on-chain hash, a fair randomized queue with atomic timed holds, a unified Solidity ledger enforcing ticket caps and a 110% resale price ceiling, and **FairTicket Trust Guardian** to simulate and verify MetaMask transactions before a fan signs.

| Requirement / Feature | Description | Implementing Modules |
| --- | --- | --- |
| **Mandatory Req 1: Fair Ticket Booking** | Real fans get a fair chance; stop bots, scalpers, and bulk buying | Identity Verification (`F1`), Randomized Queue (`F2`), Timed Hold + CAPTCHA (`F3`), Per-Identity 2-Ticket Cap (`F4`) |
| **Mandatory Req 2: Controlled Resale** | Resale is allowed only via official marketplace capped at 110% of original price | Unified Contract Resale Functions (`F6`), Resale Backend Service (`F6`), Price History & Scalping Detection (`F7`), Direct Transfer Blocker (`F6`) |
| **Mandatory Req 3: Fake-Ticket Prevention** | Counterfeit or screenshotted tickets fail at the gate; staff verify live ownership | On-Chain Ownership Record (`F5`), Gate Ownership Verification (`F8`), Short-Lived Signed QR & Atomic One-Time Redemption (`F9`) |
| **F1: Verified Identity** | Register -> simulated OTP -> simulated KYC -> duplicate identity check -> MetaMask wallet signature proof | `backend/src/controllers/auth.controller.js`, `verification.controller.js`, `wallet.controller.js`; `FairTicket.verifyWallet`; `Users`, `VerificationRecords` |
| **F2: Randomized Verified Queue** | Verified fans enter registration window; published seed + deterministic Fisher-Yates shuffle assigns auditable positions | `backend/src/controllers/queue.controller.js`, `queue.service.js`; `QueueEntries`, `Events`; `frontend/src/pages/RandomizedQueuePage.jsx` |
| **F3: Timed Booking Lock + Human Verification** | Turn triggers backend-owned 5-minute hold, CAPTCHA verification, quantity selection, simulated payment, atomic inventory update | `backend/src/controllers/booking.controller.js`, `booking.service.js`, `captcha.service.js`, `holdExpiry.job.js`; `BookingHolds`, `Bookings`, `Payments` |
| **F4: Max 2 Active Tickets per Verified Identity** | Enforced per verified identity per event in both backend and Solidity; cannot be bypassed with multiple wallets; includes resale purchases | `FairTicket.checkTicketLimit`, `FairTicket.purchaseTicket`, `FairTicket.buyResaleTicket`; `backend/src/services/ticketLimit.service.js`; `Tickets` |
| **F5: Blockchain Ownership Record** | Unique on-chain ticket ID tracking original purchase, current owner, resale transfers, and redemption with transaction hashes | `FairTicket.sol` (`TicketRecord`, `TicketHistoryRecord`); `backend/src/services/blockchain.service.js`; `Tickets`, `TicketHistory` |
| **F6: Controlled Resale** | Official marketplace enforcing `maxResale = floor(original * 110 / 100)` with integer paise math; blocks direct transfers | `FairTicket.listForResale`, `FairTicket.cancelResaleListing`, `FairTicket.buyResaleTicket`, `FairTicket.transferTicket`; `resale.controller.js`; `Resales` |
| **F7: Price History & Scalping Detection** | On-chain record of completed resales; UI shows price timeline and variation; flags `>= 5x` attempts and logs rejected attempts off-chain | `FairTicket.getTicketHistory`; `resale.service.js`, `securityLog.service.js`; `TicketHistory`, `SecurityLogs`; `TicketPriceHistoryPage.jsx` |
| **F8: Ownership Verification at Entry** | Gate check confirms ticket exists, belongs to presenter, matches event, is unused, and matches live blockchain state | `backend/src/controllers/gate.controller.js`, `gate.service.js`; `FairTicket.getTicketDetails`, `FairTicket.getTicketOwner`; `GateVerificationPage.jsx` |
| **F9: QR & One-Time Redemption** | Signed 30-second QR tokens (zero PII); atomic MongoDB lock + on-chain `redeemTicket`; blocks replays and concurrent double scans | `backend/src/services/qr.service.js`, `gate.service.js`; `FairTicket.redeemTicket`; `Tickets`, `TicketHistory`, `SecurityLogs`; `QRScannerPage.jsx` |
| **F10: Blockchain Transaction History** | Clean user-facing timeline of mints, listings, resales, resale prices, redemptions, and transaction hashes | `backend/src/controllers/ticket.controller.js`; `TicketHistory`; `TicketOwnershipHistoryPage.jsx`, `TicketPriceHistoryPage.jsx` |
| **Standout: Trust Guardian** | Pre-signing deterministic simulation (`eth_call`), calldata decoding, trusted registry check, deterministic risk rules, and plain-English explanation | `backend/src/services/trustGuardian/*` (`decoder`, `simulator`, `trustedRegistry`, `ruleEngine`, `explainer`); `trustGuardian.controller.js`; `TrustGuardianReviewPage.jsx` |

---

## 2. Fixed constants and conventions

### 2.1 System-Wide Constants

All layers (frontend, backend, and smart contract) must use these exact constant names and values:

| Constant Name | Value | Scope / Usage |
| --- | --- | --- |
| `MAX_ACTIVE_TICKETS` | `2` | Maximum active + redeemed tickets allowed per verified `identityHash` **per event** |
| `RESALE_CAP_PERCENT` | `110` | Maximum official resale price expressed as an integer percentage of `originalPricePaise` |
| `SCALPING_WARNING_MULTIPLIER` | `5` | Multiplier threshold (`askingPricePaise >= originalPricePaise * 5`) that triggers a `SCALPING_ATTEMPT_5X` warning and `CRITICAL` security log |
| `DEFAULT_HOLD_MINUTES` | `5` | Default duration of a timed booking hold; overridable per event via `Events.holdDurationMinutes` (allowed range: `1` to `15`) |
| `QR_TOKEN_TTL_SECONDS` | `30` | Lifetime of every signed rotating entry QR token |
| `OTP_TTL_SECONDS` | `300` | Lifetime of simulated phone OTP (5 minutes) |
| `OTP_MAX_ATTEMPTS` | `5` | Maximum wrong OTP entries before temporary lockout and `OTP_BRUTE_FORCE` security log |
| `WALLET_NONCE_TTL_SECONDS` | `300` | Lifetime of MetaMask authentication challenge nonce |
| `AUTH_PERMIT_TTL_SECONDS` | `180` | Lifetime of backend-signed ECDSA authorization permit for `purchaseTicket` and `buyResaleTicket` |
| `CAPTCHA_TTL_SECONDS` | `180` | Lifetime of a demo CAPTCHA challenge |
| `HOLD_EXPIRY_POLL_SECONDS` | `10` | Interval for the backend background job releasing expired holds and promoting the next queue user |
| `CHAIN_ID` | `31337` | Local Hardhat network chain ID |
| `IDENTITY_CONSENT_VERSION` | `"v1"` | Consent version recorded on simulated identity verification submissions |
| `ALLOWED_IDENTITY_DOC_TYPES` | `["DEMO_ID"]` | Allowed simulated document types for mock KYC submission |
| `EVENT_MIN_PRICE_PAISE` | `10000` | Minimum primary ticket price for event creation (Rs 100.00) |
| `EVENT_MAX_PRICE_PAISE` | `50000000` | Maximum primary ticket price for event creation (Rs 5,00,000.00) |
| `EVENT_MAX_TOTAL_TICKETS` | `100000` | Maximum primary ticket supply per event |
| `EVENT_MIN_REGISTRATION_WINDOW_MINUTES` | `1` | Minimum gap between `registrationOpenAt` and `registrationCloseAt` (supports short demo windows) |
| `EVENT_LIST_DEFAULT_PAGE_SIZE` | `12` | Default public/owner event listing page size |
| `EVENT_LIST_MAX_PAGE_SIZE` | `50` | Maximum allowed `limit` query parameter on event listing endpoints |

### 2.2 Integer-Only Money Rules

- Every monetary value across MongoDB, Express JSON payloads, React state, and Solidity `uint256` is stored as a **non-negative integer in Indian paise** (1 Rupee = 100 paise).
  - Example: Rs 5,000.00 is stored as `500000`.
  - Example: Rs 5,500.00 is stored as `550000`.
- Floating-point arithmetic is strictly forbidden for prices, caps, fees, or totals.
- **Resale Cap Formula**:
  - JavaScript (backend and frontend preview): `const maxResalePricePaise = Math.floor((originalPricePaise * 110) / 100);`
  - Solidity (integer division truncates toward zero): `uint256 maxResalePricePaise = (originalPricePaise * RESALE_CAP_PERCENT) / 100;`
  - Example verification: `floor(500000 * 110 / 100) = 550000` (Rs 5,500).
- **Display Formatting (UI Only)**: Convert paise to INR string strictly at render time using integer division and remainder (`Math.floor(paise / 100)` and `String(paise % 100).padStart(2, '0')`).

### 2.3 Standard API Response Shape

Every `/api/v1/*` endpoint must return this exact JSON envelope:

```json
// Success response (HTTP 200 or 201)
{
  "success": true,
  "data": {},
  "error": null
}

// Error response (HTTP 400, 401, 403, 404, 409, 422, 429, or 500)
{
  "success": false,
  "data": null,
  "error": {
    "code": "RESALE_CAP_EXCEEDED",
    "message": "Asking price exceeds the 110% official resale cap of Rs 5,500.00."
  }
}
```

### 2.4 Standard API Error Codes

All backend errors must use one of these exact `error.code` values:

`VALIDATION_ERROR`, `UNAUTHORIZED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `ALREADY_EXISTS`, `ACCOUNT_LOCKED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PHONE_ALREADY_VERIFIED`, `OTP_COOLDOWN`, `OTP_SEND_LIMIT`, `OTP_NOT_REQUESTED`, `SMS_FAILED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS`, `PHONE_NOT_VERIFIED`, `IDENTITY_NOT_VERIFIED`, `WALLET_NOT_LINKED`, `IDENTITY_ALREADY_VERIFIED`, `IDENTITY_ATTEMPT_LIMIT`, `IDENTITY_PROVIDER_FAILED`, `IDENTITY_REJECTED`, `IDENTITY_ALREADY_REGISTERED`, `REAL_ID_NOT_ALLOWED`, `DUPLICATE_IDENTITY`, `ACCOUNT_ALREADY_HAS_WALLET`, `WALLET_CHALLENGE_LIMIT`, `WALLET_CHALLENGE_NOT_REQUESTED`, `WALLET_CHALLENGE_EXPIRED`, `WALLET_CHALLENGE_MISMATCH`, `WALLET_CHALLENGE_LOCKED`, `WALLET_ALREADY_LINKED`, `WALLET_SIGNATURE_INVALID`, `NONCE_EXPIRED`, `USER_NOT_VERIFIED`, `EVENT_LOCKED`, `INVALID_EVENT_STATE`, `EVENT_REGISTRATION_ALREADY_CLOSED`, `EVENT_HAS_BOOKINGS`, `REGISTRATION_CLOSED`, `DUPLICATE_QUEUE_ENTRY`, `NOT_YOUR_TURN`, `HOLD_EXPIRED`, `HOLD_EXTENSION_FORBIDDEN`, `CAPTCHA_INVALID`, `INSUFFICIENT_INVENTORY`, `TICKET_LIMIT_EXCEEDED`, `RESALE_CAP_EXCEEDED`, `SCALPING_BLOCKED`, `NOT_TICKET_OWNER`, `TICKET_NOT_ACTIVE`, `QR_EXPIRED`, `QR_INVALID`, `TICKET_ALREADY_USED`, `BLOCKCHAIN_MISMATCH`, `BLOCKCHAIN_TX_FAILED`, `INTERNAL_ERROR`.

### 2.5 Naming Rules

- **REST Routes**: Base path `/api/v1`, lowercase kebab-case path segments, plural nouns for collections (e.g., `/api/v1/events/:eventId/queue/join`).
- **JSON & MongoDB Fields**: `camelCase` (e.g., `originalPricePaise`, `identityHash`, `walletAddress`).
- **Enums & Error Codes**: `UPPER_SNAKE_CASE` (e.g., `LISTED_FOR_RESALE`, `GATE_STAFF`, `ACTIVE_TURN`).
- **Solidity Identifiers**: Contracts and structs in `PascalCase`, functions and variables in `camelCase`, constants and role hashes in `UPPER_SNAKE_CASE`, custom errors in `PascalCase`.
- **Ethereum Addresses**: Always normalized to lowercase in MongoDB (`walletAddress.toLowerCase()`) and EIP-55 checksummed or parsed via `ethers.getAddress()` when passed to Ethers.js.

---

## 3. System architecture

### 3.1 Component & Data-Flow Diagram

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      BROWSER (React + Vite + Tailwind CSS)                        │
│  ┌────────────────────────────────┐      ┌─────────────────────────────────────┐  │
│  │ 17 Role-Aware Pages            │      │ Trust Guardian Review UI            │  │
│  │ • Auth, KYC, Queue, Checkout   │─────▶│ • Sends unsigned tx + user intent   │  │
│  │ • My Tickets, Resale, History  │      │ • Shows decoded call & risk verdict │  │
│  │ • Gate Scanner, Dashboards     │      │ • User explicitly Approves/Cancels  │  │
│  └───────────────┬────────────────┘      └──────────────────┬──────────────────┘  │
│                  │ Axios + Bearer JWT                       │ eth_sendTransaction │
│                  │ (/api/v1/*)                              ▼                     │
│                  │                               ┌─────────────────────────────┐  │
│                  │                               │ MetaMask Browser Extension  │  │
│                  │                               │ (Fan EOA: Signs Ownership   │  │
│                  │                               │  & Resale Transactions)     │  │
│                  │                               └──────────────┬──────────────┘  │
└──────────────────┼──────────────────────────────────────────────┼─────────────────┘
                   ▼                                              │ JSON-RPC (8545)
┌──────────────────────────────────────────────────────────┐      │
│           EXPRESS.JS API SERVER (Port 5000)              │      │
│  ┌─────────────────────┐  ┌───────────────────────────┐  │      │
│  │ Security Middleware │  │ Core Domain Services      │  │      │
│  │ • Helmet, CORS      │─▶│ • Auth/JWT/RBAC + OTP     │  │      │
│  │ • express-rate-limit│  │ • Mock KYC + Hash Dedup   │  │      │
│  │ • Request Validator │  │ • Queue & Hold State Mach │  │      │
│  └─────────────────────┘  │ • CAPTCHA + Sim Payment   │  │      │
│                           │ • Resale + Scalping Guard │  │      │
│                           │ • QR Signer + Gate Verify │  │      │
│                           │ • Trust Guardian Engine   │  │      │
│                           └─────────────┬─────────────┘  │      │
│  ┌──────────────────────────────────────┴─────────────┐  │      │
│  │ Background Job: holdExpiry.job.js (every 10s)      │  │      │
│  │ Ethers.js Blockchain Service (Verifier/Gate Keys)  │  │      │
│  └───────────────┬──────────────────────────┬─────────┘  │      │
└──────────────────┼──────────────────────────┼────────────┘      │
                   │ Mongoose                 │ Ethers.js RPC     │
                   ▼                          ▼                   ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────────────────┐
│   LOCAL MONGODB (Port 27017)    │  │     LOCAL HARDHAT NODE (Port 8545)          │
│   Standalone Instance           │  │     Chain ID: 31337                         │
│   11 Collections:               │  │     Unified Contract: FairTicket.sol        │
│   Users, VerificationRecords,   │  │     • Wallet <-> identityHash mapping       │
│   Events, QueueEntries,         │  │     • Per-identity per-event ticket cap (2) │
│   BookingHolds, Bookings,       │  │     • Minting with backend ECDSA permit     │
│   Payments, Tickets, Resales,   │  │     • Official resale + 110% cap math       │
│   TicketHistory, SecurityLogs   │  │     • Direct transfer always reverts        │
└─────────────────────────────────┘  │     • One-time gate redemption (USED)       │
                                     │     • Read-only eth_call for Trust Guardian │
                                     └─────────────────────────────────────────────┘
```

### 3.2 On-Chain vs Off-Chain Data Split

| Data / Responsibility | Stored Where | Why |
| --- | --- | --- |
| User PII (full name, email, phone, hashed password, simulated ID reference) | **Off-Chain (MongoDB)** | Public blockchains are immutable and transparent; placing personal data or Aadhaar numbers on-chain violates privacy laws and cannot be deleted. |
| Privacy-preserving `identityHash` (`keccak256(normalizedDocType + ":" + normalizedIdNumber + ":" + serverSalt)`) | **Off-Chain (MongoDB) + On-Chain (`FairTicket.sol`)** | One-way salted hash lets the smart contract enforce the 2-ticket limit per person across multiple wallets without revealing who the person is. |
| Wallet-to-`identityHash` binding | **On-Chain (Authority) + Off-Chain (Mirror)** | On-chain enforcement guarantees a scalper cannot bypass the 2-ticket limit by switching MetaMask wallets and calling the contract directly. |
| Event catalog metadata (title, artist, venue, poster, registration window, hold minutes) | **Off-Chain (MongoDB)** | Rich text and scheduling windows change frequently and are expensive to store on-chain; only `eventId`, `basePricePaise`, `totalSupply`, `mintedCount`, and `maxPerIdentity` live on-chain. |
| Queue entries, shuffle seed, booking holds, CAPTCHA challenges, simulated INR payments | **Off-Chain (MongoDB)** | High-frequency, short-lived operational state that requires instant atomic expiration and zero gas cost. |
| Ticket ownership, original price, active resale listing, 110% cap enforcement, completed resale prices, `USED` status | **On-Chain (Authority) + Off-Chain (Mirror)** | Immutable, publicly auditable proof of ticket authenticity, ownership history, price fairness, and one-time redemption. |
| Rejected resale attempts, `>= 5x` scalping warnings, failed OTPs, QR replay attempts, Trust Guardian warnings | **Off-Chain (MongoDB `SecurityLogs`)** | Reverted blockchain transactions erase all state changes and emit zero on-chain events; security telemetry must be captured off-chain. |
| Rotating 30-second QR payload | **Generated Off-Chain (HMAC-SHA256 signed)** | Short-lived bearer token containing only `ticketId`, `eventId`, `issuedAt`, `expiresAt`, `nonce`, and `signature` — zero PII and zero gas cost. |

### 3.3 Hybrid Transaction Signing Model

- **Fan-Signed via MetaMask (Protected by Trust Guardian)**:
  - `purchaseTicket` (after backend approves queue turn, CAPTCHA, and simulated payment and returns a single-use ECDSA authorization permit)
  - `listForResale`
  - `cancelResaleListing`
  - `buyResaleTicket` (after backend validates buyer eligibility and simulated payment and returns a single-use ECDSA authorization permit)
- **Backend-Signed via Hardhat Signer Keys**:
  - `createEvent` and `setEventStatus` (signed by `ORGANIZER_ROLE` relayer wallet when an Organizer/Admin creates or updates an event)
  - `verifyWallet` and `revokeWallet` (signed by `VERIFIER_ROLE` wallet after off-chain KYC + MetaMask ownership signature succeed)
  - `redeemTicket` (signed by `GATE_ROLE` wallet when authenticated `GATE_STAFF` scans a valid QR code, avoiding MetaMask popups at high-traffic concert gates)

---

## 4. Folder structure

```text
/
├── docs/
│   └── ARCHITECTURE.md                                  # Single source of truth architecture specification
│
├── blockchain/                                          # Hardhat workspace (Solidity + local node + tests)
│   ├── package.json                                     # Hardhat, OpenZeppelin, Ethers v6, Chai dependencies
│   ├── hardhat.config.js                                # Local Hardhat network (chainId 31337), Solidity 0.8.24 config
│   ├── .env.example                                     # Blockchain environment variable template
│   ├── contracts/
│   │   └── FairTicket.sol                               # Unified ticket, identity-cap, resale, and redemption contract
│   ├── scripts/
│   │   ├── deploy.js                                    # Deploys FairTicket, grants roles, exports ABI & address
│   │   └── seedEvents.js                                # Optional helper to register demo events on local Hardhat node
│   ├── test/
│   │   ├── FairTicket.booking.test.js                   # Tests event creation, wallet verification, minting, 2-ticket identity cap
│   │   ├── FairTicket.resale.test.js                    # Tests 110% cap integer math, direct transfer block, resale limit updates
│   │   └── FairTicket.redemption.test.js                # Tests gate redemption, double-redeem block, history queries
│   └── deployments/
│       └── localhost.json                               # Generated by deploy.js: contract address, chainId, ABI path
│
├── backend/                                             # Node.js + Express + Mongoose REST API server
│   ├── package.json                                     # Express, Mongoose, Ethers v6, JWT, bcryptjs, Helmet, rate-limit
│   ├── .env.example                                     # Backend environment variable template
│   └── src/
│       ├── server.js                                    # Process entry point: connects MongoDB, starts HTTP server & hold job
│       ├── app.js                                       # Express app setup: Helmet, CORS, JSON parser, rate limiters, routes, error handler
│       ├── config/
│       │   ├── constants.js                             # Fixed constants (MAX_ACTIVE_TICKETS, RESALE_CAP_PERCENT, enums, error codes)
│       │   ├── db.js                                    # Mongoose connection handler for local MongoDB
│       │   └── blockchain.js                            # Ethers JsonRpcProvider, contract instance, verifier/organizer/gate signers
│       ├── contracts/
│       │   └── FairTicket.abi.json                      # Copied from blockchain/artifacts during deploy.js
│       ├── models/
│       │   ├── User.model.js                            # Users collection schema and indexes
│       │   ├── VerificationRecord.model.js              # VerificationRecords collection schema and indexes
│       │   ├── Event.model.js                           # Events collection schema and indexes
│       │   ├── QueueEntry.model.js                      # QueueEntries collection schema and indexes
│       │   ├── BookingHold.model.js                     # BookingHolds collection schema and indexes
│       │   ├── Booking.model.js                         # Bookings collection schema and indexes
│       │   ├── Payment.model.js                         # Payments collection schema and indexes
│       │   ├── Ticket.model.js                          # Tickets collection schema and indexes
│       │   ├── Resale.model.js                          # Resales collection schema and indexes
│       │   ├── TicketHistory.model.js                   # TicketHistory collection schema and indexes
│       │   └── SecurityLog.model.js                     # SecurityLogs collection schema and indexes
│       ├── middleware/
│       │   ├── auth.middleware.js                       # JWT verification and req.user attachment
│       │   ├── role.middleware.js                       # RBAC guard accepting allowed UserRole array
│       │   ├── verifiedUser.middleware.js               # Ensures phoneVerified + identityVerified + walletLinked
│       │   ├── rateLimit.middleware.js                  # Global, auth, OTP, and gate scan rate limiters
│       │   ├── validate.middleware.js                   # Schema-based request body/params/query validator
│       │   └── errorHandler.middleware.js               # Formats all errors into { success: false, data: null, error }
│       ├── utils/
│       │   ├── apiResponse.js                           # Helpers sendSuccess() and sendError()
│       │   ├── AppError.js                              # Custom error class carrying HTTP status and error.code
│       │   ├── crypto.js                                # Salted identityHash, OTP hashing, HMAC QR signing, secure nonces
│       │   ├── money.js                                 # Integer paise helpers and floor(original * 110 / 100) cap math
│       │   └── deterministicShuffle.js                  # Seeded PRNG + Fisher-Yates shuffle for auditable queue ordering
│       ├── services/
│       │   ├── auth.service.js                          # Register, login, JWT issuance, password hashing
│       │   ├── otp.service.js                           # Simulated OTP generation, verification, attempt lockout
│       │   ├── identity.service.js                      # Mock KYC provider adapter, salted hashing, duplicate identity detection
│       │   ├── wallet.service.js                        # MetaMask challenge nonce generation, SIWE-style signature check, verifyWallet call
│       │   ├── event.service.js                         # Event CRUD, status transitions, on-chain createEvent sync
│       │   ├── queue.service.js                         # Queue registration, seed publication, deterministic shuffle, turn promotion
│       │   ├── captcha.service.js                       # Demo math/text CAPTCHA generation and single-use validation
│       │   ├── booking.service.js                       # Atomic hold creation, state transitions, simulated payment, permit signing, mint sync
│       │   ├── ticketLimit.service.js                   # Dual backend + on-chain active ticket limit checks per (identityHash, eventId)
│       │   ├── blockchain.service.js                    # Typed wrapper around all FairTicket.sol reads, writes, and event parsing
│       │   ├── ticket.service.js                        # Ticket queries, ownership sync, history aggregation, mismatch checks
│       │   ├── resale.service.js                        # Listing validation, 110% cap, >=5x scalping log, simulated resale payment, sync
│       │   ├── qr.service.js                            # Signed 30-second QR payload builder and HMAC/TTL verifier
│       │   ├── gate.service.js                          # Gate entry verification, on-chain cross-check, atomic one-time redemption
│       │   ├── securityLog.service.js                   # Centralized writer and query helper for SecurityLogs
│       │   ├── dashboard.service.js                     # Aggregations for Admin, Organizer, and Gate Staff dashboards
│       │   └── trustGuardian/
│       │       ├── index.js                             # Orchestrates decoder -> registry -> simulator -> ruleEngine -> explainer
│       │       ├── decoder.service.js                   # Decodes raw calldata using FairTicket ABI and ERC-20/721 approval signatures
│       │       ├── trustedRegistry.service.js           # Verified contract registry (FairTicket address + chainId allowlist)
│       │       ├── simulator.service.js                 # Runs deterministic eth_call simulation & state diff estimation on Hardhat
│       │       ├── ruleEngine.service.js                # Evaluates all 11 deterministic security rules and computes riskLevel
│       │       └── explainer.service.js                 # Deterministic template explainer + pluggable AI explainer adapter interface
│       ├── controllers/
│       │   ├── auth.controller.js                       # HTTP handlers for /api/v1/auth/*
│       │   ├── verification.controller.js               # HTTP handlers for /api/v1/verification/*
│       │   ├── wallet.controller.js                     # HTTP handlers for /api/v1/wallet/*
│       │   ├── event.controller.js                      # HTTP handlers for /api/v1/events/*
│       │   ├── queue.controller.js                      # HTTP handlers for /api/v1/events/:eventId/queue/*
│       │   ├── booking.controller.js                    # HTTP handlers for /api/v1/holds/* and /api/v1/bookings/*
│       │   ├── captcha.controller.js                    # HTTP handlers for /api/v1/captcha/*
│       │   ├── ticket.controller.js                     # HTTP handlers for /api/v1/tickets/*
│       │   ├── resale.controller.js                     # HTTP handlers for /api/v1/resales/*
│       │   ├── gate.controller.js                       # HTTP handlers for /api/v1/gate/*
│       │   ├── trustGuardian.controller.js              # HTTP handlers for /api/v1/trust-guardian/*
│       │   ├── admin.controller.js                      # HTTP handlers for /api/v1/admin/*
│       │   └── organizer.controller.js                  # HTTP handlers for /api/v1/organizer/*
│       ├── routes/
│       │   ├── index.js                                 # Mounts all feature routers under /api/v1
│       │   ├── auth.routes.js
│       │   ├── verification.routes.js
│       │   ├── wallet.routes.js
│       │   ├── event.routes.js
│       │   ├── queue.routes.js
│       │   ├── booking.routes.js
│       │   ├── captcha.routes.js
│       │   ├── ticket.routes.js
│       │   ├── resale.routes.js
│       │   ├── gate.routes.js
│       │   ├── trustGuardian.routes.js
│       │   ├── admin.routes.js
│       │   └── organizer.routes.js
│       ├── jobs/
│       │   └── holdExpiry.job.js                        # Polls expired BookingHolds atomically, restores inventory, activates next queue turn
│       └── seeds/
│           └── demoSeed.js                              # Seeds demo Admin, Organizer, Gate Staff, sample Customers, and Coldplay demo event
│
└── frontend/                                            # React + Vite + JavaScript + Tailwind CSS SPA
    ├── package.json                                     # React, React Router, Axios, Ethers v6, Lucide React, qrcode.react, html5-qrcode
    ├── vite.config.js                                   # Vite dev server (port 5173) and proxy configuration
    ├── tailwind.config.js                               # Brand palette tokens (sky blue, navy, off-white, soft gray, emerald)
    ├── postcss.config.js                                # PostCSS configuration for Tailwind
    ├── index.html                                       # App shell with FairTicket title and meta tags
    ├── .env.example                                     # Frontend VITE_* environment variable template
    └── src/
        ├── main.jsx                                     # React root mount with BrowserRouter and Auth/Wallet providers
        ├── App.jsx                                      # Route definitions for all 17 pages + ProtectedRoute role guards
        ├── index.css                                    # Tailwind directives and typography/tabular-nums base classes
        ├── config/
        │   ├── constants.js                             # Mirrors backend fixed constants and enums
        │   └── contractAbi.js                           # FairTicket ABI subset for frontend calldata encoding
        ├── services/
        │   ├── api.js                                   # Axios instance with JWT interceptor and standard error unwrapping
        │   ├── authApi.js                               # Auth, OTP, identity, wallet API calls
        │   ├── eventApi.js                              # Event listing, details, organizer API calls
        │   ├── queueApi.js                              # Queue join, status, allocation API calls
        │   ├── bookingApi.js                            # Hold, CAPTCHA, simulated payment, mint confirmation calls
        │   ├── ticketApi.js                             # My tickets, ownership history, price history, QR token calls
        │   ├── resaleApi.js                             # Marketplace listings, create/cancel/buy resale calls
        │   ├── gateApi.js                               # Gate verify and redeem calls
        │   ├── trustGuardianApi.js                      # Transaction analysis and decision logging calls
        │   ├── adminApi.js                              # Admin dashboard and security log API calls
        │   └── walletProvider.js                        # MetaMask connection, Hardhat chainId 31337 check, signing helpers
        ├── context/
        │   ├── AuthContext.jsx                          # Authenticated user, JWT storage, verification status, role helpers
        │   └── WalletContext.jsx                        # Connected MetaMask account, network check, account-change listener
        ├── utils/
        │   ├── formatMoney.js                           # Integer paise -> "Rs 5,000.00" formatter (no floats)
        │   └── formatDate.js                            # Local IST date/time and countdown formatting
        ├── components/
        │   ├── layout/
        │   │   ├── Navbar.jsx                           # Clean commercial top navigation with role-based links and wallet badge
        │   │   ├── Footer.jsx                           # Simple commercial footer with verification disclaimer
        │   │   └── PageContainer.jsx                    # Max-width responsive container with consistent spacing
        │   ├── common/
        │   │   ├── ProtectedRoute.jsx                   # Role and verification-step route guard
        │   │   ├── StatusBadge.jsx                      # Minimal status indicators (emerald verified, neutral pending, amber/red alerts)
        │   │   ├── LoadingSpinner.jsx                   # Clean loading state component
        │   │   ├── EmptyState.jsx                       # Standard empty state card
        │   │   ├── ErrorBanner.jsx                      # Standard API error display
        │   │   └── ConfirmDialog.jsx                    # Clean confirmation modal (never uses window.alert/confirm)
        │   ├── booking/
        │   │   ├── CountdownTimer.jsx                   # Backend-synced countdown clock synced to hold.expiresAt
        │   │   ├── CaptchaWidget.jsx                    # Demo human verification challenge widget
        │   │   └── SimulatedPaymentForm.jsx             # Demo UPI/Card simulated payment panel
        │   ├── tickets/
        │   │   ├── TicketCard.jsx                       # Ticket summary card with status, price, and quick actions
        │   │   ├── DynamicQrModal.jsx                   # Auto-refreshing 30-second signed QR display with TTL progress bar
        │   │   └── PriceVariationChart.jsx              # Clean original vs resale price comparison bars/table
        │   └── trustGuardian/
        │       ├── RiskLevelBanner.jsx                  # SAFE / CAUTION / DANGEROUS / BLOCKED verdict header
        │       ├── SimulationSummaryCard.jsx            # Shows decoded function, contract trust, ticketId, exact amount, ownership delta
        │       └── RuleChecklist.jsx                    # Lists every evaluated deterministic rule with PASS/WARN/FAIL status
        └── pages/
            ├── HomePage.jsx                             # Page 1: /
            ├── AuthPage.jsx                             # Page 2: /auth
            ├── IdentityVerificationPage.jsx             # Page 3: /verify-identity
            ├── EventListingPage.jsx                     # Page 4: /events
            ├── EventDetailsPage.jsx                     # Page 5: /events/:eventId
            ├── RandomizedQueuePage.jsx                  # Page 6: /events/:eventId/queue
            ├── TimedBookingPage.jsx                     # Page 7: /booking/:holdId
            ├── BookingConfirmationPage.jsx              # Page 8: /booking/:bookingId/confirmation
            ├── MyTicketsPage.jsx                        # Page 9: /my-tickets
            ├── ResaleMarketplacePage.jsx                # Page 10: /resale
            ├── TicketOwnershipHistoryPage.jsx           # Page 11: /tickets/:ticketId/ownership-history
            ├── TicketPriceHistoryPage.jsx               # Page 12: /tickets/:ticketId/price-history
            ├── TrustGuardianReviewPage.jsx              # Page 13: /trust-guardian/review
            ├── QRScannerPage.jsx                        # Page 14: /gate/scanner
            ├── GateVerificationPage.jsx                 # Page 15: /gate/verify
            ├── AdminDashboardPage.jsx                   # Page 16: /admin
            └── OrganizerDashboardPage.jsx               # Page 17: /organizer
```

---

## 5. Database design

All 11 collections live in a single local MongoDB database (`fairticket`). Every collection uses Mongoose `{ timestamps: true }` to manage `createdAt` and `updatedAt`.

### 5.1 Collection: `Users`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Internal user identifier |
| `fullName` | `String` | Yes | Trimmed, 2–100 chars | Fan or staff display name |
| `email` | `String` | Yes | Lowercase, unique | Login identifier |
| `phone` | `String` | Yes | E.164 format (e.g. `+919876543210`), unique | Phone OTP verification target |
| `passwordHash` | `String` | Yes | bcryptjs hash (cost 10) | Password credential (never returned in API responses) |
| `role` | `String` | Yes | `CUSTOMER`, `ORGANIZER`, `ADMIN`, `GATE_STAFF` (default `CUSTOMER`) | Role-based access control |
| `accountStatus` | `String` | Yes | `ACTIVE`, `SUSPENDED` (default `ACTIVE`) | Allows admin suspension of abusive accounts |
| `phoneVerified` | `Boolean` | Yes | Default `false` | True after simulated phone OTP passes |
| `identityVerified` | `Boolean` | Yes | Default `false` | True after simulated KYC passes and duplicate check clears |
| `identityStatus` | `String` | Yes | `NOT_STARTED`, `VERIFIED`, `REJECTED` (default `NOT_STARTED`) | Detailed identity verification lifecycle state |
| `identityVerifiedAt` | `Date` | No | — | Timestamp when identity verification succeeded |
| `walletLinked` | `Boolean` | Yes | Default `false` | True after MetaMask challenge signature and on-chain `verifyWallet` succeed |
| `identityHash` | `String` | No | 64-char hex HMAC-SHA256 (or 66-char `0x` bytes32), `select: false`, unique partial | Privacy-preserving keyed hash of verified identity; never returned in API responses |
| `walletAddress` | `String` | No | Lowercase 42-char `0x` hex address, unique partial | Currently linked MetaMask address |
| `walletLinkedAt` | `Date` | No | — | Timestamp when MetaMask wallet linking succeeded |
| `walletLinkTxHash` | `String` | No | 66-char `0x` tx hash | On-chain transaction hash from `verifyWallet` |
| `walletAuthNonce` | `String` | No | Random hex string | Active single-use MetaMask login/link challenge |
| `walletAuthNonceExpiresAt` | `Date` | No | — | Expiry timestamp for `walletAuthNonce` |
| `failedLoginCount` | `Number` | Yes | Integer `>= 0`, default `0`, `select: false` | Consecutive failed login attempts toward brute-force lockout |
| `lockedUntil` | `Date` | No | `select: false` | Temporary lockout expiry timestamp after exceeding `AUTH_MAX_FAILED_LOGINS` |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Users`**:
- `{ email: 1 }` — `unique: true`
- `{ phone: 1 }` — `unique: true`
- `{ identityHash: 1 }` — `unique: true, sparse: true` (enforces 1 account per real person off-chain)
- `{ walletAddress: 1 }` — `unique: true, sparse: true` (prevents two accounts claiming the same active wallet)
- `{ role: 1, accountStatus: 1 }` — non-unique query index for Admin dashboard

---

### 5.2 Collection: `VerificationRecords`

Stores simulated OTP challenges and simulated KYC submission state separately from `Users` so raw transient OTP hashes and verification audit trails remain isolated.

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Record identifier |
| `userId` | `ObjectId` | Yes | Ref `Users` | User undergoing verification |
| `verificationType` | `String` | Yes | `PHONE_OTP`, `MOCK_KYC`, `WALLET_PROOF` | Distinguishes the three verification pillars |
| `status` | `String` | Yes | `PENDING`, `VERIFIED`, `REJECTED` (default `PENDING`) | Outcome of this verification step |
| `phone` | `String` | No | Account phone associated with `PHONE_OTP` | Binds OTP challenge to the user's registered phone |
| `otpHash` | `String` | No | HMAC-SHA256 hex digest, `select: false` | Stored only for `PHONE_OTP` (never plaintext) |
| `otpExpiresAt` | `Date` | No | — | Expiry timestamp for `PHONE_OTP` |
| `otpAttemptCount` | `Number` | Yes | Integer, default `0` | Counts wrong OTP guesses toward `OTP_MAX_ATTEMPTS = 5` |
| `otpSentCount` | `Number` | Yes | Integer, default `0` | Rolling 1-hour OTP send counter per user |
| `otpWindowStartedAt` | `Date` | No | — | Start timestamp of rolling 1-hour OTP send window |
| `otpLastSentAt` | `Date` | No | — | Timestamp of most recent OTP send (enforces cooldown) |
| `otpConsumedAt` | `Date` | No | — | Timestamp when active OTP was atomically consumed |
| `identityDocType` | `String` | No | `DEMO_ID`, `SIMULATED_GOV_ID`, `SIMULATED_PASSPORT`, `SIMULATED_STUDENT_ID` | Legacy/simulated ID type enum (never Aadhaar) |
| `documentType` | `String` | No | `DEMO_ID` | Active simulated document type submitted in mock KYC |
| `maskedIdPreview` | `String` | No | Reserved (unused in privacy-hardened mock KYC) | Raw ID numbers and partial digits are never stored |
| `identityHash` | `String` | No | 64-char hex HMAC-SHA256 (or 66-char `0x` bytes32), `select: false` | Computed keyed hash stored only when verified |
| `identityStatus` | `String` | No | `NOT_STARTED`, `VERIFIED`, `REJECTED` | Identity verification outcome |
| `reasonCode` | `String` | No | `NAME_MISMATCH`, `DOCUMENT_REJECTED`, `DUPLICATE_IDENTITY` | Structured mock KYC rejection reason code |
| `providerReference` | `String` | No | Random `MOCK-<16-hex>` receipt ID | Non-PII verification receipt reference (never derived from ID number) |
| `consentAt` | `Date` | No | — | Timestamp when user granted simulated verification consent |
| `consentVersion` | `String` | No | `"v1"` | Consent text version accepted by the user |
| `attemptCount` | `Number` | Yes | Integer, default `0` | Rolling 24-hour identity verification submission counter |
| `attemptWindowStartedAt` | `Date` | No | — | Start timestamp of current rolling 24-hour attempt window |
| `walletAddress` | `String` | No | Lowercase `0x` address | Wallet verified during `WALLET_PROOF` |
| `walletChallengeNonce` | `String` | No | 32-char random hex (plain text, single-use, expires) | Active single-use nonce shown inside the signing challenge message |
| `walletChallengeAddress` | `String` | No | Lowercase `0x` address | Target wallet address bound to the active challenge |
| `walletChallengeChainId` | `Number` | No | Positive integer | EVM chain ID bound to the active challenge |
| `walletChallengeIssuedAt` | `Date` | No | — | Timestamp when the active wallet challenge was issued |
| `walletChallengeExpiresAt` | `Date` | No | — | Expiry timestamp for the active wallet challenge |
| `walletChallengeConsumedAt` | `Date` | No | — | Timestamp when the active wallet challenge was atomically consumed |
| `walletChallengeAttempts` | `Number` | Yes | Integer, default `0` | Failed signature guesses against the active challenge |
| `walletChallengeCount` | `Number` | Yes | Integer, default `0` | Rolling 1-hour counter of wallet challenges issued per user |
| `walletChallengeWindowStartedAt` | `Date` | No | — | Start timestamp of rolling 1-hour wallet challenge window |
| `providerName` | `String` | Yes | Default `SIMULATED_DEMO_PROVIDER` (or `MOCK_KYC`) | Supports swapping in real SMS/KYC provider later |
| `rejectionReason` | `String` | No | — | Explains why verification failed (e.g. `NAME_MISMATCH`, `DOCUMENT_REJECTED`, `DUPLICATE_IDENTITY`) |
| `verifiedAt` | `Date` | No | — | Completion timestamp |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `VerificationRecords`**:
- `{ userId: 1, verificationType: 1, createdAt: -1 }` — fetches latest attempt per user/type
- `{ userId: 1, verificationType: 1 }` — unique index ensuring atomic single-document verification state and rate/attempt tracking per user and verification type
- `{ identityHash: 1, status: 1 }` — accelerates duplicate identity checks

---

### 5.3 Collection: `Events`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Internal event document ID |
| `onChainEventId` | `Number` | No | Positive integer, unique partial (`$type: "number"`) | Numeric ID assigned when synced to `FairTicket.createEvent` (Prompts 15–17) |
| `organizerId` | `ObjectId` | Yes | Ref `Users`, immutable | Organizer who created the event (never exposed in public responses) |
| `title` | `String` | Yes | 3–120 chars (plain text, no `<` or `>`) | Event name (e.g. "Demo Concert: Summer Lights") |
| `artist` | `String` | No | Up to 100 chars, optional | Performing artist or team (optional for general events) |
| `category` | `String` | Yes | `CONCERT`, `SPORTS`, `THEATER`, `COMEDY`, `FESTIVAL` (default `CONCERT`) | Filter category on Event Listing |
| `description` | `String` | No | Up to 2000 chars, plain text (no `<` or `>`) | Event details (the only field editable after publishing) |
| `venueName` | `String` | Yes | 2–120 chars | Stadium or hall name |
| `city` | `String` | Yes | 2–60 chars | Event city |
| `eventDate` | `Date` | Yes | Must be `> registrationCloseAt` | Concert/event start date and time |
| `registrationOpenAt` | `Date` | Yes | — | Start of verified queue registration window |
| `registrationCloseAt` | `Date` | Yes | Must be `>= registrationOpenAt + EVENT_MIN_REGISTRATION_WINDOW_MINUTES` | End of registration window; triggers shuffle eligibility |
| `totalTickets` | `Number` | Yes | Integer `1..100000` | Total primary ticket supply |
| `availableTickets` | `Number` | Yes | Integer `>= 0` (init `= totalTickets`) | Remaining unheld, unsold primary inventory (never API-writable directly) |
| `heldTickets` | `Number` | Yes | Integer `>= 0`, default `0` | Count of tickets currently reserved in active timed booking holds (never public) |
| `soldTickets` | `Number` | Yes | Integer `>= 0`, default `0` | Count of confirmed primary-minted tickets (never API-writable directly) |
| `basePricePaise` | `Number` | Yes | Integer `10000..50000000` on API (`>= 100` in model) | Original primary ticket price in integer paise |
| `maxResalePricePaise` | `Number` | Yes | Integer `= floor(basePricePaise * 110 / 100)` | Precomputed official resale cap in paise |
| `maxTicketsPerIdentity` | `Number` | Yes | Integer `1..2`, default `2` (`MAX_ACTIVE_TICKETS`) | Per-identity cap for this event |
| `holdDurationMinutes` | `Number` | Yes | Integer `1..15`, default `5` (`DEFAULT_HOLD_MINUTES`) | Configurable booking hold duration |
| `activeBatchSize` | `Number` | Yes | Integer `>= 1`, default `5` | How many queue users can hold active booking slots simultaneously |
| `queueShuffleSeed` | `String` | No | 64-char hex string | Published seed used to deterministically shuffle queue entries |
| `queueShuffleHash` | `String` | No | 66-char `0x` SHA-256 hash | Hash of ordered queue result for public auditability |
| `queueAllocatedAt` | `Date` | No | — | Timestamp when shuffle completed |
| `status` | `String` | Yes | `DRAFT`, `PUBLISHED`, `REGISTRATION_OPEN`, `QUEUE_ALLOCATED`, `BOOKING_OPEN`, `SOLD_OUT`, `COMPLETED`, `CANCELLED` (default `DRAFT`) | Stored lifecycle state of the event |
| `publishedAt` | `Date` | No | — | Timestamp when the organizer published the event |
| `cancelledAt` | `Date` | No | — | Timestamp when the organizer or admin cancelled the event |
| `cancelReason` | `String` | No | Plain text, 3–300 chars | Mandatory cancellation explanation shown on cancelled event pages |
| `createEventTxHash` | `String` | No | 66-char `0x` tx hash | On-chain transaction hash from `FairTicket.createEvent` |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Events`**:
- `{ onChainEventId: 1 }` — `unique: true`, partial (`{ onChainEventId: { $type: "number" } }`)
- `{ status: 1, eventDate: 1 }` — Event Listing filters
- `{ city: 1, status: 1, eventDate: 1 }` — City-filtered public listings
- `{ organizerId: 1, createdAt: -1 }` — Organizer Dashboard

---

### 5.4 Collection: `QueueEntries`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Queue entry ID |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Target event |
| `userId` | `ObjectId` | Yes | Ref `Users` | Verified fan |
| `identityHash` | `String` | Yes | 66-char `0x` hex string | Enforces one queue entry per real identity per event |
| `status` | `String` | Yes | `REGISTERED`, `WAITING`, `ACTIVE_TURN`, `BOOKED`, `EXPIRED`, `CANCELLED` | Queue progress status |
| `queuePosition` | `Number` | No | Positive integer (1-based) | Assigned after registration closes via deterministic shuffle |
| `joinedAt` | `Date` | Yes | Default `Date.now` | Registration timestamp |
| `turnActivatedAt` | `Date` | No | — | When the user became `ACTIVE_TURN` |
| `turnExpiresAt` | `Date` | No | — | Deadline to start/complete booking during this turn |
| `activeHoldId` | `ObjectId` | No | Ref `BookingHolds` | Currently attached timed hold, if any |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `QueueEntries`**:
- `{ eventId: 1, userId: 1 }` — `unique: true` (blocks duplicate user registration)
- `{ eventId: 1, identityHash: 1 }` — `unique: true` (blocks duplicate real-person registration)
- `{ eventId: 1, queuePosition: 1 }` — `unique: true, sparse: true` (guarantees unique assigned positions)
- `{ eventId: 1, status: 1, queuePosition: 1 }` — fast lookup of the next `WAITING` user to promote

---

### 5.5 Collection: `BookingHolds`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Hold identifier used in `/booking/:holdId` |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Target event |
| `userId` | `ObjectId` | Yes | Ref `Users` | Fan holding the reservation |
| `identityHash` | `String` | Yes | 66-char `0x` hex string | Identity associated with hold |
| `queueEntryId` | `ObjectId` | Yes | Ref `QueueEntries` | Queue slot that spawned this hold |
| `quantity` | `Number` | Yes | Integer `1` or `2` (`<= MAX_ACTIVE_TICKETS`) | Number of tickets temporarily reserved |
| `unitPricePaise` | `Number` | Yes | Integer `>= 100` | Snapshot of `Events.basePricePaise` |
| `totalPricePaise` | `Number` | Yes | Integer `= quantity * unitPricePaise` | Total integer paise due |
| `status` | `String` | Yes | `ACTIVE`, `CAPTCHA_PASSED`, `PAYMENT_PENDING`, `COMPLETED`, `EXPIRED`, `RELEASED` | Strictly controlled state machine |
| `captchaChallengeId` | `String` | No | UUID | Latest CAPTCHA challenge ID |
| `captchaVerifiedAt` | `Date` | No | — | Timestamp when human check passed |
| `extensionBlockedCount` | `Number` | Yes | Integer, default `0` | Tracks rejected attempts to extend the hold timer |
| `startedAt` | `Date` | Yes | — | Hold creation time (server clock) |
| `expiresAt` | `Date` | Yes | `startedAt + holdDurationMinutes` (immutable once created) | Hard server-side expiry deadline |
| `releasedAt` | `Date` | No | — | Timestamp when hold was expired or manually released |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `BookingHolds`**:
- `{ queueEntryId: 1 }` — `unique: true` (a queue turn can generate at most one hold — prevents timer reset by recreating holds)
- `{ status: 1, expiresAt: 1 }` — scanned by `holdExpiry.job.js` every 10 seconds
- `{ userId: 1, eventId: 1, status: 1 }` — checks for active holds by a user

---

### 5.6 Collection: `Bookings`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Booking ID used in `/booking/:bookingId/confirmation` |
| `bookingReference` | `String` | Yes | Unique string (e.g. `FT-2026-849201`) | Human-readable confirmation code |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Event booked |
| `userId` | `ObjectId` | Yes | Ref `Users` | Buyer account |
| `identityHash` | `String` | Yes | 66-char `0x` hex string | Buyer verified identity hash |
| `walletAddress` | `String` | Yes | Lowercase `0x` address | Buyer MetaMask wallet receiving tickets |
| `holdId` | `ObjectId` | Yes | Ref `BookingHolds`, unique | Originating hold (prevents two bookings from one hold) |
| `paymentId` | `ObjectId` | Yes | Ref `Payments`, unique | Confirmed simulated payment record |
| `quantity` | `Number` | Yes | Integer `1` or `2` | Tickets purchased |
| `totalAmountPaise` | `Number` | Yes | Integer | Exact amount paid in paise |
| `authNonce` | `String` | Yes | 66-char `0x` bytes32 hex, unique | Single-use nonce signed into backend permit for `purchaseTicket` |
| `authExpiry` | `Number` | Yes | Unix timestamp (seconds) | Expiry of the backend ECDSA permit |
| `status` | `String` | Yes | `PENDING_ONCHAIN`, `CONFIRMED`, `FAILED`, `CANCELLED` | Tracks transition from simulated payment to on-chain mint receipt |
| `mintTxHash` | `String` | No | 66-char `0x` tx hash, unique sparse | Confirmed Hardhat transaction hash for `purchaseTicket` |
| `ticketIds` | `[ObjectId]` | Yes | Array of Ref `Tickets`, default `[]` | Minted ticket records |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Bookings`**:
- `{ bookingReference: 1 }` — `unique: true`
- `{ holdId: 1 }` — `unique: true`
- `{ paymentId: 1 }` — `unique: true`
- `{ authNonce: 1 }` — `unique: true`
- `{ mintTxHash: 1 }` — `unique: true, sparse: true`
- `{ userId: 1, createdAt: -1 }` — customer order history

---

### 5.7 Collection: `Payments`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Payment record ID |
| `paymentReference` | `String` | Yes | Unique string (e.g. `SIMPAY-920144`) | Simulated gateway transaction ID |
| `paymentType` | `String` | Yes | `PRIMARY_PURCHASE`, `RESALE_PURCHASE` | Differentiates primary checkout vs official resale checkout |
| `userId` | `ObjectId` | Yes | Ref `Users` | Payer |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Associated event |
| `holdId` | `ObjectId` | No | Ref `BookingHolds` | Populated for `PRIMARY_PURCHASE` |
| `resaleId` | `ObjectId` | No | Ref `Resales` | Populated for `RESALE_PURCHASE` |
| `amountPaise` | `Number` | Yes | Integer `>= 100` | Exact amount charged in integer paise |
| `currency` | `String` | Yes | Fixed `"INR"` | Currency code |
| `method` | `String` | Yes | `SIMULATED_UPI`, `SIMULATED_CARD`, `SIMULATED_NETBANKING` | Demo payment method chosen |
| `status` | `String` | Yes | `INITIATED`, `AUTHORIZED`, `SUCCEEDED`, `FAILED`, `REFUNDED` | Payment lifecycle state |
| `idempotencyKey` | `String` | Yes | Unique string | Prevents accidental double-charge on repeated button clicks |
| `paidAt` | `Date` | No | — | Timestamp when simulated payment succeeded |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Payments`**:
- `{ paymentReference: 1 }` — `unique: true`
- `{ idempotencyKey: 1 }` — `unique: true`
- `{ userId: 1, createdAt: -1 }` — user payment history

---

### 5.8 Collection: `Tickets`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Internal ticket document ID |
| `onChainTicketId` | `Number` | Yes | Positive integer, unique | Exact `uint256 ticketId` emitted by `FairTicket.sol` |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Event this ticket grants access to |
| `onChainEventId` | `Number` | Yes | Positive integer | Mirrors `Events.onChainEventId` for quick contract checks |
| `bookingId` | `ObjectId` | Yes | Ref `Bookings` | Original primary booking |
| `originalBuyerUserId` | `ObjectId` | Yes | Ref `Users` | First buyer |
| `originalOwnerWallet` | `String` | Yes | Lowercase `0x` address | Original minting wallet |
| `currentOwnerUserId` | `ObjectId` | Yes | Ref `Users` | Current verified owner account |
| `currentOwnerWallet` | `String` | Yes | Lowercase `0x` address | Current on-chain owner wallet |
| `currentOwnerIdentityHash` | `String` | Yes | 66-char `0x` hex string | Current owner's identity hash (used for fast backend 2-ticket checks) |
| `originalPricePaise` | `Number` | Yes | Integer `>= 100` | Original primary purchase price in paise |
| `lastSalePricePaise` | `Number` | Yes | Integer `>= 100` | Most recent purchase or official resale price in paise |
| `maxResalePricePaise` | `Number` | Yes | Integer `= floor(originalPricePaise * 110 / 100)` | Immutable ceiling for resale listings |
| `resaleCount` | `Number` | Yes | Integer `>= 0`, default `0` | Number of completed official resales |
| `status` | `String` | Yes | `ACTIVE`, `LISTED_FOR_RESALE`, `USED`, `REVOKED` | Current ticket state |
| `mintTxHash` | `String` | Yes | 66-char `0x` tx hash | On-chain minting transaction hash |
| `redeemedAt` | `Date` | No | — | Gate redemption timestamp |
| `redeemedByStaffId` | `ObjectId` | No | Ref `Users` (`GATE_STAFF`) | Gate staff user who scanned the ticket |
| `redeemTxHash` | `String` | No | 66-char `0x` tx hash | On-chain `redeemTicket` transaction hash |
| `lastSyncedBlock` | `Number` | Yes | Integer `>= 0` | Latest Hardhat block number confirmed for this ticket |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Tickets`**:
- `{ onChainTicketId: 1 }` — `unique: true`
- `{ currentOwnerUserId: 1, status: 1 }` — powers My Tickets page
- `{ currentOwnerIdentityHash: 1, eventId: 1, status: 1 }` — fast backend check for per-identity 2-ticket limit
- `{ eventId: 1, status: 1 }` — Organizer & Gate dashboards

---

### 5.9 Collection: `Resales`

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Resale listing ID |
| `ticketId` | `ObjectId` | Yes | Ref `Tickets` | Listed ticket document |
| `onChainTicketId` | `Number` | Yes | Positive integer | Mirrors `Tickets.onChainTicketId` |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Event for marketplace filtering |
| `sellerUserId` | `ObjectId` | Yes | Ref `Users` | Current owner listing the ticket |
| `sellerWallet` | `String` | Yes | Lowercase `0x` address | Seller's MetaMask wallet |
| `originalPricePaise` | `Number` | Yes | Integer | Original price for buyer transparency |
| `maxAllowedPricePaise` | `Number` | Yes | Integer `= floor(originalPricePaise * 110 / 100)` | Enforced maximum resale cap |
| `askingPricePaise` | `Number` | Yes | Integer `<= maxAllowedPricePaise` | Official listed price in paise |
| `status` | `String` | Yes | `ACTIVE`, `PAYMENT_LOCKED`, `SOLD`, `CANCELLED` | Listing lifecycle |
| `lockedByUserId` | `ObjectId` | No | Ref `Users` | Buyer who temporarily locked listing during simulated payment |
| `lockExpiresAt` | `Date` | No | — | Short 3-minute checkout lock so two buyers cannot pay for the same resale listing simultaneously |
| `buyerUserId` | `ObjectId` | No | Ref `Users` | Final buyer after sale completes |
| `buyerWallet` | `String` | No | Lowercase `0x` address | Final buyer wallet |
| `paymentId` | `ObjectId` | No | Ref `Payments` | Confirmed simulated resale payment |
| `authNonce` | `String` | No | 66-char `0x` bytes32 hex, unique sparse | Single-use permit nonce for `buyResaleTicket` |
| `listTxHash` | `String` | Yes | 66-char `0x` tx hash | On-chain `listForResale` transaction hash |
| `cancelTxHash` | `String` | No | 66-char `0x` tx hash | On-chain `cancelResaleListing` transaction hash |
| `saleTxHash` | `String` | No | 66-char `0x` tx hash | On-chain `buyResaleTicket` transaction hash |
| `soldAt` | `Date` | No | — | Completion timestamp |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `Resales`**:
- `{ onChainTicketId: 1, status: 1 }` — partial unique index (`partialFilterExpression: { status: { $in: ["ACTIVE", "PAYMENT_LOCKED"] } }`) guaranteeing a ticket can only have ONE active resale listing at a time
- `{ eventId: 1, status: 1, askingPricePaise: 1 }` — powers Official Resale Marketplace sorting/filtering
- `{ authNonce: 1 }` — `unique: true, sparse: true`

---

### 5.10 Collection: `TicketHistory`

Append-only off-chain mirror of every confirmed on-chain lifecycle event for fast ownership and price history rendering.

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | History entry ID |
| `ticketId` | `ObjectId` | Yes | Ref `Tickets` | Target ticket |
| `onChainTicketId` | `Number` | Yes | Positive integer | Mirrors `Tickets.onChainTicketId` |
| `eventId` | `ObjectId` | Yes | Ref `Events` | Target event |
| `action` | `String` | Yes | `MINTED`, `LISTED_FOR_RESALE`, `RESALE_CANCELLED`, `RESOLD`, `REDEEMED` | Lifecycle transition type |
| `fromWallet` | `String` | No | Lowercase `0x` address (`0x0000...0000` for `MINTED`) | Previous owner wallet |
| `toWallet` | `String` | No | Lowercase `0x` address | New owner wallet |
| `pricePaise` | `Number` | Yes | Integer `>= 0` (`0` for cancel/redeem) | Sale or listing price in integer paise |
| `priceDeltaPercent` | `Number` | No | Integer (e.g., `10` for +10% above original) | Integer percentage variation vs original price |
| `txHash` | `String` | Yes | 66-char `0x` tx hash | On-chain transaction reference |
| `blockNumber` | `Number` | Yes | Integer `>= 0` | Hardhat block number |
| `occurredAt` | `Date` | Yes | — | Block timestamp |
| `createdAt` | `Date` | Auto | — | Record creation timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `TicketHistory`**:
- `{ onChainTicketId: 1, blockNumber: 1, action: 1, txHash: 1 }` — `unique: true` (prevents duplicate sync writes)
- `{ ticketId: 1, occurredAt: 1 }` — renders chronological ownership & price history timelines

---

### 5.11 Collection: `SecurityLogs`

Stores all blocked attacks, policy violations, scalping attempts (especially rejected transactions that emit no blockchain events), state mismatches, and Trust Guardian risk alerts.

| Field | Type | Required | Enum / Constraints | Purpose |
| --- | --- | --- | --- | --- |
| `_id` | `ObjectId` | Auto | Primary key | Security log ID |
| `eventType` | `String` | Yes | `AUTH_LOGIN_FAILED`, `AUTH_ACCOUNT_LOCKED`, `AUTH_LOGOUT`, `OTP_SENT`, `OTP_FAILED`, `OTP_VERIFIED`, `OTP_SEND_LIMIT_HIT`, `OTP_BRUTE_FORCE`, `IDENTITY_SUBMITTED`, `IDENTITY_VERIFIED`, `IDENTITY_REJECTED`, `REAL_ID_BLOCKED`, `IDENTITY_ATTEMPT_LIMIT`, `IDENTITY_ALREADY_REGISTERED`, `DUPLICATE_IDENTITY_ATTEMPT`, `DUPLICATE_IDENTITY_REPEATED`, `UNVERIFIED_ACCESS_ATTEMPT`, `WALLET_CHALLENGE_ISSUED`, `WALLET_LINKED`, `WALLET_SIGNATURE_INVALID`, `WALLET_CHALLENGE_LOCKED`, `WALLET_ALREADY_LINKED_ATTEMPT`, `WALLET_CHALLENGE_LIMIT`, `DEV_WALLET_UNLINKED`, `EVENT_CREATED`, `EVENT_UPDATED`, `EVENT_PUBLISHED`, `EVENT_CANCELLED`, `EVENT_ACCESS_DENIED`, `SIGNATURE_REPLAY_ATTEMPT`, `CAPTCHA_FAILED`, `HOLD_EXTENSION_ATTEMPT`, `TICKET_LIMIT_EXCEEDED`, `RESALE_CAP_VIOLATION`, `SCALPING_ATTEMPT_5X`, `DIRECT_TRANSFER_ATTEMPT`, `QR_INVALID_SIGNATURE`, `QR_EXPIRED`, `QR_REPLAY_SCAN`, `TICKET_ALREADY_USED`, `STATE_MISMATCH`, `TRUST_GUARDIAN_WARNING`, `TRUST_GUARDIAN_BLOCKED`, `UNAUTHORIZED_ACCESS` | Categorizes security event |
| `severity` | `String` | Yes | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | Drives Admin Dashboard alert badges |
| `userId` | `ObjectId` | No | Ref `Users` | Offending or affected user if authenticated |
| `walletAddress` | `String` | No | Lowercase `0x` address | Wallet involved, if any |
| `eventId` | `ObjectId` | No | Ref `Events` | Event involved, if any |
| `ticketId` | `ObjectId` | No | Ref `Tickets` | Ticket involved, if any |
| `attemptedPricePaise` | `Number` | No | Integer | Populated for `RESALE_CAP_VIOLATION` and `SCALPING_ATTEMPT_5X` |
| `allowedMaxPricePaise` | `Number` | No | Integer | Cap value at time of violation |
| `ipAddress` | `String` | No | String | Request client IP |
| `userAgent` | `String` | No | String | Request browser/client agent |
| `details` | `Mixed` | Yes | Structured JSON object (no PII/secrets) | Rule codes, mismatch fields, or diagnostic metadata |
| `createdAt` | `Date` | Auto | — | Incident timestamp |
| `updatedAt` | `Date` | Auto | — | Record update timestamp |

**Indexes on `SecurityLogs`**:
- `{ createdAt: -1 }` — Admin Dashboard recent feed
- `{ eventType: 1, severity: 1, createdAt: -1 }` — filtered security audit queries
- `{ userId: 1, createdAt: -1 }` — user-level abuse investigation

### 5.12 MongoDB and Blockchain Consistency Rules

| Domain | Source of Truth | Secondary Mirror | How Mismatches Are Detected and Handled |
| --- | --- | --- | --- |
| Identity PII, Queue, Holds, CAPTCHA, Payments, SecurityLogs | **MongoDB** | None (off-chain only) | Protected by atomic MongoDB updates and unique indexes. |
| Wallet-to-`identityHash` link | **Blockchain (`FairTicket.sol`)** | `Users.walletAddress`, `Users.identityHash` | Backend verifies `getIdentityForWallet(wallet) === user.identityHash` before issuing any purchase/resale permit. |
| Ticket Ownership, `USED` Status, Active Resale Price, Active Ticket Count | **Blockchain (`FairTicket.sol`)** | `Tickets`, `Resales`, `TicketHistory` | 1) After every MetaMask tx (`purchaseTicket`, `listForResale`, `cancelResaleListing`, `buyResaleTicket`), the frontend submits `txHash` to a backend confirmation endpoint; the backend fetches the Hardhat receipt directly, verifies emitted events, and updates MongoDB strictly from verified on-chain logs.<br>2) During **Gate Verification** (`F8`/`F9`) and **Ticket Inspection**, the backend reads `getTicketDetails(onChainTicketId)` live from Hardhat and compares `currentOwner`, `isUsed`, and `eventId` against MongoDB. If any field disagrees, entry is denied (`BLOCKCHAIN_MISMATCH`) and a `CRITICAL` `STATE_MISMATCH` log is saved to `SecurityLogs`. |

---

## 6. Smart contract design

### 6.1 Contract Overview & Demo Mode Scope

- **Contract File**: `blockchain/contracts/FairTicket.sol`
- **Solidity Version**: `^0.8.24`
- **Inherited OpenZeppelin Contracts**: `AccessControl`, `ReentrancyGuard`, `ECDSA`, `MessageHashUtils`
- **Important Demo Mode Declaration**: Payments in FairTicket are **simulated off-chain in INR paise**. The smart contract does **not** collect ETH (`msg.value` is not required and functions are non-payable). Instead, `FairTicket.sol` acts as an authoritative, tamper-proof **ownership, ticket-limit, resale-cap, price-history, and redemption ledger**. To prevent anyone from calling `purchaseTicket` or `buyResaleTicket` directly on Hardhat without completing the queue, CAPTCHA, and simulated INR payment, both functions verify a single-use cryptographic permit signed by the backend's `VERIFIER_ROLE` key.

### 6.2 Access Control Roles

| Role Constant | Holder in Local Demo | Permitted Functions |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Deployer account (Hardhat Account `#0`) | Role management (`grantRole`, `revokeRole`) |
| `VERIFIER_ROLE` | Backend Verifier signer (Hardhat Account `#1`) | `verifyWallet`, `revokeWallet`, and signing off-chain ECDSA permits for `purchaseTicket` and `buyResaleTicket` |
| `ORGANIZER_ROLE` | Backend Organizer signer (Hardhat Account `#2`) | `createEvent`, `setEventStatus` |
| `GATE_ROLE` | Backend Gate signer (Hardhat Account `#3`) | `redeemTicket` |
| **Verified Fan (`msg.sender`)** | Any MetaMask wallet verified via `verifyWallet` | `purchaseTicket`, `listForResale`, `cancelResaleListing`, `buyResaleTicket` |

### 6.3 On-Chain Constants, Enums, and Structs

```solidity
uint256 public constant MAX_ACTIVE_TICKETS = 2;
uint256 public constant RESALE_CAP_PERCENT = 110;

enum HistoryAction {
    MINTED,
    LISTED_FOR_RESALE,
    RESALE_CANCELLED,
    RESOLD,
    REDEEMED
}

struct EventRecord {
    uint256 eventId;
    uint256 basePricePaise;
    uint256 totalSupply;
    uint256 mintedCount;
    uint256 maxPerIdentity;
    bool isActive;
    bool exists;
}

struct TicketRecord {
    uint256 ticketId;
    uint256 eventId;
    address originalOwner;
    address currentOwner;
    bytes32 currentOwnerIdentityHash;
    uint256 originalPricePaise;
    uint256 lastSalePricePaise;
    bool isListedForResale;
    bool isUsed;
    uint256 mintedAt;
    uint256 redeemedAt;
}

struct ResaleListing {
    uint256 ticketId;
    address seller;
    uint256 askingPricePaise;
    bool isActive;
    uint256 listedAt;
}

struct TicketHistoryRecord {
    HistoryAction action;
    address fromWallet;
    address toWallet;
    uint256 pricePaise;
    uint256 timestamp;
}
```

### 6.4 Key State Mappings

- `mapping(uint256 => EventRecord) private _events;`
- `mapping(address => bytes32) private _walletToIdentity;`
- `mapping(bytes32 => mapping(uint256 => uint256)) private _activeTicketCount;` (`identityHash => eventId => count`)
- `mapping(bytes32 => mapping(uint256 => uint256)) private _redeemedTicketCount;` (`identityHash => eventId => count`)
- `mapping(uint256 => TicketRecord) private _tickets;`
- `mapping(uint256 => ResaleListing) private _resaleListings;`
- `mapping(uint256 => TicketHistoryRecord[]) private _ticketHistory;`
- `mapping(bytes32 => bool) public usedAuthNonces;`
- `uint256 private _nextTicketId = 1;`

### 6.5 How the 2-Ticket Limit Works Across Multiple Wallets

1. When a fan completes phone OTP, simulated KYC, and MetaMask signature proof, the backend computes their salted `identityHash` (`bytes32`) and calls `verifyWallet(fanWallet, identityHash)`.
2. `_walletToIdentity[fanWallet]` is set to `identityHash`.
3. Even if the same person later links a second wallet (`fanWallet2`) to the same `identityHash`, `_walletToIdentity[fanWallet2]` resolves to the **same `identityHash`**.
4. Inside `purchaseTicket` and `buyResaleTicket`, the contract looks up `bytes32 idHash = _walletToIdentity[msg.sender]` and requires:
   `_activeTicketCount[idHash][eventId] + _redeemedTicketCount[idHash][eventId] + quantity <= eventRecord.maxPerIdentity` (which is `2`).
5. On a successful official resale (`buyResaleTicket`):
   - Seller's `_activeTicketCount[sellerIdHash][eventId]` is decremented by `1`.
   - Buyer's `_activeTicketCount[buyerIdHash][eventId]` is incremented by `1`.
   - Ticket's `currentOwner` and `currentOwnerIdentityHash` update to the buyer.
6. On gate redemption (`redeemTicket`):
   - `_activeTicketCount[ownerIdHash][eventId]` is decremented by `1` (the ticket is no longer active/resaleable).
   - `_redeemedTicketCount[ownerIdHash][eventId]` is incremented by `1` (so a fan cannot redeem 2 tickets at the door and immediately purchase 2 more for the same event).

### 6.6 How Direct Transfers Are Blocked & How the 110% Cap Is Computed

- **Direct Transfers Blocked**: `FairTicket` does **not** implement unconstrained ERC-721 `transferFrom` / `safeTransferFrom`. In addition, it exposes `transferTicket(uint256 ticketId, address to)` which **unconditionally reverts** with `DirectTransferBlocked()`. Ownership can only change through `buyResaleTicket`.
- **Integer 110% Price Cap**:
  ```solidity
  function calculateMaxResalePrice(uint256 originalPricePaise) public pure returns (uint256) {
      return (originalPricePaise * RESALE_CAP_PERCENT) / 100;
  }
  ```
  In `listForResale(uint256 ticketId, uint256 askingPricePaise)`, if `askingPricePaise == 0` it reverts with `InvalidPrice()`, and if `askingPricePaise > calculateMaxResalePrice(ticket.originalPricePaise)` it reverts with `ResalePriceCapExceeded(askingPricePaise, maxAllowed)`. Because `originalPricePaise` and `askingPricePaise` are `uint256` integer paise (`Rs 5,000 = 500000`), `(500000 * 110) / 100 == 550000` with zero floating-point inaccuracy.

### 6.7 Exact Function Signatures

| Function Signature | Access | Behavior & Return Value |
| --- | --- | --- |
| `createEvent(uint256 eventId, uint256 basePricePaise, uint256 totalSupply, uint256 maxPerIdentity) external` | `ORGANIZER_ROLE` | Registers event if `!exists`, `basePricePaise > 0`, `totalSupply > 0`, `1 <= maxPerIdentity <= MAX_ACTIVE_TICKETS`. Emits `EventCreated`. |
| `setEventStatus(uint256 eventId, bool isActive) external` | `ORGANIZER_ROLE` | Enables or disables primary booking on-chain. Emits `EventStatusUpdated`. |
| `verifyWallet(address wallet, bytes32 identityHash) external` | `VERIFIER_ROLE` | Links `wallet` to non-zero `identityHash`. Emits `WalletVerified`. |
| `revokeWallet(address wallet) external` | `VERIFIER_ROLE` | Clears `_walletToIdentity[wallet] = bytes32(0)`. Emits `WalletRevoked`. |
| `checkTicketLimit(bytes32 identityHash, uint256 eventId, uint256 additionalQuantity) external view returns (bool allowed, uint256 currentActive, uint256 currentRedeemed, uint256 maxAllowed)` | Public view | Returns whether adding `additionalQuantity` stays within `event.maxPerIdentity` (`2`). |
| `purchaseTicket(uint256 eventId, uint256 quantity, bytes32 authNonce, uint256 authExpiry, bytes calldata backendSignature) external nonReentrant returns (uint256[] memory ticketIds)` | Verified Fan | Checks wallet verified, event active, `quantity >= 1`, supply available, per-identity ticket cap, unused `authNonce`, `block.timestamp <= authExpiry`, and valid `VERIFIER_ROLE` ECDSA signature over `(address(this), block.chainid, "PURCHASE", msg.sender, eventId, quantity, authNonce, authExpiry)`. Marks nonce used, mints `quantity` tickets, increments `_activeTicketCount`, records `MINTED` history, emits `TicketPurchased` for each ticket. |
| `listForResale(uint256 ticketId, uint256 askingPricePaise) external` | Ticket Owner | Checks caller is `currentOwner`, wallet is verified, ticket `!isUsed`, `!isListedForResale`, `askingPricePaise > 0`, and `askingPricePaise <= calculateMaxResalePrice(originalPricePaise)`. Creates listing, marks `isListedForResale = true`, appends `LISTED_FOR_RESALE` history, emits `TicketListedForResale`. |
| `cancelResaleListing(uint256 ticketId) external` | Ticket Owner | Checks caller is `currentOwner` and `isListedForResale`. Clears listing, appends `RESALE_CANCELLED` history, emits `ResaleListingCancelled`. |
| `buyResaleTicket(uint256 ticketId, bytes32 authNonce, uint256 authExpiry, bytes calldata backendSignature) external nonReentrant` | Verified Fan | Checks buyer wallet verified, listing active, buyer != seller, buyer `identityHash != sellerIdHash` (prevents wash-trading to self), ticket `!isUsed`, buyer within 2-ticket limit for event, unused `authNonce`, `block.timestamp <= authExpiry`, and valid `VERIFIER_ROLE` signature over `(address(this), block.chainid, "RESALE_BUY", msg.sender, ticketId, listing.askingPricePaise, authNonce, authExpiry)`. Updates active counts, transfers ownership, updates `lastSalePricePaise`, clears listing, appends `RESOLD` history, emits `TicketResold`. |
| `transferTicket(uint256 ticketId, address to) external pure` | Anyone | Always reverts with `DirectTransferBlocked()`. |
| `redeemTicket(uint256 ticketId) external` | `GATE_ROLE` | Checks ticket exists, `!isUsed`. If listed for resale, auto-clears listing. Sets `isUsed = true`, `redeemedAt = block.timestamp`, decrements `_activeTicketCount`, increments `_redeemedTicketCount`, appends `REDEEMED` history, emits `TicketRedeemed`. |
| `getTicketOwner(uint256 ticketId) external view returns (address)` | Public view | Reverts `TicketNotFound` if missing; returns `currentOwner`. |
| `getTicketDetails(uint256 ticketId) external view returns (TicketRecord memory)` | Public view | Returns complete `TicketRecord` struct. |
| `getTicketHistory(uint256 ticketId) external view returns (TicketHistoryRecord[] memory)` | Public view | Returns full ordered array of lifecycle and price events. |
| `getResaleListing(uint256 ticketId) external view returns (ResaleListing memory)` | Public view | Returns current resale listing struct. |
| `getEventDetails(uint256 eventId) external view returns (EventRecord memory)` | Public view | Returns `EventRecord` struct. |
| `getActiveTicketCount(bytes32 identityHash, uint256 eventId) external view returns (uint256)` | Public view | Returns `_activeTicketCount[identityHash][eventId]`. |
| `getIdentityForWallet(address wallet) external view returns (bytes32)` | Public view | Returns `_walletToIdentity[wallet]`. |
| `calculateMaxResalePrice(uint256 originalPricePaise) public pure returns (uint256)` | Public pure | Returns `(originalPricePaise * 110) / 100`. |

### 6.8 Events and Custom Errors

**Events**:
- `event EventCreated(uint256 indexed eventId, uint256 basePricePaise, uint256 totalSupply, uint256 maxPerIdentity);`
- `event EventStatusUpdated(uint256 indexed eventId, bool isActive);`
- `event WalletVerified(address indexed wallet, bytes32 indexed identityHash);`
- `event WalletRevoked(address indexed wallet, bytes32 indexed previousIdentityHash);`
- `event TicketPurchased(uint256 indexed ticketId, uint256 indexed eventId, address indexed buyer, bytes32 identityHash, uint256 pricePaise);`
- `event TicketListedForResale(uint256 indexed ticketId, uint256 indexed eventId, address indexed seller, uint256 askingPricePaise, uint256 maxAllowedPricePaise);`
- `event ResaleListingCancelled(uint256 indexed ticketId, address indexed seller);`
- `event TicketResold(uint256 indexed ticketId, uint256 indexed eventId, address indexed seller, address buyer, uint256 salePricePaise);`
- `event TicketRedeemed(uint256 indexed ticketId, uint256 indexed eventId, address indexed owner, uint256 redeemedAt);`

**Custom Errors**:
- `error EventAlreadyExists(uint256 eventId);`
- `error EventNotFound(uint256 eventId);`
- `error EventNotActive(uint256 eventId);`
- `error InvalidEventParameters();`
- `error WalletNotVerified(address wallet);`
- `error InvalidIdentityHash();`
- `error InvalidQuantity();`
- `error InsufficientSupply(uint256 requested, uint256 remaining);`
- `error TicketLimitExceeded(bytes32 identityHash, uint256 eventId, uint256 currentTotal, uint256 maxAllowed);`
- `error AuthPermitExpired(uint256 authExpiry);`
- `error AuthNonceAlreadyUsed(bytes32 authNonce);`
- `error InvalidBackendSignature();`
- `error TicketNotFound(uint256 ticketId);`
- `error NotTicketOwner(address caller, address actualOwner);`
- `error TicketAlreadyUsed(uint256 ticketId);`
- `error TicketAlreadyListed(uint256 ticketId);`
- `error TicketNotListed(uint256 ticketId);`
- `error InvalidPrice();`
- `error ResalePriceCapExceeded(uint256 askingPricePaise, uint256 maxAllowedPricePaise);`
- `error CannotBuyOwnTicket();`
- `error DirectTransferBlocked();`

---

## 7. API design

All routes are mounted under `/api/v1` and return `{ success, data, error }`. "Public" means no JWT required; "Authenticated" means any valid JWT (`CUSTOMER`, `ORGANIZER`, `ADMIN`, `GATE_STAFF`); "Verified Customer" means `CUSTOMER` with `phoneVerified && identityVerified && walletLinked`.

### 7.1 Auth & Profile (F1)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Public | `{ fullName, email, phone, password }` | `{ token, user }` | F1 |
| `POST` | `/api/v1/auth/login` | Public | `{ email, password }` | `{ token, user }` | F1 |
| `GET` | `/api/v1/auth/me` | Authenticated | None | `{ user, verificationSummary }` | F1 |
| `POST` | `/api/v1/auth/logout` | Authenticated | None | `{ loggedOut: true }` | F1 |

### 7.2 Verification: Phone OTP, Mock KYC & Wallet Auth (F1)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/verification/otp/request` | `CUSTOMER` | None (always uses account phone; unexpected fields rejected) | `{ maskedPhone, expiresAt, expiresInSeconds, resendAfterSeconds, attemptsAllowed, demoOtp? }` (`demoOtp` included only when `DEMO_SHOW_OTP=true` and `NODE_ENV !== "production"`) | F1 |
| `POST` | `/api/v1/verification/otp/verify` | `CUSTOMER` | `{ otpCode }` | `{ phoneVerified: true, user }` | F1 |
| `POST` | `/api/v1/verification/identity/submit` | `CUSTOMER` | `{ documentType, documentNumber, fullNameOnDocument, consent }` (demo IDs only; never real IDs or DOB) | `{ identityStatus: "VERIFIED", verifiedAt }` (never returns `identityHash` or raw document data) | F1 |
| `GET` | `/api/v1/verification/status` | Authenticated | None | `{ phoneVerified, identityVerified, walletLinked, walletAddress, phone: { verified, maskedPhone }, identity: { status, verifiedAt, attemptsRemaining, reasonCode }, wallet: { linked, walletAddress, address, linkedAt }, user }` (never returns `identityHash`, `otpHash`, or wallet challenge nonces) | F1 |
| `POST` | `/api/v1/wallet/nonce` | Verified-identity `CUSTOMER` (`phoneVerified` + `identityStatus == VERIFIED`) | `{ walletAddress }` (rejects unknown fields) | `{ message, walletAddress (checksummed), chainId, nonce, issuedAt, expiresAt, expiresInSeconds }` | F1 |
| `POST` | `/api/v1/wallet/link` | Verified-identity `CUSTOMER` (`phoneVerified` + `identityStatus == VERIFIED`) | `{ walletAddress, signature }` (rejects `message`, `nonce`, and any other unknown fields) | `{ walletAddress (lowercase), linkedAt }` (MongoDB link in Prompt 9; on-chain `verifyWallet` added in Prompts 15–17) | F1 |

**Deterministic Wallet Challenge Message Format (`backend/src/services/wallet/challengeMessage.js`)**:

```text
{domain} wants you to link this wallet to your FairTicket account.

Wallet: {checksumAddress}

This signature does not cost gas, does not move funds and does not give anyone permission to spend your assets.

Chain ID: {chainId}
Nonce: {nonce}
Issued At: {issuedAt ISO}
Expires At: {expiresAt ISO}
```

The server builds this exact plain-text message when issuing a challenge and rebuilds it solely from stored `VerificationRecords` fields during verification (`personal_sign` / `ethers.verifyMessage`). Clients must never supply the message to be verified.

### 7.3 Event Management (F2, Organizer)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/events` | Public (read limiter) | Query: `?page=1&limit=12&city=&q=` (non-DRAFT, non-CANCELLED only) | `{ items, page, limit, total, totalPages }` (public whitelist only; zero organizerId/contact/internal counters) | F2 |
| `GET` | `/api/v1/events/mine` | `ORGANIZER` | Query: `?page=1&limit=12&status=` (registered before `/:eventId`) | `{ items, page, limit, total, totalPages }` (owner projection with inventory counters) | F2 |
| `GET` | `/api/v1/events/:eventId` | Public (optional auth) | None (`DRAFT` visible only to owning `ORGANIZER` or `ADMIN`; `CANCELLED` visible to all) | `{ event }` (public whitelist; `cancelReason` included when `CANCELLED`) | F2 |
| `POST` | `/api/v1/events` | `ORGANIZER` (write limiter) | `{ title, description?, venueName, city, eventDate, registrationOpenAt, registrationCloseAt, totalTickets, basePricePaise, maxTicketsPerIdentity?, holdDurationMinutes?, category?, artist? }` | `{ event }` (`DRAFT`, owner projection; on-chain `createEvent` added in Prompts 15–17) | F2 |
| `PATCH` | `/api/v1/events/:eventId` | Owning `ORGANIZER` (write limiter) | Partial allowed fields while `DRAFT`; `description` only after publishing (`409 EVENT_LOCKED` otherwise) | `{ event }` (owner projection) | F2 |
| `POST` | `/api/v1/events/:eventId/publish` | Owning `ORGANIZER` (write limiter) | None (atomic `DRAFT -> PUBLISHED` when `registrationCloseAt > now`) | `{ event }` (owner projection) | F2 |
| `POST` | `/api/v1/events/:eventId/cancel` | Owning `ORGANIZER`, `ADMIN` (write limiter) | `{ reason }` (plain text, 3–300 chars; blocked with `409 EVENT_HAS_BOOKINGS` if bookings/tickets exist) | `{ event }` (owner projection) | F2 |

### 7.4 Randomized Verified Queue (F2)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/events/:eventId/queue/join` | Verified `CUSTOMER` | None | `{ queueEntry }` | F2 |
| `GET` | `/api/v1/events/:eventId/queue/status` | Authenticated | None | `{ eventStatus, totalRegistered, queueShuffleSeed, queueShuffleHash, myEntry, activeHold }` | F2 |
| `POST` | `/api/v1/events/:eventId/queue/allocate` | `ORGANIZER`, `ADMIN` | None | `{ allocatedCount, queueShuffleSeed, queueShuffleHash, activatedUsersCount }` | F2 |
| `GET` | `/api/v1/events/:eventId/queue/audit` | Public | None | `{ eventId, queueShuffleSeed, queueShuffleHash, orderedAnonymousEntries }` (contains hashed entry IDs and positions, zero PII) | F2 |

### 7.5 Timed Booking Hold, CAPTCHA & Simulated Payment (F3, F4, F5)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/holds` | Verified `CUSTOMER` | `{ eventId, quantity }` | `{ hold, serverTime }` | F3, F4 |
| `GET` | `/api/v1/holds/:holdId` | Verified `CUSTOMER` | None | `{ hold, event, remainingSeconds, serverTime }` | F3 |
| `POST` | `/api/v1/holds/:holdId/release` | Verified `CUSTOMER` | None | `{ hold, released: true }` | F3 |
| `POST` | `/api/v1/holds/:holdId/extend` | Verified `CUSTOMER` | None | Always returns HTTP 403 `HOLD_EXTENSION_FORBIDDEN` and logs `HOLD_EXTENSION_ATTEMPT` | F3 |
| `POST` | `/api/v1/captcha/challenge` | Verified `CUSTOMER` | `{ holdId }` | `{ challengeId, promptText, expiresAt }` | F3 |
| `POST` | `/api/v1/captcha/verify` | Verified `CUSTOMER` | `{ holdId, challengeId, answer }` | `{ captchaPassed: true, hold }` | F3 |
| `POST` | `/api/v1/bookings/pay` | Verified `CUSTOMER` | `{ holdId, method, idempotencyKey }` | `{ booking, payment, onChainTxRequest: { to, data, value, expectedIntent }, authPermit: { authNonce, authExpiry, backendSignature } }` | F3, F4 |
| `POST` | `/api/v1/bookings/:bookingId/confirm-onchain` | Verified `CUSTOMER` | `{ txHash }` | `{ booking, tickets }` | F5 |
| `GET` | `/api/v1/bookings/:bookingId` | Authenticated (owner or `ADMIN`) | None | `{ booking, event, payment, tickets }` | F3, F5 |

### 7.6 Tickets, Ownership & Price History, Dynamic QR (F5, F7, F9, F10)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/tickets/my` | Authenticated | Query: `?status=` | `{ tickets }` | F5, F10 |
| `GET` | `/api/v1/tickets/:ticketId` | Authenticated | None | `{ ticket, event, activeResale, onChainConsistency: { matched, checkedAt } }` | F5, F8 |
| `GET` | `/api/v1/tickets/:ticketId/ownership-history` | Authenticated | None | `{ ticket, ownershipTimeline, onChainHistory }` | F5, F10 |
| `GET` | `/api/v1/tickets/:ticketId/price-history` | Authenticated | None | `{ ticket, originalPricePaise, maxResalePricePaise, priceTimeline, percentageVariation, scalpingWarningsCount }` | F7, F10 |
| `POST` | `/api/v1/tickets/:ticketId/qr-token` | Verified `CUSTOMER` (current owner only) | None | `{ qrPayloadString, issuedAt, expiresAt, ttlSeconds: 30 }` | F9 |

### 7.7 Official Resale Marketplace & Scalping Detection (F6, F7)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/resales` | Public | Query: `?eventId=&sort=price_asc\|newest` | `{ resales, total }` | F6 |
| `POST` | `/api/v1/resales/prepare-list` | Verified `CUSTOMER` | `{ ticketId, askingPricePaise }` | On valid price: `{ allowed: true, maxAllowedPricePaise, onChainTxRequest }`. On violation: HTTP 422 `RESALE_CAP_EXCEEDED` or `SCALPING_BLOCKED` (with `scalpingWarning: true` if `>= 5x`) + writes `SecurityLogs` | F6, F7 |
| `POST` | `/api/v1/resales/confirm-list` | Verified `CUSTOMER` | `{ ticketId, askingPricePaise, txHash }` | `{ resale, ticket }` | F6 |
| `POST` | `/api/v1/resales/:resaleId/prepare-cancel` | Verified `CUSTOMER` (seller) | None | `{ onChainTxRequest }` | F6 |
| `POST` | `/api/v1/resales/:resaleId/confirm-cancel` | Verified `CUSTOMER` (seller) | `{ txHash }` | `{ resale, ticket }` | F6 |
| `POST` | `/api/v1/resales/:resaleId/pay` | Verified `CUSTOMER` (buyer) | `{ method, idempotencyKey }` | `{ resale, payment, onChainTxRequest, authPermit: { authNonce, authExpiry, backendSignature } }` | F4, F6 |
| `POST` | `/api/v1/resales/:resaleId/confirm-buy` | Verified `CUSTOMER` (buyer) | `{ txHash }` | `{ resale, ticket }` | F6, F7 |

### 7.8 Gate Entry Verification & One-Time Redemption (F8, F9)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/gate/verify` | `GATE_STAFF`, `ADMIN` | `{ qrPayloadString, eventId }` | `{ valid, checks: { qrSignatureValid, notExpired, ticketExists, eventMatches, notUsed, ownerMatchesChain, dbMatchesChain }, ticketSummary, failureCode }` | F8, F9 |
| `POST` | `/api/v1/gate/redeem` | `GATE_STAFF`, `ADMIN` | `{ qrPayloadString, eventId }` | `{ redeemed: true, ticketId, onChainTicketId, redeemedAt, redeemTxHash }` | F9 |
| `GET` | `/api/v1/gate/recent-scans` | `GATE_STAFF`, `ADMIN` | Query: `?eventId=&limit=25` | `{ scans, stats: { totalAdmitted, rejectedCount } }` | F8, F9 |

### 7.9 FairTicket Trust Guardian (Standout Feature)

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/v1/trust-guardian/analyze` | Authenticated | `{ transaction: { from, to, data, value }, expectedIntent: { actionType, expectedEventId, expectedTicketId, expectedAmountPaise, expectedRecipient } }` | Complete Trust Guardian Report JSON (defined in Section 11.2) | Trust Guardian |
| `POST` | `/api/v1/trust-guardian/decision` | Authenticated | `{ analysisId, userDecision: "APPROVED" \| "CANCELLED", riskLevel, ruleCodes }` | `{ recorded: true }` (logs `TRUST_GUARDIAN_WARNING` or `TRUST_GUARDIAN_BLOCKED` to `SecurityLogs` when non-`SAFE`) | Trust Guardian |
| `GET` | `/api/v1/trust-guardian/trusted-contracts` | Public | None | `{ chainId: 31337, contracts: [{ name, address, verified: true }] }` | Trust Guardian |

### 7.10 Admin & Organizer Dashboards

| Method | Path | Allowed Roles | Request Body / Query | Response `data` | Feature |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/admin/overview` | `ADMIN` | None | `{ metrics: { totalUsers, verifiedUsers, totalEvents, totalTicketsMinted, totalResalesCompleted, totalTicketsRedeemed, blockedScalpingAttempts, criticalSecurityEvents }, recentSecurityLogs }` | Admin |
| `GET` | `/api/v1/admin/security-logs` | `ADMIN` | Query: `?eventType=&severity=&page=1&limit=20` | `{ logs, total, page, totalPages }` | F7, Admin |
| `GET` | `/api/v1/admin/users` | `ADMIN` | Query: `?role=&status=&search=` | `{ users, total }` | Admin |
| `PATCH` | `/api/v1/admin/users/:userId/status` | `ADMIN` | `{ accountStatus }` | `{ user }` | Admin |
| `GET` | `/api/v1/organizer/overview` | `ORGANIZER`, `ADMIN` | None | `{ events, totals: { ticketsSold, primaryRevenuePaise, activeResales, redeemedCount } }` | Organizer |
| `GET` | `/api/v1/organizer/events/:eventId/analytics` | `ORGANIZER`, `ADMIN` | None | `{ event, queueStats, holdStats, ticketStats, resaleStats, scalpingAttemptsBlocked }` | Organizer |

---

## 8. Frontend pages and routes

Design system direction applied across all 17 pages: crisp white and off-white backgrounds, light/sky blue primary actions, deep navy headings and body text, soft gray section containers, minimal emerald verified badges, zero neon/cyberpunk aesthetics, responsive mobile-first cards.

| # | Page Name | URL Path | Allowed Roles | API Routes Used | Main UI Parts |
| --- | --- | --- | --- | --- | --- |
| 1 | **Home** | `/` | Public | `GET /api/v1/events` | Clean commercial hero with tagline, 3 anti-scalping pillar cards, featured upcoming events grid, "How FairTicket Works" 4-step strip |
| 2 | **Register/Login** | `/auth` | Public | `POST /api/v1/auth/register`, `POST /api/v1/auth/login` | Tabbed Sign In / Create Account card, validation feedback, role-aware redirect after login |
| 3 | **Identity Verification** | `/verify-identity` | Authenticated | `GET /api/v1/verification/status`, `POST /api/v1/verification/otp/request`, `POST /api/v1/verification/otp/verify`, `POST /api/v1/verification/identity/submit`, `POST /api/v1/wallet/nonce`, `POST /api/v1/wallet/link` | 3-step horizontal progress bar (Phone OTP -> Mock KYC -> MetaMask Wallet Proof), clear explanation banner distinguishing the 3 steps, simulated demo OTP notice, duplicate-identity rejection alert |
| 4 | **Event Listing** | `/events` | Public | `GET /api/v1/events` | Search bar, city/category/status filter controls, responsive event cards with INR base price, resale cap badge, and registration window status |
| 5 | **Event Details** | `/events/:eventId` | Public | `GET /api/v1/events/:eventId`, `POST /api/v1/events/:eventId/queue/join` | Event banner info, venue/date metadata, primary price + 110% max resale cap disclosure, remaining inventory counter, per-identity ticket count indicator, "Join Verified Queue" CTA (prompts verification if incomplete) |
| 6 | **Randomized Queue** | `/events/:eventId/queue` | Verified `CUSTOMER` | `GET /api/v1/events/:eventId/queue/status`, `GET /api/v1/events/:eventId/queue/audit`, `POST /api/v1/holds` | Live polling status card (`REGISTERED` / `WAITING` / `ACTIVE_TURN`), assigned position badge, auditable shuffle seed & hash inspector drawer, quantity selector (1 or 2) + "Start 5-Min Booking Hold" button when turn activates |
| 7 | **Timed Booking and CAPTCHA** | `/booking/:holdId` | Verified `CUSTOMER` | `GET /api/v1/holds/:holdId`, `POST /api/v1/captcha/challenge`, `POST /api/v1/captcha/verify`, `POST /api/v1/bookings/pay`, `POST /api/v1/holds/:holdId/release` | Backend-synced countdown bar (`CountdownTimer`), non-extendable lock notice, demo CAPTCHA card, simulated INR payment selector, "Review in Trust Guardian & Sign" handoff button |
| 8 | **Booking Confirmation** | `/booking/:bookingId/confirmation` | Authenticated (owner or `ADMIN`) | `GET /api/v1/bookings/:bookingId` | Emerald confirmation header, booking reference, minted on-chain ticket IDs, Hardhat transaction hash copy badge, links to My Tickets and Ownership History |
| 9 | **My Tickets** | `/my-tickets` | Authenticated | `GET /api/v1/tickets/my`, `POST /api/v1/tickets/:ticketId/qr-token`, `POST /api/v1/resales/prepare-list`, `POST /api/v1/resales/:resaleId/prepare-cancel` | Tabs (`ACTIVE`, `LISTED_FOR_RESALE`, `USED`), `TicketCard` grid, dynamic 30s QR modal trigger, "List for Official Resale" inline modal (showing exact 110% cap and `>=5x` scalping alert), links to history pages |
| 10 | **Official Resale Marketplace** | `/resale` | Public (browsing); Verified `CUSTOMER` (buying) | `GET /api/v1/resales`, `POST /api/v1/resales/:resaleId/pay` | Event filter and price sort bar, verified resale cards showing original price vs asking price (+% badge always `<= 10%`), buyer 2-ticket limit check, simulated payment + Trust Guardian handoff |
| 11 | **Ticket Ownership History** | `/tickets/:ticketId/ownership-history` | Authenticated | `GET /api/v1/tickets/:ticketId/ownership-history`, `GET /api/v1/tickets/:ticketId` | On-chain vs database consistency badge, vertical chronological timeline (`MINTED` -> `LISTED_FOR_RESALE` -> `RESOLD` -> `REDEEMED`) with wallet addresses, block numbers, and transaction hashes |
| 12 | **Ticket Price History** | `/tickets/:ticketId/price-history` | Authenticated | `GET /api/v1/tickets/:ticketId/price-history` | Original price card, 110% official cap bar, historical sale price table, `PriceVariationChart`, percentage change badge, blocked scalping attempt summary |
| 13 | **Trust Guardian Transaction Review** | `/trust-guardian/review` | Authenticated | `POST /api/v1/trust-guardian/analyze`, `POST /api/v1/trust-guardian/decision`, `POST /api/v1/bookings/:bookingId/confirm-onchain`, `POST /api/v1/resales/confirm-list`, `POST /api/v1/resales/confirm-cancel`, `POST /api/v1/resales/:resaleId/confirm-buy` | `RiskLevelBanner`, plain-English explanation box, `SimulationSummaryCard` (contract trust, decoded function, ticket ID, exact INR amount, ownership change), `RuleChecklist`, optional "Test Malicious Transaction" simulator toggle for demo verification, Approve & Sign in MetaMask / Cancel buttons |
| 14 | **QR Scanner** | `/gate/scanner` | `GATE_STAFF`, `ADMIN` | `POST /api/v1/gate/verify`, `GET /api/v1/gate/recent-scans` | Event selector, camera QR scanner (`html5-qrcode`) + manual QR payload paste box for desktop demo testing, instant redirect/panel to Gate Verification result |
| 15 | **Gate Verification** | `/gate/verify` | `GATE_STAFF`, `ADMIN` | `POST /api/v1/gate/verify`, `POST /api/v1/gate/redeem`, `GET /api/v1/gate/recent-scans` | 7-point verification checklist (QR signature, 30s TTL, existence, event match, unused, on-chain owner, DB-chain sync), ticket owner & ID summary, large "Confirm Entry & Mark USED" button, red duplicate-scan rejection banner, live recent scans log |
| 16 | **Admin Dashboard** | `/admin` | `ADMIN` | `GET /api/v1/admin/overview`, `GET /api/v1/admin/security-logs`, `GET /api/v1/admin/users`, `PATCH /api/v1/admin/users/:userId/status` | KPI stat cards, filterable `SecurityLogs` table (highlighting `SCALPING_ATTEMPT_5X`, `DUPLICATE_IDENTITY_ATTEMPT`, `STATE_MISMATCH`, `QR_REPLAY_SCAN`), user table with Suspend/Activate controls |
| 17 | **Organizer Dashboard** | `/organizer` (plus sub-routes `/organizer/new` and `/organizer/:eventId/edit`) | `ORGANIZER` (Admin analytics added in Prompt 30) | `GET /api/v1/events/mine`, `POST /api/v1/events`, `PATCH /api/v1/events/:eventId`, `POST /api/v1/events/:eventId/publish`, `POST /api/v1/events/:eventId/cancel` | "My events" management table with publish/cancel modals, create/edit event form (`EventForm`), and in Prompt 30 per-event sales, resale, and queue controls |

---

## 9. Key flows

### 9.1 Identity Verification and Wallet Linking (F1)

**Why three distinct steps exist**:
- **Phone verification (OTP)** proves the user controls an active mobile number and slows down automated account farms.
- **Identity verification (Mock KYC -> salted `identityHash`)** proves one real person maps to at most one FairTicket account, stopping a scalper from buying 2 tickets across 10 phone numbers.
- **Wallet authentication (MetaMask signature)** proves cryptographic ownership of an Ethereum private key so the backend can safely bind that wallet to the user's `identityHash` on-chain.

**Step-by-step flow**:
1. Fan submits `POST /api/v1/auth/register` with `fullName`, `email`, `phone`, and `password`. Backend hashes password (`bcryptjs`), creates `Users` record (`role: CUSTOMER`, all verification flags `false`), and returns JWT.
2. Fan requests OTP via `POST /api/v1/verification/otp/request`. Backend generates a 6-digit numeric OTP, stores `SHA-256(otp + serverSalt)` in `VerificationRecords` (`verificationType: PHONE_OTP`, `otpExpiresAt: now + 300s`), and returns `{ expiresAt, demoOtpPreview }` (demo simulation only).
3. Fan submits `POST /api/v1/verification/otp/verify` with `otpCode`. Backend validates expiry and attempt count (`< 5`). On mismatch, increments `otpAttemptCount` (logging `OTP_BRUTE_FORCE` at 5 failures). On match, sets `Users.phoneVerified = true`.
4. Fan submits `POST /api/v1/verification/identity/submit` with `{ identityDocType, simulatedIdNumber, dateOfBirth }` (Aadhaar numbers are explicitly rejected by input validation and never requested).
5. Backend normalizes `identityDocType` and `simulatedIdNumber`, computes `identityHash = keccak256(docType + ":" + normalizedId + ":" + IDENTITY_HASH_SALT)`, and checks `Users` for an existing record with that `identityHash`.
6. If a duplicate exists, backend logs `DUPLICATE_IDENTITY_ATTEMPT` in `SecurityLogs`, creates a `REJECTED` `VerificationRecords` entry, and returns HTTP 409 `DUPLICATE_IDENTITY`.
7. If unique, backend stores `identityHash` on `Users` (`identityVerified = true`) and stores only `maskedIdPreview` (never raw ID) in `VerificationRecords`.
8. Fan connects MetaMask on Hardhat (`chainId 31337`), calls `POST /api/v1/wallet/nonce` with `walletAddress`, receives a domain-bound challenge message containing the random `nonce` and `expiresAt`, and signs it via `personal_sign` in MetaMask.
9. Fan sends `{ walletAddress, signature }` to `POST /api/v1/wallet/link`. Backend checks nonce freshness, verifies `ethers.verifyMessage(messageToSign, signature).toLowerCase() === walletAddress.toLowerCase()`, clears `walletAuthNonce` (preventing replay), confirms wallet is not already linked to another user, and calls `FairTicket.verifyWallet(walletAddress, identityHash)` using the backend's `VERIFIER_ROLE` key.
10. Once the Hardhat transaction confirms, backend sets `Users.walletLinked = true`, `walletAddress`, and `walletLinkTxHash`. The user is now eligible to join queues and buy tickets.

### 9.2 Queue Registration and Auditable Random Allocation (F2)

1. Organizer creates an event (`POST /api/v1/events`) with `registrationOpenAt`, `registrationCloseAt`, `totalTickets`, `basePricePaise`, and `holdDurationMinutes`, and opens registration (`status: REGISTRATION_OPEN`).
2. Verified fans click "Join Queue" (`POST /api/v1/events/:eventId/queue/join`). Backend enforces `phoneVerified && identityVerified && walletLinked`, checks current time is within `[registrationOpenAt, registrationCloseAt]`, and inserts a `QueueEntries` document (`status: REGISTERED`). Unique indexes `(eventId, userId)` and `(eventId, identityHash)` block duplicate entries.
3. After `registrationCloseAt` passes, Organizer or Admin triggers `POST /api/v1/events/:eventId/queue/allocate`.
4. Backend atomically transitions `Events.status` from `REGISTRATION_OPEN` to `QUEUE_ALLOCATED`, generates a 32-byte random hex `queueShuffleSeed` (`crypto.randomBytes(32).toString('hex')`), sorts all `REGISTERED` entries deterministically by `_id` ascending as the canonical input list, and applies a seeded Fisher-Yates shuffle (`SHA-256(seed + ":" + index)` derived PRNG).
5. Backend computes `queueShuffleHash = SHA-256(seed + ":" + orderedEntryIds.join(","))`, stores `queueShuffleSeed` and `queueShuffleHash` on `Events`, writes `queuePosition` (`1..N`) to every `QueueEntries` record, promotes positions `1..activeBatchSize` to `ACTIVE_TURN` (`turnExpiresAt = now + holdDurationMinutes`), marks positions `activeBatchSize+1..N` as `WAITING`, and sets `Events.status = BOOKING_OPEN`.
6. Any user can inspect `GET /api/v1/events/:eventId/queue/audit`, download the published `queueShuffleSeed` and anonymized entry list, and re-run the deterministic Fisher-Yates algorithm to verify their assigned position was not rigged.

### 9.3 Timed Booking Hold State Machine & Checkout (F3, F4, F5)

**BookingHold Statuses**:
- `ACTIVE`: Hold created, inventory temporarily decremented, waiting for CAPTCHA.
- `CAPTCHA_PASSED`: Human verification succeeded, ready for simulated payment.
- `PAYMENT_PENDING`: Simulated payment succeeded and backend ECDSA permit issued; awaiting fan's MetaMask `purchaseTicket` confirmation.
- `COMPLETED`: On-chain `purchaseTicket` confirmed, `Tickets` created, `QueueEntry` marked `BOOKED`.
- `EXPIRED`: `expiresAt` passed before `COMPLETED`; inventory restored and next `WAITING` queue user promoted.
- `RELEASED`: Fan voluntarily cancelled hold before expiry; inventory restored and next `WAITING` queue user promoted.

**Allowed Transitions Table**:

| From Status | To Status | Trigger / Guard | Inventory & Queue Effect |
| --- | --- | --- | --- |
| *(none)* | `ACTIVE` | `POST /api/v1/holds` (`QueueEntry.status == ACTIVE_TURN`, `quantity` 1 or 2, per-identity limit check passes, atomic `Events.availableTickets >= quantity`) | Atomically decrements `Events.availableTickets` by `quantity`; sets immutable `expiresAt = now + holdDurationMinutes` |
| `ACTIVE` | `CAPTCHA_PASSED` | `POST /api/v1/captcha/verify` (`now < expiresAt`, valid single-use CAPTCHA answer) | None; unlocks payment step |
| `CAPTCHA_PASSED` | `PAYMENT_PENDING` | `POST /api/v1/bookings/pay` (`now < expiresAt`, simulated payment succeeds, re-checks 2-ticket limit) | Creates `Payments` (`SUCCEEDED`) and `Bookings` (`PENDING_ONCHAIN`), signs single-use ECDSA permit |
| `PAYMENT_PENDING` | `COMPLETED` | `POST /api/v1/bookings/:bookingId/confirm-onchain` (verified `TicketPurchased` receipt on Hardhat) | Increments `Events.soldTickets`, inserts `Tickets` & `TicketHistory`, marks `QueueEntry.status = BOOKED` |
| `ACTIVE` / `CAPTCHA_PASSED` / `PAYMENT_PENDING` | `EXPIRED` | `holdExpiry.job.js` (or lazy check on read) when `now >= expiresAt` and not yet `COMPLETED` | Atomically increments `Events.availableTickets` by `quantity`; marks `QueueEntry.status = EXPIRED`; if `PAYMENT_PENDING` and not minted, marks simulated payment `REFUNDED`; promotes next `WAITING` user to `ACTIVE_TURN` |
| `ACTIVE` / `CAPTCHA_PASSED` | `RELEASED` | `POST /api/v1/holds/:holdId/release` by hold owner | Atomically increments `Events.availableTickets` by `quantity`; marks `QueueEntry.status = CANCELLED`; promotes next `WAITING` user |

> **Timer Extension Forbidden**: Calling `POST /api/v1/holds/:holdId/extend` is never allowed. It increments `extensionBlockedCount`, logs `HOLD_EXTENSION_ATTEMPT` in `SecurityLogs`, and returns HTTP 403 `HOLD_EXTENSION_FORBIDDEN`. No inventory is permanently marked `soldTickets` until payment and on-chain minting succeed.

### 9.4 Official Resale Listing and Buying (F6, F7)

1. **Listing**:
   - Ticket owner enters `askingPricePaise` in My Tickets and submits `POST /api/v1/resales/prepare-list`.
   - Backend checks ownership (`Tickets.currentOwnerUserId == req.user.id`), status (`ACTIVE`), and live on-chain owner.
   - Backend computes `maxAllowed = Math.floor((ticket.originalPricePaise * 110) / 100)`.
   - If `askingPricePaise >= ticket.originalPricePaise * 5`, backend writes a `CRITICAL` `SCALPING_ATTEMPT_5X` entry to `SecurityLogs` and returns HTTP 422 `SCALPING_BLOCKED` with a clear scalping warning.
   - Else if `askingPricePaise > maxAllowed`, backend writes a `HIGH` `RESALE_CAP_VIOLATION` entry to `SecurityLogs` and returns HTTP 422 `RESALE_CAP_EXCEEDED`.
   - If valid (`1 <= askingPricePaise <= maxAllowed`), backend returns encoded calldata for `FairTicket.listForResale(onChainTicketId, askingPricePaise)` and opens **Trust Guardian Transaction Review**.
   - Fan reviews simulation, approves, signs in MetaMask, and frontend posts `{ ticketId, askingPricePaise, txHash }` to `POST /api/v1/resales/confirm-list`. Backend verifies the `TicketListedForResale` log on Hardhat, inserts `Resales` (`ACTIVE`), updates `Tickets.status = LISTED_FOR_RESALE`, and appends `LISTED_FOR_RESALE` to `TicketHistory`.
2. **Buying**:
   - Verified buyer picks a listing on `/resale` and submits `POST /api/v1/resales/:resaleId/pay`.
   - Backend checks buyer != seller, buyer `identityHash != sellerIdentityHash`, and calls `ticketLimit.service` (both MongoDB and on-chain `checkTicketLimit`) to confirm buyer has `< 2` tickets for this event.
   - Backend atomically locks the listing (`status: ACTIVE -> PAYMENT_LOCKED`, `lockExpiresAt = now + 180s`), processes simulated INR payment, generates `authNonce`, signs the `RESALE_BUY` ECDSA permit, and returns encoded `FairTicket.buyResaleTicket(...)` calldata.
   - Buyer inspects the transaction in **Trust Guardian**, approves, signs in MetaMask, and posts `{ txHash }` to `POST /api/v1/resales/:resaleId/confirm-buy`.
   - Backend verifies the `TicketResold` event on Hardhat, updates `Resales.status = SOLD`, transfers `Tickets.currentOwner*` fields, updates `lastSalePricePaise`, increments `resaleCount`, resets `Tickets.status = ACTIVE`, and appends `RESOLD` to `TicketHistory`.

### 9.5 Gate Entry Verification and One-Time Redemption (F8, F9)

1. Fan opens My Tickets and clicks "Show Entry QR". Frontend calls `POST /api/v1/tickets/:ticketId/qr-token`.
2. Backend confirms caller owns the ticket and `status == ACTIVE`, generates a compact JSON payload `{ tid: onChainTicketId, eid: onChainEventId, iat, exp: iat + 30, n: randomNonce }`, computes `sig = HMAC-SHA256(payload, QR_SIGNING_SECRET)`, and returns base64url-encoded `{ payload, sig }`. Zero personal data (no name, phone, email, or wallet) appears inside the QR. Frontend auto-refreshes every 25 seconds.
3. Gate staff (`GATE_STAFF`) scans the QR on `/gate/scanner` and submits `POST /api/v1/gate/verify` with `{ qrPayloadString, eventId }`.
4. Backend performs 7 deterministic checks:
   1. Valid HMAC signature (failure logs `QR_INVALID_SIGNATURE`).
   2. `now <= exp` (failure logs `QR_EXPIRED`).
   3. Ticket exists in MongoDB and on-chain.
   4. `ticket.eventId` matches the selected gate `eventId`.
   5. `ticket.status` is `ACTIVE` (or defensively `LISTED_FOR_RESALE` if listed after QR generation; never `USED` or `REVOKED`). Any stale resale listing is automatically cleared on redemption.
   6. Live Hardhat call `getTicketDetails(onChainTicketId)` shows `isUsed == false`.
   7. Live Hardhat `currentOwner`, `eventId`, and `isUsed` match MongoDB exactly (mismatch logs `CRITICAL` `STATE_MISMATCH` and blocks entry).
5. When gate staff clicks "Confirm Entry & Mark USED" (`POST /api/v1/gate/redeem`), backend re-validates QR + on-chain state, executes an atomic conditional MongoDB update (`Tickets.findOneAndUpdate({ _id, status: { $in: ["ACTIVE", "LISTED_FOR_RESALE"] } }, { $set: { status: "USED", redeemedAt: now, redeemedByStaffId } })`), and if modified, calls `FairTicket.redeemTicket(onChainTicketId)` using the `GATE_ROLE` signer.
6. If the on-chain call fails unexpectedly, backend rolls back `Tickets.status` to its previous state and returns `BLOCKCHAIN_TX_FAILED`. If it succeeds, backend stores `redeemTxHash`, closes any stale resale listing, and appends `REDEEMED` to `TicketHistory`.
7. Any second scan (sequential or simultaneous) fails the atomic filter (`status` is already `USED`), logs `TICKET_ALREADY_USED` or `QR_REPLAY_SCAN` to `SecurityLogs`, and flashes a red rejection screen.

### 9.6 Trust Guardian Pre-Signing Review Flow

1. Before any fan-signed MetaMask transaction (`purchaseTicket`, `listForResale`, `cancelResaleListing`, `buyResaleTicket`), the frontend navigates to `/trust-guardian/review` passing `{ transaction: { from, to, data, value }, expectedIntent, postSignCallbackMeta }`.
2. Frontend calls `POST /api/v1/trust-guardian/analyze`.
3. Trust Guardian executes its 5 deterministic stages: `decoder` -> `trustedRegistry` -> `simulator` (`eth_call` on local Hardhat) -> `ruleEngine` -> `explainer`.
4. UI displays the `RiskLevelBanner` (`SAFE`, `CAUTION`, `DANGEROUS`, or `BLOCKED`), plain-English summary, exact INR amount, ticket ID, ownership impact, and full rule checklist.
5. If `riskLevel == BLOCKED`, the "Sign in MetaMask" button is disabled by default so the fan cannot accidentally sign a known-malicious or reverting transaction.
6. If the fan clicks **Cancel**, frontend logs `userDecision: CANCELLED` via `POST /api/v1/trust-guardian/decision` and aborts without opening MetaMask.
7. If the fan clicks **Approve & Sign in MetaMask** (allowed for `SAFE` or `CAUTION`, and with an explicit acknowledgement checkbox for `DANGEROUS` demo tests), frontend logs `userDecision: APPROVED`, invokes MetaMask `eth_sendTransaction`, waits for the Hardhat receipt, and calls the corresponding backend `confirm-*` endpoint.

---

## 10. Concurrency and atomicity plan

Because local hackathon MongoDB runs as a **single standalone node without a replica set**, FairTicket does **not** depend on MongoDB multi-document transactions. Instead, every race condition is eliminated through single-document atomic `findOneAndUpdate` filters, unique indexes, and idempotent background recovery.

### 10.1 Concurrency Matrix

| Race Condition | Exact Atomic Mechanism (Standalone MongoDB + Solidity) |
| --- | --- |
| **Double Booking / Overselling Inventory** | When creating a hold, backend runs `Events.findOneAndUpdate({ _id: eventId, status: "BOOKING_OPEN", availableTickets: { $gte: quantity } }, { $inc: { availableTickets: -quantity } }, { new: true })`. If `null` is returned, inventory is exhausted (`INSUFFICIENT_INVENTORY`). Additionally, `FairTicket.sol` enforces `mintedCount + quantity <= totalSupply` on-chain. |
| **Duplicate Hold Creation / Timer Reset** | `BookingHolds` has a unique index on `{ queueEntryId: 1 }`. Attempting to create a second hold for the same queue turn triggers MongoDB error `11000` (`CONFLICT`). `expiresAt` is never updated after creation. |
| **Simultaneous Double Redemption at Gate** | `gate.service.js` runs `Tickets.findOneAndUpdate({ _id: ticketId, status: { $in: ["ACTIVE", "LISTED_FOR_RESALE"] } }, { $set: { status: "USED", redeemedAt: new Date(), redeemedByStaffId } }, { new: false })`. MongoDB guarantees that among 2 or 100 concurrent scan requests for the same ticket, **exactly one** request matches and receives the previous document; all others receive `null` and immediately reject with `TICKET_ALREADY_USED` + `QR_REPLAY_SCAN` log. On-chain `FairTicket.redeemTicket` also reverts with `TicketAlreadyUsed`. |
| **Duplicate Queue Registration** | `QueueEntries` enforces two unique compound indexes: `{ eventId: 1, userId: 1 }` and `{ eventId: 1, identityHash: 1 }`. Concurrent `POST /queue/join` calls collide on the unique index; only one succeeds. |
| **Two Buyers Buying Same Resale Listing** | `resale.service.js` runs `Resales.findOneAndUpdate({ _id: resaleId, $or: [{ status: "ACTIVE" }, { status: "PAYMENT_LOCKED", lockExpiresAt: { $lte: now } }] }, { $set: { status: "PAYMENT_LOCKED", lockedByUserId: buyerId, lockExpiresAt: now + 180s } })`. Only one buyer acquires the checkout lock. On-chain `FairTicket.buyResaleTicket` also clears `isActive = false` atomically on the first confirmed purchase. |
| **Exceeding 2-Ticket Limit via Parallel Requests** | Backend checks `existingActiveOrRedeemedTickets + activeNonExpiredHoldsQuantity + requestedQuantity <= MAX_ACTIVE_TICKETS` before creating a hold or resale lock, and `FairTicket.sol` enforces `_activeTicketCount[idHash][eventId] + _redeemedTicketCount[idHash][eventId] + quantity <= 2` sequentially per block. |
| **Double Simulated Payment on Retry** | `Payments` has a unique index on `{ idempotencyKey: 1 }`. Repeated clicks with the same key return the existing payment result rather than charging twice. |

### 10.2 Expired Hold Release & Next Queue User Promotion

1. `backend/src/jobs/holdExpiry.job.js` runs every `10` seconds (`HOLD_EXPIRY_POLL_SECONDS`).
2. It queries `BookingHolds` where `status` is in `["ACTIVE", "CAPTCHA_PASSED", "PAYMENT_PENDING"]` and `expiresAt <= new Date()`.
3. For each candidate hold, it executes an **atomic status transition** so neither a concurrent payment confirmation nor another worker pass can double-restore inventory:
   `BookingHolds.findOneAndUpdate({ _id: hold._id, status: { $in: ["ACTIVE", "CAPTCHA_PASSED", "PAYMENT_PENDING"] }, expiresAt: { $lte: now } }, { $set: { status: "EXPIRED", releasedAt: now } })`.
4. **Only if that update returns the matched document**:
   - Restores inventory atomically: `Events.updateOne({ _id: hold.eventId }, { $inc: { availableTickets: hold.quantity } })`.
   - Marks `QueueEntries.updateOne({ _id: hold.queueEntryId, status: "ACTIVE_TURN" }, { $set: { status: "EXPIRED" } })`.
   - If a `Bookings` record exists in `PENDING_ONCHAIN`, marks it `CANCELLED` and marks its simulated `Payments` record `REFUNDED`.
   - Promotes the next eligible `WAITING` user: `QueueEntries.findOneAndUpdate({ eventId: hold.eventId, status: "WAITING" }, { $set: { status: "ACTIVE_TURN", turnActivatedAt: now, turnExpiresAt: now + holdDurationMinutes } }, { sort: { queuePosition: 1 }, new: true })`.
5. **How the next queue user is notified**: The `RandomizedQueuePage` polls `GET /api/v1/events/:eventId/queue/status` every 5 seconds while in `WAITING` state. As soon as `myEntry.status` flips to `ACTIVE_TURN`, the UI displays a prominent sky-blue "It's Your Turn!" banner with a live countdown and the button to claim their hold.
6. Also, `holdExpiry.job.js` checks for `ACTIVE_TURN` queue entries whose `turnExpiresAt <= now` without ever creating a hold, marks them `EXPIRED`, and promotes the next `WAITING` user so idle turns never stall the queue.

---

## 11. Trust Guardian design

**Tagline**: *"Understand Before You Sign"*

Trust Guardian is a modular pre-signing transaction firewall. Its security verdict is **100% deterministic** (derived exclusively from local EVM `eth_call` simulation, ABI decoding, trusted contract registry checks, and hard-coded security rules). An AI model never decides whether a transaction is safe or unsafe.

### 11.1 Five-Module Architecture

```text
[Unsigned Tx + Expected User Intent]
                 │
                 ▼
┌────────────────────────────────────┐
│ 1. decoder.service.js              │  Decodes selector & args against FairTicket ABI
│    (Calldata Decoder)              │  + known ERC-20/721 approve/setApprovalForAll/transfer selectors
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ 2. trustedRegistry.service.js      │  Checks tx.to + chainId against verified FairTicket contract registry
│    (Trusted-Address Registry)      │
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ 3. simulator.service.js            │  Runs deterministic eth_call against Hardhat node at latest block,
│    (Deterministic Simulator)       │  captures return values or custom revert errors, predicts ownership & price delta
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ 4. ruleEngine.service.js           │  Evaluates all 11 deterministic rules; computes riskLevel & canProceed
│    (Deterministic Rule Engine)     │
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ 5. explainer.service.js            │  Deterministic plain-English templates (default, offline, zero paid APIs)
│    (Explainer + Pluggable Adapter) │  with ExplainerAdapter interface for optional future LLM rephrasing
└────────────────┬───────────────────┘
                 ▼
[Trust Guardian Analysis Report JSON -> Review UI -> Approve or Cancel]
```

### 11.2 Input and Output JSON Shapes

**Request Body (`POST /api/v1/trust-guardian/analyze`)**:

```json
{
  "transaction": {
    "from": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    "to": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    "data": "0x...",
    "value": "0"
  },
  "expectedIntent": {
    "actionType": "BUY_RESALE_TICKET",
    "expectedEventId": 1,
    "expectedTicketId": 42,
    "expectedAmountPaise": 550000,
    "expectedRecipient": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
  }
}
```

**Response `data` (`TrustGuardianReport`)**:

```json
{
  "analysisId": "tg_9f8a2c10-4b11-4d22-a813-91b74e8c01ab",
  "analyzedAt": "2026-11-20T10:15:00.000Z",
  "chainId": 31337,
  "riskLevel": "SAFE",
  "canProceed": true,
  "requiresExplicitOverride": false,
  "contractCheck": {
    "targetAddress": "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    "isTrusted": true,
    "contractLabel": "FairTicket Official Ledger (Localhost)"
  },
  "decodedCall": {
    "isKnownFunction": true,
    "functionName": "buyResaleTicket",
    "functionSignature": "buyResaleTicket(uint256,bytes32,uint256,bytes)",
    "parameters": {
      "ticketId": 42,
      "authNonce": "0x...",
      "authExpiry": 1795169880
    }
  },
  "simulation": {
    "succeeded": true,
    "revertErrorName": null,
    "revertReason": null,
    "ticketInvolved": {
      "onChainTicketId": 42,
      "onChainEventId": 1,
      "eventTitle": "Coldplay Music of the Spheres — Mumbai"
    },
    "amountInPaise": 550000,
    "ethValueWei": "0",
    "ownershipChange": {
      "fromWallet": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      "toWallet": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      "summary": "Ticket #42 transfers from 0x3c44...93bc to your wallet 0x7099...79c8."
    },
    "detectedApprovals": [],
    "detectedUnexpectedTransfers": []
  },
  "rulesEvaluated": [
    {
      "ruleCode": "UNTRUSTED_CONTRACT",
      "status": "PASS",
      "severity": "CRITICAL",
      "message": "Destination matches the verified FairTicket contract."
    }
  ],
  "explanation": {
    "engine": "DETERMINISTIC_TEMPLATE",
    "headline": "Verified official resale purchase for Ticket #42.",
    "plainEnglishBullets": [
      "You are calling buyResaleTicket on the official FairTicket contract.",
      "Simulated off-chain payment matches Rs 5,500.00 (within the 110% cap).",
      "No token approvals or unexpected asset transfers were detected.",
      "After signing, Ticket #42 will belong to your wallet."
    ],
    "disclaimer": "Deterministic simulation reduces transaction risk but cannot guarantee absolute safety against compromised devices or off-chain scams."
  }
}
```

### 11.3 Complete Deterministic Rule Set

| # | `ruleCode` | Trigger Condition | Resulting Severity | Risk Impact |
| --- | --- | --- | --- | --- |
| 1 | `UNTRUSTED_CONTRACT` | `tx.to` is missing or not present in `trustedRegistry.service.js` allowlist | `CRITICAL` | Sets `BLOCKED` |
| 2 | `UNEXPECTED_APPROVAL` | Function selector matches `approve(address,uint256)` (`0x095ea7b3`), `setApprovalForAll(address,bool)` (`0xa22cb465`), or `increaseAllowance` (`0x39509351`) | `CRITICAL` | Sets `BLOCKED` |
| 3 | `UNEXPECTED_TRANSFER` | `tx.value > 0` (FairTicket demo uses simulated INR, never ETH) OR selector matches `transfer`/`transferFrom`/`safeTransferFrom` | `CRITICAL` | Sets `BLOCKED` |
| 4 | `DIRECT_TRANSFER_FORBIDDEN` | Call invokes `FairTicket.transferTicket` | `CRITICAL` | Sets `BLOCKED` |
| 5 | `UNKNOWN_FUNCTION` | 4-byte function selector cannot be decoded by FairTicket ABI or known approval/transfer ABIs | `HIGH` | Sets `DANGEROUS` |
| 6 | `SIMULATION_REVERTED` | Hardhat `eth_call` reverts (captures exact custom error such as `ResalePriceCapExceeded` or `TicketLimitExceeded`) | `CRITICAL` | Sets `BLOCKED` |
| 7 | `AMOUNT_MISMATCH` | Decoded/simulated `pricePaise` differs from `expectedIntent.expectedAmountPaise` | `HIGH` | Sets `DANGEROUS` |
| 8 | `WRONG_TICKET` | Decoded `ticketId` differs from `expectedIntent.expectedTicketId` (or event ID differs from `expectedEventId`) | `HIGH` | Sets `DANGEROUS` |
| 9 | `WRONG_RECIPIENT` | Simulated new owner (`toWallet`) differs from `expectedIntent.expectedRecipient` (or `tx.from`) | `HIGH` | Sets `DANGEROUS` |
| 10 | `RESALE_CAP_EXCEEDED` | Decoded `listForResale` asking price exceeds `floor(originalPricePaise * 110 / 100)` | `CRITICAL` | Sets `BLOCKED` |
| 11 | `TICKET_LIMIT_EXCEEDED` | Pre-check `checkTicketLimit` returns `allowed == false` for caller's `identityHash` | `CRITICAL` | Sets `BLOCKED` |

### 11.4 Risk Levels & Signing Policy

- **`SAFE`**: All 11 rules `PASS`. `canProceed: true`, `requiresExplicitOverride: false`. Green verified card.
- **`CAUTION`**: Zero `HIGH`/`CRITICAL` failures, minor advisory (for example, listing a ticket for resale means you lose entry rights until cancelled). `canProceed: true`, `requiresExplicitOverride: false`.
- **`DANGEROUS`**: One or more `HIGH` rule failures (`UNKNOWN_FUNCTION`, `AMOUNT_MISMATCH`, `WRONG_TICKET`, `WRONG_RECIPIENT`) with zero `CRITICAL` blocks. `canProceed: true`, `requiresExplicitOverride: true` (requires explicit checkbox acknowledgement; logged to `SecurityLogs`).
- **`BLOCKED`**: Any `CRITICAL` rule failure (`UNTRUSTED_CONTRACT`, `UNEXPECTED_APPROVAL`, `UNEXPECTED_TRANSFER`, `DIRECT_TRANSFER_FORBIDDEN`, `SIMULATION_REVERTED`, `RESALE_CAP_EXCEEDED`, `TICKET_LIMIT_EXCEEDED`). `canProceed: false` — sign button is locked and incident is logged to `SecurityLogs`.

### 11.5 Explainer Boundary (No AI in Security Decisions)

- `ruleEngine.service.js` produces the final `riskLevel`, `canProceed`, and `rulesEvaluated` array **before** `explainer.service.js` is called.
- In the hackathon demo, `explainer.service.js` runs `DeterministicTemplateExplainer` (100% offline, zero paid APIs, deterministic plain-English bullets generated directly from verified decoded fields and rule codes).
- `explainer.service.js` defines a clean `ExplainerAdapter` contract (`async explain(verifiedReport) -> { engine, headline, plainEnglishBullets, disclaimer }`) so a future production deployment can plug in an LLM solely to translate verified JSON facts into simpler language or regional Indian languages (Hindi, Tamil, Telugu, Marathi, or Bengali) without ever altering `riskLevel` or `canProceed`.

### 11.6 Prototype Scope vs FUTURE DEVELOPMENT

**Built in This Prototype**:
- Local Hardhat `eth_call` simulation for all FairTicket functions (`purchaseTicket`, `listForResale`, `cancelResaleListing`, `buyResaleTicket`, `transferTicket`).
- Calldata decoding for FairTicket ABI plus common ERC-20/ERC-721 approval and transfer selectors.
- Static trusted-contract registry for the deployed `FairTicket.sol` address on `chainId 31337`.
- All 11 deterministic rules, risk verdicts, SecurityLogs recording, and a demo "Simulate Malicious Transaction" test mode so judges can see `UNTRUSTED_CONTRACT` and `UNEXPECTED_APPROVAL` get blocked live.
- Deterministic plain-English template explainer with pluggable adapter interface.

**FUTURE DEVELOPMENT (Explicitly Not Built in Demo)**:
- Multi-chain support (Ethereum Mainnet, Polygon, Arbitrum, Base) and cross-chain bridge decoders.
- Full EVM execution trace inspection (`debug_traceCall`) for deeply nested internal contract calls and delegatecall proxy detection.
- Generalized DeFi swap slippage analysis, NFT marketplace order-book (Seaport/Permit2) signature decoding, and live ERC-20 allowance revocation dashboard.
- Standalone browser extension / MetaMask Snap packaging so Trust Guardian protects transactions on external dApps outside FairTicket.
- Real-time threat intelligence feeds for newly deployed phishing contracts and optional regional-language LLM explanation adapter.

---

## 12. Security design

| # | Threat | Security Control | Enforcement Layer | How It Will Be Tested |
| --- | --- | --- | --- | --- |
| 1 | **Automated Ticket Bots** | Verified identity required before queue join + randomized shuffle (speed gives zero advantage) + server-validated CAPTCHA before checkout + `express-rate-limit` | Backend + Frontend | Automated script attempting rapid queue join without verification or skipping CAPTCHA fails with 403/429 |
| 2 | **Fake / Burner Accounts** | Phone OTP + simulated KYC identity check before queue eligibility | Backend | Unverified newly registered account attempting `POST /queue/join` receives 403 `USER_NOT_VERIFIED` |
| 3 | **Duplicate Identities (One Person, Multiple Accounts)** | Salted `identityHash` stored with unique index in `Users` and checked during KYC | Backend + MongoDB | Registering Account B with the same simulated ID document as Account A fails with 409 `DUPLICATE_IDENTITY` and writes `SecurityLogs` |
| 4 | **Multi-Wallet Bypass of 2-Ticket Cap** | Ticket cap tracked per `(identityHash, eventId)` rather than per wallet address in both MongoDB and `FairTicket.sol` | Smart Contract + Backend | Wallet 1 buys 2 tickets; Wallet 2 verified with the same `identityHash` calls `purchaseTicket` or `buyResaleTicket` -> reverts `TicketLimitExceeded` |
| 5 | **Replayed MetaMask Wallet Signatures** | Single-use random `walletAuthNonce` with 5-minute TTL bound to user & wallet, deleted immediately upon successful verification | Backend | Re-submitting a previously valid `{ walletAddress, signature }` payload fails with 401 `NONCE_EXPIRED` and logs `SIGNATURE_REPLAY_ATTEMPT` |
| 6 | **Bypassing Queue / Payment by Calling Contract Directly** | `purchaseTicket` and `buyResaleTicket` require a single-use `VERIFIER_ROLE` ECDSA permit bound to `(contract, chainId, action, msg.sender, payload, authNonce, authExpiry)` | Smart Contract + Backend | Direct Hardhat call to `purchaseTicket` with forged, expired, or reused `authNonce` reverts (`InvalidBackendSignature`, `AuthPermitExpired`, `AuthNonceAlreadyUsed`) |
| 7 | **Brute-Forced Phone OTP** | 6-digit OTP hashed with SHA-256 + salt, 5-minute expiry, strict `OTP_MAX_ATTEMPTS = 5` counter + route rate limiter | Backend | 5 consecutive wrong OTP submissions lock the challenge (`OTP_MAX_ATTEMPTS`) and log `OTP_BRUTE_FORCE` |
| 8 | **Frontend Price Tampering (Checkout or Resale)** | Backend ignores client-supplied primary prices (always reads `Events.basePricePaise`); resale cap (`floor(original * 110 / 100)`) enforced in backend AND Solidity | Smart Contract + Backend | Sending `askingPricePaise = 600000` for a Rs 5,000 ticket fails in Express (422) AND directly in Hardhat (`ResalePriceCapExceeded`) |
| 9 | **Extreme Scalping (`>= 5x` Price Attempt)** | Backend detects `askingPricePaise >= originalPricePaise * 5`, rejects listing, returns warning, and persists `CRITICAL` `SCALPING_ATTEMPT_5X` in `SecurityLogs` | Backend + MongoDB | Listing a Rs 5,000 ticket for Rs 25,000 (`2500000` paise) returns 422 `SCALPING_BLOCKED` and appears in Admin Dashboard `SecurityLogs` |
| 10 | **Direct Peer-to-Peer Transfer Bypassing Resale Cap** | `FairTicket.transferTicket` unconditionally reverts with `DirectTransferBlocked()`; no unrestricted transfer function exists | Smart Contract | Unit test calling `transferTicket(1, addr2)` reverts with `DirectTransferBlocked` |
| 11 | **Double Spending of Booking Holds / Timer Extension** | Unique index on `BookingHolds.queueEntryId`; atomic `availableTickets` decrement; `POST /holds/:holdId/extend` always returns 403 and logs `HOLD_EXTENSION_ATTEMPT` | Backend + MongoDB | Parallel hold creation and timer extension attempts fail deterministically; expired holds auto-release |
| 12 | **Forged QR Codes** | QR payload signed with server-side `HMAC-SHA256` (`QR_SIGNING_SECRET`); verified on every gate scan | Backend | Tampering with `tid` or `eid` inside QR payload fails gate check (`QR_INVALID`) and logs `QR_INVALID_SIGNATURE` |
| 13 | **Stolen QR Screenshots Shared on WhatsApp/Telegram** | Short-lived 30-second rotating QR tokens (`QR_TOKEN_TTL_SECONDS = 30`) + one-time `USED` redemption on-chain and in MongoDB | Backend + Smart Contract | Presenting a QR older than 30 seconds fails (`QR_EXPIRED`); scanning an already-used ticket fails (`TICKET_ALREADY_USED`) |
| 14 | **Simultaneous Duplicate Gate Scans** | Single-document atomic `Tickets.findOneAndUpdate({ _id, status: { $in: ["ACTIVE", "LISTED_FOR_RESALE"] } }, { $set: { status: "USED" } })` + on-chain `TicketAlreadyUsed` guard | Backend + MongoDB + Smart Contract | Concurrency test firing 10 parallel `POST /api/v1/gate/redeem` requests admits exactly 1 and rejects 9 |
| 15 | **JWT Misuse / Privilege Escalation** | Signed JWTs (`HS256`, 12h expiry) validated in `auth.middleware.js`; strict `role.middleware.js` on every Admin/Organizer/Gate route; `accountStatus == SUSPENDED` re-checked on DB lookup | Backend | `CUSTOMER` JWT calling `POST /api/v1/events` or `POST /api/v1/gate/redeem` receives 403 `FORBIDDEN` and logs `UNAUTHORIZED_ACCESS` |
| 16 | **Malicious / Phishing MetaMask Transactions** | Trust Guardian decodes calldata, checks trusted contract registry, simulates via `eth_call`, and blocks untrusted contracts, unexpected approvals, ETH value transfers, or mismatched ticket/amount | Backend + Frontend (Trust Guardian) | Sending crafted `approve()` or fake contract address to `/trust-guardian/analyze` returns `riskLevel: BLOCKED` and disables signing |
| 17 | **MongoDB vs Blockchain Tampering / Drift** | Gate verification and ticket inspection cross-check live Hardhat `getTicketDetails` against MongoDB fields | Backend + Smart Contract | Modifying a ticket's `currentOwnerWallet` directly in MongoDB during a security test causes `POST /api/v1/gate/verify` to reject with `BLOCKCHAIN_MISMATCH` and log `STATE_MISMATCH` |

---

## 13. Simulated in the demo vs real in production

| Capability | Simulated Implementation in Local Demo | Real Production Replacement |
| --- | --- | --- |
| **Phone OTP** | Backend generates 6-digit OTP, stores salted SHA-256 hash in MongoDB, and returns `demoOtpPreview` in API response (non-production mode only) so judges can test without SMS credits. | Integrate Twilio Verify, AWS SNS, or MSG91 SMS gateway; remove `demoOtpPreview` from API responses. |
| **Identity Verification (KYC)** | Mock identity service validates format of a simulated ID (`SIMULATED_GOV_ID`, `SIMULATED_PASSPORT`, `SIMULATED_STUDENT_ID`), never collects real Aadhaar, computes salted `identityHash`, and enforces duplicate blocking. | Integrate DigiLocker / Karza / HyperVerge / Onfido KYC provider via `identity.service.js` adapter; receive a verified non-PII subject identifier to salt and hash. |
| **Queue Randomness** | Server generates a 32-byte seed (`crypto.randomBytes`), publishes `queueShuffleSeed` and `queueShuffleHash`, and runs a deterministic Fisher-Yates shuffle that anyone can re-verify via `/queue/audit`. | Request verifiable on-chain randomness via **Chainlink VRF v2.5** (`requestRandomWords` -> `fulfillRandomWords`) when the registration window closes, eliminating even organizer/server seed bias. |
| **Payments** | Simulated UPI/Card/NetBanking checkout in integer INR paise (`Payments` collection) that immediately marks demo payments `SUCCEEDED` and issues an ECDSA permit. | Integrate Razorpay / Cashfree / Stripe India with signed payment webhooks and escrow settlement for official resale payouts to sellers. |
| **CAPTCHA** | Backend-generated single-use math/visual text challenge (`captcha.service.js`) stored with a 3-minute TTL. | Integrate Cloudflare Turnstile or Google reCAPTCHA Enterprise with server-side token verification. |
| **Blockchain Network** | Local Hardhat node (`http://127.0.0.1:8545`, `chainId 31337`) with zero gas cost and deterministic local accounts. | Deploy audited `FairTicket.sol` to a low-fee EVM L2 (Polygon PoS, Base, or Arbitrum) with hardware KMS/multi-sig role custody and gas sponsorship (ERC-4337 paymaster) for fans. |

---

## 14. Environment variables

### 14.1 Backend (`backend/.env`)

| Variable | Example Value | Commit to Git? | Purpose |
| --- | --- | --- | --- |
| `PORT` | `5000` | Yes (`.env.example` only) | Express API server port |
| `NODE_ENV` | `development` | Yes (`.env.example` only) | Enables `demoOtpPreview` only in `development`/`test` |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Yes (`.env.example` only) | Allowed CORS origin |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/fairticket` | **Never commit real credentials** | Local MongoDB connection string |
| `JWT_SECRET` | `change_me_to_64_char_random_hex_secret` | **NEVER COMMIT** | Signs and verifies auth JWTs |
| `JWT_EXPIRES_IN` | `12h` | Yes (`.env.example` only) | Auth token lifetime |
| `JWT_ISSUER` | `fairticket` | Yes (`.env.example` only) | Expected JWT `iss` claim |
| `JWT_AUDIENCE` | `fairticket-web` | Yes (`.env.example` only) | Expected JWT `aud` claim |
| `AUTH_MAX_FAILED_LOGINS` | `5` | Yes (`.env.example` only) | Consecutive wrong passwords before temporary account lockout |
| `AUTH_LOCK_MINUTES` | `15` | Yes (`.env.example` only) | Duration in minutes of temporary brute-force lockout |
| `AUTH_LOGIN_RATE_LIMIT_MAX` | `10` | Yes (`.env.example` only) | Maximum login requests per 15 minutes per IP+email |
| `AUTH_REGISTER_RATE_LIMIT_MAX` | `5` | Yes (`.env.example` only) | Maximum registration requests per 60 minutes per IP |
| `SEED_STAFF_PASSWORD` | *(commented out in `.env.example`)* | **NEVER COMMIT** | Optional password used by `npm run seed:staff` in non-production environments |
| `IDENTITY_HASH_SECRET` | `change_me_to_96_char_random_hex_secret` | **NEVER COMMIT** | Required HMAC-SHA256 secret (>= 32 chars, different from `JWT_SECRET`) for deterministic identity hashing; never rotate after users verify |
| `IDENTITY_PROVIDER` | `mock` | Yes (`.env.example` only) | Selects identity verification provider adapter (`mock` only for demo) |
| `IDENTITY_MAX_ATTEMPTS_PER_DAY` | `5` | Yes (`.env.example` only) | Maximum identity submissions allowed per user per rolling 24 hours |
| `IDENTITY_SUBMIT_RATE_LIMIT_MAX` | `10` | Yes (`.env.example` only) | Maximum identity submissions per 60 minutes per IP+user |
| `IDENTITY_DUPLICATE_FLAG_THRESHOLD` | `3` | Yes (`.env.example` only) | Duplicate-identity attempts per user in 24h that trigger a `CRITICAL` `DUPLICATE_IDENTITY_REPEATED` alert (`1`–`20`) |
| `IDENTITY_HASH_SALT` | `change_me_unique_identity_salt_secret` | **NEVER COMMIT** | Legacy salt placeholder (superseded by `IDENTITY_HASH_SECRET`) |
| `OTP_LENGTH` | `6` | Yes (`.env.example` only) | Number of digits in generated simulated phone OTP (4–10) |
| `OTP_TTL_SECONDS` | `300` | Yes (`.env.example` only) | Lifetime in seconds of each phone OTP challenge (default 5 minutes) |
| `OTP_MAX_ATTEMPTS` | `5` | Yes (`.env.example` only) | Maximum wrong OTP guesses allowed before locking the current OTP |
| `OTP_RESEND_COOLDOWN_SECONDS` | `30` | Yes (`.env.example` only) | Minimum seconds required between OTP send requests per user |
| `OTP_MAX_SENDS_PER_HOUR` | `5` | Yes (`.env.example` only) | Maximum OTP sends allowed per user within a rolling 60-minute window |
| `OTP_SEND_RATE_LIMIT_MAX` | `10` | Yes (`.env.example` only) | Maximum OTP send requests per 60 minutes per IP+user |
| `OTP_VERIFY_RATE_LIMIT_MAX` | `30` | Yes (`.env.example` only) | Maximum OTP verify requests per 15 minutes per IP+user |
| `SMS_PROVIDER` | `console` | Yes (`.env.example` only) | Selects simulated SMS adapter (`console` or `mock`) |
| `DEMO_SHOW_OTP` | `true` (`.env.example`); `false` default in code | Yes (`.env.example` only) | Includes `demoOtp` in send-OTP response in non-production only; forced `false` in production |
| `OTP_HASH_SALT` | `change_me_unique_otp_salt_secret` | **NEVER COMMIT** | Legacy placeholder (OTP HMAC key is derived from `JWT_SECRET` using domain label `fairticket:otp:v1`) |
| `QR_SIGNING_SECRET` | `change_me_unique_qr_hmac_secret` | **NEVER COMMIT** | HMAC-SHA256 secret signing 30-second QR payloads |
| `WALLET_CHAIN_ID` | `31337` | Yes (`.env.example` only) | EVM chain ID bound into wallet linking challenge messages |
| `WALLET_CHALLENGE_TTL_SECONDS` | `300` | Yes (`.env.example` only) | Lifetime in seconds of each single-use wallet challenge |
| `WALLET_MAX_VERIFY_ATTEMPTS` | `5` | Yes (`.env.example` only) | Maximum failed signature verifications allowed per challenge before lock |
| `WALLET_CHALLENGE_MAX_PER_HOUR` | `10` | Yes (`.env.example` only) | Maximum wallet challenges issued per user per rolling hour |
| `WALLET_CHALLENGE_RATE_LIMIT_MAX` | `20` | Yes (`.env.example` only) | Maximum challenge requests per 60 minutes per IP+user |
| `WALLET_VERIFY_RATE_LIMIT_MAX` | `30` | Yes (`.env.example` only) | Maximum wallet verify requests per 15 minutes per IP+user |
| `EVENT_WRITE_RATE_LIMIT_MAX` | `60` | Yes (`.env.example` only) | Maximum event create/edit/publish/cancel requests per 60 minutes per user |
| `EVENT_READ_RATE_LIMIT_MAX` | `200` | Yes (`.env.example` only) | Maximum public event listing read requests per 15 minutes per IP |
| `HARDHAT_RPC_URL` | `http://127.0.0.1:8545` | Yes (`.env.example` only) | Local Hardhat JSON-RPC URL |
| `CHAIN_ID` | `31337` | Yes (`.env.example` only) | Expected local Hardhat chain ID |
| `FAIRTICKET_CONTRACT_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Yes (`.env.example` only) | Deployed `FairTicket.sol` address |
| `VERIFIER_PRIVATE_KEY` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | **NEVER COMMIT** (Hardhat #1 dev key only locally) | Signs `verifyWallet` and purchase/resale ECDSA permits |
| `ORGANIZER_PRIVATE_KEY` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | **NEVER COMMIT** (Hardhat #2 dev key only locally) | Signs `createEvent` and `setEventStatus` |
| `GATE_PRIVATE_KEY` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` | **NEVER COMMIT** (Hardhat #3 dev key only locally) | Signs `redeemTicket` at concert gates |
| `TRUST_GUARDIAN_EXPLAINER_MODE` | `DETERMINISTIC_TEMPLATE` | Yes (`.env.example` only) | Selects default deterministic explainer adapter |

### 14.2 Frontend (`frontend/.env`)

| Variable | Example Value | Commit to Git? | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:5000/api/v1` | Yes (`.env.example` only) | Backend REST API base URL |
| `VITE_CHAIN_ID` | `31337` | Yes (`.env.example` only) | Expected MetaMask Hardhat network ID |
| `VITE_CHAIN_NAME` | `FairTicket Local (Hardhat)` | Yes (`.env.example` only) | Network label shown in MetaMask add-chain prompt and demo guide |
| `VITE_RPC_URL` | `http://127.0.0.1:8545` | Yes (`.env.example` only) | Local Hardhat JSON-RPC URL used for `wallet_addEthereumChain` |
| `VITE_CURRENCY_SYMBOL` | `ETH` | Yes (`.env.example` only) | Native currency symbol for local Hardhat network config |
| `VITE_FAIRTICKET_CONTRACT_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Yes (`.env.example` only) | Official contract address for calldata encoding |

### 14.3 Blockchain (`blockchain/.env`)

| Variable | Example Value | Commit to Git? | Purpose |
| --- | --- | --- | --- |
| `HARDHAT_RPC_URL` | `http://127.0.0.1:8545` | Yes (`.env.example` only) | Local Hardhat RPC endpoint for deploy scripts |
| `DEPLOYER_PRIVATE_KEY` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | **NEVER COMMIT** (Hardhat #0 dev key only locally) | Deploys `FairTicket.sol` and assigns initial roles |
| `VERIFIER_ADDRESS` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | Yes (`.env.example` only) | Address granted `VERIFIER_ROLE` by `deploy.js` |
| `ORGANIZER_ADDRESS` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | Yes (`.env.example` only) | Address granted `ORGANIZER_ROLE` by `deploy.js` |
| `GATE_ADDRESS` | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | Yes (`.env.example` only) | Address granted `GATE_ROLE` by `deploy.js` |

---

## 15. Build order

Exact dependency map for Prompts 2 through 37 (Prompt 1 is this architecture document):

| Prompt # | Milestone | Depends On | Files Created / Edited |
| --- | --- | --- | --- |
| **2** | Folder structure and setup | 1 | `frontend/package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `frontend/.env.example`; `backend/package.json`, `backend/.env.example`, `backend/src/server.js`, `app.js`, `config/constants.js`, `config/db.js`, `utils/apiResponse.js`, `utils/AppError.js`, `utils/money.js`, `middleware/errorHandler.middleware.js`, `middleware/rateLimit.middleware.js`, `routes/index.js`; `blockchain/package.json`, `hardhat.config.js`, `blockchain/.env.example` |
| **3** | MongoDB models | 2 | All 11 model files in `backend/src/models/`: `User.model.js`, `VerificationRecord.model.js`, `Event.model.js`, `QueueEntry.model.js`, `BookingHold.model.js`, `Booking.model.js`, `Payment.model.js`, `Ticket.model.js`, `Resale.model.js`, `TicketHistory.model.js`, `SecurityLog.model.js` |
| **4** | Frontend design system | 2 | `frontend/src/index.css`, `config/constants.js`, `utils/formatMoney.js`, `utils/formatDate.js`, `services/api.js`, `components/layout/Navbar.jsx`, `Footer.jsx`, `PageContainer.jsx`, `components/common/StatusBadge.jsx`, `LoadingSpinner.jsx`, `EmptyState.jsx`, `ErrorBanner.jsx`, `ConfirmDialog.jsx`, `pages/HomePage.jsx`, `App.jsx`, `main.jsx` |
| **5** | Register/login/JWT/roles | 3, 4 | `backend/src/services/auth.service.js`, `controllers/auth.controller.js`, `routes/auth.routes.js`, `middleware/auth.middleware.js`, `middleware/role.middleware.js`, `middleware/validate.middleware.js`; `frontend/src/context/AuthContext.jsx`, `services/authApi.js`, `components/common/ProtectedRoute.jsx`, `pages/AuthPage.jsx` |
| **6** | Phone OTP | 5 | `backend/src/utils/crypto.js`, `services/otp.service.js`, `services/securityLog.service.js`, `controllers/verification.controller.js`, `routes/verification.routes.js`; `frontend/src/pages/IdentityVerificationPage.jsx` (Step 1) |
| **7** | Mock identity verification | 6 | `backend/src/services/identity.service.js`, edits to `controllers/verification.controller.js`, `routes/verification.routes.js`; `frontend/src/pages/IdentityVerificationPage.jsx` (Step 2) |
| **8** | Duplicate identity prevention | 7 | Edits to `backend/src/services/identity.service.js` (salted hash check + `DUPLICATE_IDENTITY_ATTEMPT` logging), `middleware/verifiedUser.middleware.js`; duplicate-error UI states in `IdentityVerificationPage.jsx` |
| **9** | MetaMask wallet auth | 8 | `backend/src/services/wallet.service.js`, `controllers/wallet.controller.js`, `routes/wallet.routes.js`; `frontend/src/services/walletProvider.js`, `context/WalletContext.jsx`, `IdentityVerificationPage.jsx` (Step 3) |
| **10** | Event management | 5, 9 | `backend/src/services/event.service.js`, `controllers/event.controller.js`, `routes/event.routes.js`; `frontend/src/services/eventApi.js`, `pages/EventListingPage.jsx`, `pages/EventDetailsPage.jsx` |
| **11** | Randomized queue | 10 | `backend/src/utils/deterministicShuffle.js`, `services/queue.service.js`, `controllers/queue.controller.js`, `routes/queue.routes.js`; `frontend/src/services/queueApi.js`, `pages/RandomizedQueuePage.jsx` |
| **12** | Timed booking lock | 11 | `backend/src/services/booking.service.js` (hold creation, atomic inventory decrement, release, extension block), `services/ticketLimit.service.js`, `jobs/holdExpiry.job.js`, `controllers/booking.controller.js`, `routes/booking.routes.js`; `frontend/src/components/booking/CountdownTimer.jsx`, `pages/TimedBookingPage.jsx` |
| **13** | CAPTCHA | 12 | `backend/src/services/captcha.service.js`, `controllers/captcha.controller.js`, `routes/captcha.routes.js`; `frontend/src/components/booking/CaptchaWidget.jsx`, edits to `TimedBookingPage.jsx` |
| **14** | Booking and simulated payment | 13 | Edits to `backend/src/services/booking.service.js`, `controllers/booking.controller.js`, `routes/booking.routes.js`; `frontend/src/services/bookingApi.js`, `components/booking/SimulatedPaymentForm.jsx`, `pages/BookingConfirmationPage.jsx` |
| **15** | Solidity contracts | 2 | `blockchain/contracts/FairTicket.sol`, `blockchain/scripts/deploy.js`, `blockchain/scripts/seedEvents.js` |
| **16** | Contract tests | 15 | `blockchain/test/FairTicket.booking.test.js`, `FairTicket.resale.test.js`, `FairTicket.redemption.test.js` |
| **17** | Backend-blockchain service | 9, 10, 14, 16 | `backend/src/contracts/FairTicket.abi.json`, `config/blockchain.js`, `services/blockchain.service.js`; wires live Hardhat calls into `wallet.service.js`, `event.service.js`, `ticketLimit.service.js`, `booking.service.js`; `frontend/src/config/contractAbi.js` |
| **18** | Ownership tracking | 17 | `backend/src/services/ticket.service.js`, `controllers/ticket.controller.js`, `routes/ticket.routes.js`; `frontend/src/services/ticketApi.js`, `components/tickets/TicketCard.jsx`, `pages/MyTicketsPage.jsx`, `pages/TicketOwnershipHistoryPage.jsx` |
| **19** | Resale marketplace | 18 | `backend/src/services/resale.service.js`, `controllers/resale.controller.js`, `routes/resale.routes.js`; `frontend/src/services/resaleApi.js`, `pages/ResaleMarketplacePage.jsx`, resale list/cancel modal in `MyTicketsPage.jsx` |
| **20** | Resale price enforcement | 19 | Hardens `backend/src/services/resale.service.js` and `FairTicket.sol` integer 110% cap checks, buyer 2-ticket limit check, and direct-transfer block UI notices |
| **21** | Price history | 20 | Edits to `backend/src/services/ticket.service.js`, `controllers/ticket.controller.js`; `frontend/src/components/tickets/PriceVariationChart.jsx`, `pages/TicketPriceHistoryPage.jsx` |
| **22** | Scalping detection | 20, 21 | Edits to `backend/src/services/resale.service.js` (`SCALPING_ATTEMPT_5X` + `RESALE_CAP_VIOLATION` off-chain logging) and scalping warning UI banners in `MyTicketsPage.jsx` and `TicketPriceHistoryPage.jsx` |
| **23** | QR generation | 18 | `backend/src/services/qr.service.js`, edits to `controllers/ticket.controller.js`, `routes/ticket.routes.js`; `frontend/src/components/tickets/DynamicQrModal.jsx`, wired into `MyTicketsPage.jsx` |
| **24** | QR scanning and verification | 23 | `backend/src/services/gate.service.js` (`verify`), `controllers/gate.controller.js`, `routes/gate.routes.js`; `frontend/src/services/gateApi.js`, `pages/QRScannerPage.jsx`, `pages/GateVerificationPage.jsx` |
| **25** | One-time redemption | 24 | Edits to `backend/src/services/gate.service.js` (atomic MongoDB `USED` lock + on-chain `redeemTicket` + rollback on chain error + duplicate scan logging), wired into `GateVerificationPage.jsx` |
| **26** | Transaction history | 18, 21, 25 | Completes full unified history views across `TicketOwnershipHistoryPage.jsx`, `TicketPriceHistoryPage.jsx`, and `BookingConfirmationPage.jsx` with tx hashes and block references |
| **27** | Trust Guardian simulation | 17, 19 | `backend/src/services/trustGuardian/decoder.service.js`, `trustedRegistry.service.js`, `simulator.service.js`, `index.js`, `controllers/trustGuardian.controller.js`, `routes/trustGuardian.routes.js` |
| **28** | Trust Guardian risk rules and explanation | 27 | `backend/src/services/trustGuardian/ruleEngine.service.js`, `explainer.service.js`; `frontend/src/services/trustGuardianApi.js`, `components/trustGuardian/RiskLevelBanner.jsx`, `SimulationSummaryCard.jsx`, `RuleChecklist.jsx`, `pages/TrustGuardianReviewPage.jsx`; connects all fan MetaMask flows to `/trust-guardian/review` |
| **29** | Admin dashboard | 22, 25, 28 | `backend/src/services/dashboard.service.js` (admin metrics), `controllers/admin.controller.js`, `routes/admin.routes.js`; `frontend/src/services/adminApi.js`, `pages/AdminDashboardPage.jsx` |
| **30** | Organizer dashboard | 11, 29 | Edits to `backend/src/services/dashboard.service.js` (organizer analytics), `controllers/organizer.controller.js`, `routes/organizer.routes.js`; `frontend/src/pages/OrganizerDashboardPage.jsx` |
| **31** | Gate staff dashboard | 25, 29 | Completes gate shift stats and recent scans panel inside `QRScannerPage.jsx` and `GateVerificationPage.jsx` with `GET /api/v1/gate/recent-scans` |
| **32** | Integration | 28, 29, 30, 31 | End-to-end wiring check across all 17 pages, `App.jsx`, `Navbar.jsx`, `backend/src/routes/index.js`, and `backend/src/seeds/demoSeed.js` |
| **33** | Security testing | 32 | Backend/contract security test scripts validating all 17 threats in Section 12 (scalping, multi-wallet bypass, QR replay, signature replay, state mismatch, malicious tx) |
| **34** | Performance and concurrency testing | 32 | Concurrency scripts firing parallel hold claims, parallel gate redemptions, and parallel resale purchases against standalone MongoDB + Hardhat |
| **35** | Bug fixing | 33, 34 | Targeted fixes across frontend, backend, and contract for any defects uncovered in Prompts 33–34 |
| **36** | Demo preparation | 35 | Finalizes `backend/src/seeds/demoSeed.js` (Coldplay Mumbai demo event, pre-seeded roles, sample resale & scalping logs) and demo walkthrough checklist |
| **37** | Final audit | 36 | Full consistency, lint, build, contract test, and security verification pass against `docs/ARCHITECTURE.md` |

---

## 16. Test plan outline

### 16.1 Identity (F1)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `ID-01` | Register user and complete simulated phone OTP | `phoneVerified` becomes `true`; raw OTP never stored in DB | 5, 6 |
| `ID-02` | Enter wrong OTP 5 times | 5th failure returns `OTP_MAX_ATTEMPTS` and logs `OTP_BRUTE_FORCE` | 6 |
| `ID-03` | Submit simulated KYC ID | `identityVerified` becomes `true`, salted `identityHash` saved, raw ID discarded | 7 |
| `ID-04` | Submit same simulated ID on a second account | HTTP 409 `DUPLICATE_IDENTITY` and `DUPLICATE_IDENTITY_ATTEMPT` logged | 8 |
| `ID-05` | Sign MetaMask challenge and link wallet | Signature verified, `FairTicket.verifyWallet` tx succeeds, `walletLinked = true` | 9, 17 |
| `ID-06` | Replay previous MetaMask signature | Rejected with `NONCE_EXPIRED` and `SIGNATURE_REPLAY_ATTEMPT` logged | 9, 33 |

### 16.2 Queue (F2)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `QU-01` | Unverified user attempts to join queue | HTTP 403 `USER_NOT_VERIFIED` | 11 |
| `QU-02` | Verified user joins queue twice for same event | Second request blocked by unique index (`DUPLICATE_QUEUE_ENTRY`) | 11 |
| `QU-03` | Organizer runs queue allocation after close | Published `queueShuffleSeed` & `queueShuffleHash`; positions `1..N` assigned; first batch `ACTIVE_TURN` | 11 |
| `QU-04` | Re-run deterministic shuffle using `/queue/audit` seed | Produces identical position order and matching `queueShuffleHash` | 11, 33 |

### 16.3 Booking & Concurrency (F3)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `BK-01` | `ACTIVE_TURN` user creates hold, passes CAPTCHA, pays, signs MetaMask tx | Hold transitions `ACTIVE -> CAPTCHA_PASSED -> PAYMENT_PENDING -> COMPLETED`; ticket minted on-chain | 12, 13, 14, 17 |
| `BK-02` | User calls `POST /holds/:holdId/extend` | HTTP 403 `HOLD_EXTENSION_FORBIDDEN`, `HOLD_EXTENSION_ATTEMPT` logged | 12 |
| `BK-03` | Hold timer expires without payment | `holdExpiry.job.js` marks hold `EXPIRED`, restores `availableTickets`, promotes next `WAITING` user | 12, 34 |
| `BK-04` | 10 concurrent users attempt to claim the last 1 available ticket | Exactly 1 hold succeeds; 9 receive `INSUFFICIENT_INVENTORY`; `availableTickets` never drops below `0` | 34 |
| `BK-05` | Direct Hardhat `purchaseTicket` call without valid backend permit | Reverts with `InvalidBackendSignature` | 16 |

### 16.4 Ticket Limits (F4)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `TL-01` | Verified user buys 2 primary tickets for Event 1 | Succeeds; `getActiveTicketCount` returns `2` | 16, 17 |
| `TL-02` | Same user attempts to buy a 3rd ticket (primary or resale) for Event 1 | Blocked by backend (`TICKET_LIMIT_EXCEEDED`) AND Solidity (`TicketLimitExceeded`) | 16, 19 |
| `TL-03` | Same `identityHash` links a second MetaMask wallet and tries to buy a 3rd ticket | Solidity reverts `TicketLimitExceeded` because cap is keyed by `identityHash` | 16, 33 |
| `TL-04` | User owning 2 tickets sells 1 via official resale, then buys 1 resale ticket | Seller active count drops `2 -> 1`, then rises `1 -> 2` cleanly | 16, 19 |

### 16.5 Resale & Scalping Detection (F6, F7)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `RS-01` | Owner lists Rs 5,000 (`500000`) ticket at Rs 5,500 (`550000`, 110%) | Succeeds on-chain and appears on `/resale` | 16, 19, 20 |
| `RS-02` | Owner lists Rs 5,000 ticket at Rs 5,501 (`550100`) | Rejected by backend (`RESALE_CAP_EXCEEDED`) and Solidity (`ResalePriceCapExceeded`); `RESALE_CAP_VIOLATION` logged | 16, 20, 22 |
| `RS-03` | Owner lists Rs 5,000 ticket at Rs 25,000 (`2500000`, 5x) | Rejected with `SCALPING_BLOCKED`, scalping warning displayed, `CRITICAL` `SCALPING_ATTEMPT_5X` logged in `SecurityLogs` | 22 |
| `RS-04` | Owner attempts `FairTicket.transferTicket(ticketId, otherWallet)` | Reverts unconditionally with `DirectTransferBlocked` | 16 |
| `RS-05` | Verified buyer completes official resale purchase | Ownership updates on-chain & in MongoDB; `TicketPriceHistoryPage` shows original price, resale price, and `+10%` variation | 19, 21 |

### 16.6 QR & Gate Redemption (F8, F9)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `QR-01` | Generate QR token and inspect decoded payload | Contains only `tid`, `eid`, `iat`, `exp`, `n`, `sig` — zero PII | 23 |
| `QR-02` | Scan expired QR (`> 30s` old) or tampered signature | Rejected (`QR_EXPIRED` or `QR_INVALID`) and logged in `SecurityLogs` | 24 |
| `QR-03` | Scan valid QR and click Confirm Entry | Ticket becomes `USED` in MongoDB and on-chain; `redeemTxHash` recorded | 25 |
| `QR-04` | Re-scan same ticket OR fire 10 simultaneous `POST /gate/redeem` calls | Exactly 1 entry admitted; all duplicates rejected with `TICKET_ALREADY_USED` and `QR_REPLAY_SCAN` logged | 25, 34 |
| `QR-05` | Corrupt `Tickets.currentOwnerWallet` in MongoDB and scan at gate | Rejected with `BLOCKCHAIN_MISMATCH` and `CRITICAL` `STATE_MISMATCH` logged | 24, 33 |

### 16.7 Trust Guardian (Standout)

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `TG-01` | Analyze legitimate `buyResaleTicket` tx matching intent | `riskLevel: SAFE`, `canProceed: true`, accurate ticket ID, Rs amount, and ownership change bullets | 27, 28 |
| `TG-02` | Analyze tx targeting an unknown/phishing contract address | `UNTRUSTED_CONTRACT` fails -> `riskLevel: BLOCKED`, `canProceed: false` | 28, 33 |
| `TG-03` | Analyze tx containing `setApprovalForAll` or `approve` calldata | `UNEXPECTED_APPROVAL` fails -> `riskLevel: BLOCKED`, `canProceed: false` | 28, 33 |
| `TG-04` | Analyze tx where `expectedTicketId` or `expectedAmountPaise` disagrees with calldata | `WRONG_TICKET` / `AMOUNT_MISMATCH` fails -> `riskLevel: DANGEROUS` | 28 |
| `TG-05` | Analyze tx that would revert on-chain (e.g. `listForResale` above 110%) | `SIMULATION_REVERTED` + `RESALE_CAP_EXCEEDED` -> `riskLevel: BLOCKED` with decoded revert reason | 27, 28 |

### 16.8 Security & RBAC

| Test ID | What Is Tested | Expected Result | Built In Prompt |
| --- | --- | --- | --- |
| `SC-01` | `CUSTOMER` JWT calls `/api/v1/admin/security-logs` or `/api/v1/gate/redeem` | HTTP 403 `FORBIDDEN` and `UNAUTHORIZED_ACCESS` logged | 5, 29, 33 |
| `SC-02` | Admin suspends abusive user (`accountStatus: SUSPENDED`) | User's subsequent authenticated API calls immediately fail with 403 | 29, 33 |

---

## 17. Honest limitations

1. **Cannot See Private Off-Platform Deals or Side Payments**: FairTicket blocks direct on-chain ticket transfers and enforces a 110% cap on the official marketplace, but neither MongoDB nor a smart contract can detect if a seller privately hands over their entire account login/wallet seed phrase or asks a buyer for an off-platform cash/UPI side payment alongside a Rs 5,500 official resale.
2. **Reverted Transactions Leave No On-Chain Events**: When a malicious user tries to call `listForResale` above 110% or `transferTicket` directly on Hardhat, the EVM reverts all state changes and discards all logs. Rejected scalping attempts are therefore recorded off-chain in MongoDB `SecurityLogs`, not on the blockchain.
3. **Demo Simulations Are Not Production-Grade**: Phone OTP, mock KYC identity verification, CAPTCHA, and INR payment processing are simulated locally with zero paid APIs. They demonstrate the exact architectural interfaces and security boundaries, but a real deployment requires licensed KYC, SMS, payment gateway, and bot-defense providers.
4. **Demo Queue Randomness Is Server-Seeded**: Publishing `queueShuffleSeed` and `queueShuffleHash` makes the shuffle auditable after the fact, but an untrusted server could theoretically test multiple seeds before publishing. Production deployments must replace local seed generation with Chainlink VRF.
5. **Local Hardhat Node State Is Ephemeral**: Restarting the local Hardhat node resets on-chain state to block 0, requiring a fresh contract deployment and MongoDB re-seed to maintain synchronization.
6. **Trust Guardian Reduces Risk but Cannot Guarantee Safety**: Deterministic `eth_call` simulation checks state at the current block and flags untrusted contracts, approvals, transfers, and intent mismatches, but it cannot protect against a compromised user machine, malicious browser extensions modifying payloads after approval, or social-engineering scams conducted outside the app.
7. **Single-Node MongoDB Trade-Off**: Using single-document atomic `findOneAndUpdate` operations avoids replica-set setup complexity while preventing double booking and double redemption, but multi-step backend+blockchain transitions rely on compensating rollback/reconciliation checks rather than distributed two-phase commit.
