# FairTicket — Architecture Documentation Plan

This plan defines the blueprint for authoring `docs/ARCHITECTURE.md`, the single source of truth that will govern all 36 subsequent build prompts for **FairTicket ("Every Fan Deserves a Fair Ticket")**. No application code will be written in this task; once approved, we will produce the complete, internally verified 17-section specification document.

## User Review & Critical Decisions

> [!IMPORTANT]
> The four core architectural choices confirmed in Phase 1 are locked in below and will be reflected consistently across every contract signature, database schema, API endpoint, and workflow in `docs/ARCHITECTURE.md`.

- **Confirmed Decision 1 — Per-Event Identity Ticket Limit**: The `MAX_ACTIVE_TICKETS = 2` cap applies **per verified identity per event** (tracked by `identityHash` + `eventId`, never by wallet address alone), so linking multiple wallets cannot bypass the limit.
- **Confirmed Decision 2 — Hybrid Transaction Signing**: Fans sign high-value ownership transactions (`purchaseTicket`, `listForResale`, `buyResaleTicket`) directly in MetaMask—making every user-signed action inspectable by **Trust Guardian**—while the backend verifier/relayer signs identity linking (`verifyWallet`), event setup (`createEvent`), and high-throughput gate check-ins (`redeemTicket`).
- **Confirmed Decision 3 — Unified Smart Contract**: A single cohesive `FairTicket` Solidity contract will hold event registry, identity-to-wallet links, ticket minting, official resale marketplace, blocked direct transfers, and one-time redemption, keeping ABI management and Trust Guardian calldata decoding clean across 36 prompts.
- **Confirmed Decision 4 — Trust Guardian Explainer**: Security verdicts come strictly from deterministic transaction simulation and rule evaluation. The plain-English explainer will run on deterministic templates by default (zero paid APIs) behind a clean pluggable AI adapter interface for future LLM integration.

> [!NOTE]
> **Critical Security Design Choice — Off-Chain Payment Authorization Permits**: Because payments are simulated in INR paise off-chain while fans submit `purchaseTicket` and `buyResaleTicket` via MetaMask on the local Hardhat node, a malicious user could otherwise call those contract functions directly without passing the queue, CAPTCHA, or simulated payment. To close this gap without adding paid services, the backend will issue a short-lived, single-use ECDSA cryptographic permit (`authorizationSignature` + `nonce` + `expiry`) after simulated payment succeeds, which the smart contract verifies on-chain via `ECDSA.recover`.

---

## 1. Overview & Core Concept

- **What It Does**: Produces a complete, unambiguous engineering specification (`docs/ARCHITECTURE.md`) covering FairTicket's three mandatory anti-scalping pillars—fair randomized booking, capped official resale (110% max), and anti-counterfeit gate redemption—plus its standout security layer, **FairTicket Trust Guardian ("Understand Before You Sign")**.
- **Target Audience / Persona**: Developers and reviewers executing the 36-step hackathon build sequence, as well as cybersecurity and blockchain judges auditing how every threat is mitigated across frontend, backend, MongoDB, and Solidity.
- **Key Value**: Eliminates drift across 36 build prompts by freezing exact REST routes, MongoDB collections and indexes, Solidity function signatures and custom errors, state machines, concurrency controls, and honest demo-vs-production boundaries before a single line of application code is written.

---

## 2. User Experience & Visual Design

Even though this task produces documentation rather than UI code, `docs/ARCHITECTURE.md` will codify the exact user journeys and visual design system for all 17 planned pages so later frontend prompts remain cohesive.

- **Key User Flows Documented**:
  1. **Onboarding & Verified Identity**: Account registration, simulated phone OTP, simulated KYC identity verification with salted hash generation, duplicate-identity blocking, and MetaMask SIWE-style nonce signature to bind wallet to `identityHash`.
  2. **Fair Queue & Timed Checkout**: Joining an event registration window, auditable post-close deterministic shuffle, turn notification, 5-minute backend-enforced booking hold with CAPTCHA, simulated INR payment, Trust Guardian transaction review, and MetaMask confirmation.
  3. **Controlled Resale & Scalping Guard**: Listing owned tickets at or below `floor(originalPrice * 110 / 100)`, triggering scalping warnings at `>= 5x` original price and logging rejected attempts off-chain in `SecurityLogs`, plus buyer eligibility checks and Trust Guardian review before resale checkout.
  4. **Gate Verification & One-Time Redemption**: Generating signed 30-second rotating QR tokens (zero PII inside QR), gate staff scanning, cross-checking MongoDB against on-chain ownership/status, atomic redemption locking, and on-chain `USED` finalization.
- **Visual Identity & Theme (for Later UI Build Prompts)**:
  - *Aesthetic Direction*: Crisp commercial ticketing platform—trustworthy, high-contrast, restrained, zero cyberpunk or neon styling.
  - *Color Palette & Mood*: Off-white and pure white primary surfaces (`--background`), soft gray secondary panels (`--muted`), sky-blue primary actions (`--primary`), deep navy typography (`--foreground`), subtle emerald success indicators (`--success`), and clear amber/crimson alerts exclusively inside Trust Guardian risk banners and scalping warnings.
  - *Typography & Hierarchy*: Clean sans-serif headings with tabular numerals for countdown timers, queue positions, and INR currency values (formatted from integer paise).
  - *Component Styling & Layout*: Structured white cards with crisp 1px borders, predictable top navigation with role-aware tabs (`CUSTOMER`, `ORGANIZER`, `ADMIN`, `GATE_STAFF`), responsive mobile-first layouts for My Tickets and Gate Scanner, and clear empty/loading/error states.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Integer-Only Money Math (Paise)**:
  - *Chosen Approach*: Store every monetary amount as a non-negative integer in paise (`Rs 5,000 = 500000`) across MongoDB, Express APIs, React display formatters, and Solidity `uint256`. Compute resale caps strictly as `Math.floor((originalPricePaise * 110) / 100)` (backend) and `(originalPricePaise * 110) / 100` (Solidity integer division).
  - *Why*: Eliminates floating-point rounding drift between JavaScript and Solidity.
  - *Alternatives Considered*: Decimal strings or `Decimal128`—rejected as unnecessarily complex when INR paise fit safely within JavaScript `Number.MAX_SAFE_INTEGER` and Solidity `uint256`.

- **Decision 2 — Single-Node MongoDB Atomicity (No Replica Set Required)**:
  - *Chosen Approach*: Prevent double booking, double redemption, duplicate queue entries, and hold timer extensions using conditional atomic `findOneAndUpdate` filters, explicit unique compound indexes, and an optimistic inventory decrement pattern (`availableTickets: { $gte: quantity }`).
  - *Why*: Standard local hackathon MongoDB installations run standalone without replica sets, meaning multi-document MongoDB transactions would fail.
  - *Alternatives Considered*: Multi-document ACID transactions—rejected due to local replica-set setup friction.

- **Decision 3 — Off-Chain Logging of Rejected Scalping Attempts**:
  - *Chosen Approach*: Enforce the 110% cap in both Express validation and Solidity `listForResale`, and persist all rejected or `>= 5x` scalping attempts in MongoDB `SecurityLogs`.
  - *Why*: Reverted EVM transactions emit no on-chain events; attempting to rely on blockchain logs for blocked scalping attempts would silently lose audit data.
  - *Alternatives Considered*: Emitting on-chain warning events without reverting—rejected because invalid prices must always revert deterministically.

- **Decision 4 — Explicit Blocking of Direct Peer-to-Peer Transfers**:
  - *Chosen Approach*: Implement `transferTicket` on the `FairTicket` contract so it always reverts with `DirectTransferBlocked()`.
  - *Why*: Guarantees ownership can only change through `buyResaleTicket` (which enforces the 110% price cap, buyer verification, and 2-ticket identity limit) while providing a clear, testable entry point for security tests and Trust Guardian simulations.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### System Architecture & Data Flow

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        REACT + VITE FRONTEND (17 Pages)                    │
│  ┌─────────────────────┐   ┌──────────────────────┐   ┌────────────────┐  │
│  │ Ticketing & Dash UI │──▶│ Trust Guardian Modal │──▶│ MetaMask EOA   │  │
│  │ (Axios + JWT Auth)  │   │ (Review Before Sign) │   │ (Fan Signer)   │  │
│  └──────────┬──────────┘   └──────────┬───────────┘   └───────┬────────┘  │
└─────────────┼─────────────────────────┼───────────────────────┼───────────┘
              │ REST (/api/v1/*)        │ /api/v1/guardian/*    │ JSON-RPC
              ▼                         ▼                       │ (Signed Tx)
┌────────────────────────────────────────────────────────┐      │
│             NODE.JS + EXPRESS API BACKEND              │      │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────┐  │      │
│  │ Auth / KYC / │  │ Queue / Holds /│  │ Trust      │  │      │
│  │ OTP / Roles  │  │ Resale / QR    │  │ Guardian   │  │      │
│  └──────┬───────┘  └───────┬────────┘  │ Engine     │  │      │
│         │                  │           └──────┬─────┘  │      │
│         ▼                  ▼                  │        │      │
│  ┌───────────────────────────────────────┐    │        │      │
│  │ Ethers.js Verifier / Relayer Service  │    │        │      │
│  │ (Signs permits, verifyWallet, redeem) │    │        │      │
│  └───────────────────┬───────────────────┘    │        │      │
└──────────────────────┼────────────────────────┼────────┼──────┘
                       │                        │        │
            ┌──────────┴──────────┐             │        │
            ▼                     ▼             ▼        ▼
┌─────────────────────┐     ┌────────────────────────────────────────┐
│   LOCAL MONGODB     │     │    LOCAL HARDHAT NODE (Chain 31337)    │
│  11 Collections     │     │    FairTicket.sol (Unified Contract)   │
│  (Users, Events,    │◀───▶│  • Source of truth: ownership, resale  │
│   Queue, Holds,     │Sync │    cap, active count/identity, USED    │
│   Tickets, Logs...) │Check│  • Simulated via eth_call before sign  │
└─────────────────────┘     └────────────────────────────────────────┘
```

### Data Authority & Consistency Strategy

- **On-Chain Authority (`FairTicket.sol`)**: Canonical source of truth for wallet-to-`identityHash` binding, active ticket count per `(identityHash, eventId)`, current ticket owner, original price in paise, active resale listings, 110% cap enforcement, official resale price history, and one-time `USED` redemption state.
- **Off-Chain Authority (MongoDB — 11 Collections)**: Stores PII (`Users`, `VerificationRecords`), event descriptions and schedules (`Events`), randomized queue ordering and published shuffle seed (`QueueEntries`), timed booking holds (`BookingHolds`), simulated payments (`Bookings`, `Payments`), mirrored ticket/resale projections for fast UI queries (`Tickets`, `Resales`, `TicketHistory`), and security telemetry including rejected scalping attempts (`SecurityLogs`).
- **Mismatch Detection**: Every critical verification endpoint (especially gate verification and ticket inspection) compares the MongoDB projection against live `getTicketOwner` / `getTicketDetails` reads from Hardhat; any discrepancy blocks redemption and writes a `STATE_MISMATCH` entry to `SecurityLogs`.

### Deliverable Structure (`docs/ARCHITECTURE.md`)

Upon your approval, I will author `docs/ARCHITECTURE.md` containing all 17 exact sections requested:
1. Summary and requirement map
2. Fixed constants and conventions
3. System architecture
4. Folder structure (complete tree for `/frontend`, `/backend`, `/blockchain`, `/docs`)
5. Database design (all 11 collections with full fields, types, enums, and unique/compound indexes)
6. Smart contract design (exact signatures, structs, events, custom errors, roles, permit verification, and integer math)
7. API design (complete `/api/v1` endpoint matrix grouped by feature)
8. Frontend pages and routes (all 17 pages mapped to roles, APIs, and UI blocks)
9. Key flows (step-by-step lifecycles including the full `BookingHold` state machine)
10. Concurrency and atomicity plan (standalone MongoDB atomic patterns and hold-expiry worker)
11. Trust Guardian design (5 modular components, JSON I/O schemas, full deterministic rule table, risk levels, template/AI explainer boundary, and separated FUTURE DEVELOPMENT roadmap)
12. Security design (threat-to-control matrix with enforcement layer and test mapping)
13. Simulated in the demo vs real in production
14. Environment variables (backend, frontend, blockchain, with commit rules)
15. Build order (dependency map for Prompts 2–37)
16. Test plan outline (grouped test cases mapped to build prompts)
17. Honest limitations

After writing `docs/ARCHITECTURE.md`, I will perform a full consistency audit across every route, field, enum, and contract function name before presenting the required 4-part summary.
