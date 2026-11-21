# FairTicket — Gap Analysis & Status

_Audited against `docs/ARCHITECTURE.md` (the project's own spec) on 21 Nov 2026._

## 1. Where the project actually stands

The spec defines a 37-step build. The uploaded project has completed roughly **steps 1–10 (about 25–30%)**.

| Layer | Built | Missing |
|---|---|---|
| **Backend** | Express app, config, all 11 Mongoose models, auth + JWT + roles, rate limiting, phone OTP, mock KYC, duplicate-identity detection (salted hash), MetaMask wallet-link (signature challenge), event CRUD + publish/cancel. ~8 test files (auth, OTP, identity, duplicate identity, wallet, events, models, health). | Queue, holds, CAPTCHA, payments/bookings, tickets, resale, gate/QR, Trust Guardian, admin + organizer analytics, hold-expiry job, blockchain service, demo seed |
| **Frontend** | Design-system UI kit, Navbar/Footer/layout, auth page, 3-step identity verification, event list + details, organizer dashboard + event form, route guards | **9 of 17 pages are placeholders**: Queue, Timed Booking, Booking Confirmation, My Tickets, Resale, Ownership History, Price History, Trust Guardian Review, QR Scanner, Gate Verification, Admin Dashboard |
| **Blockchain** | Hardhat config, node check script | **Everything** — `contracts/`, `test/`, `deployments/` were empty `.gitkeep` files |

### The biggest finding
For a **"Cybersecurity and Blockchain" hackathon track**, the blockchain half did not exist yet. Wallet linking is stored only in MongoDB, so today nothing on-chain enforces the 2-ticket cap, the 110% resale cap, or one-time redemption. That is the core of the pitch.

## 2. What I added in this pass

| File | What it does | Verified how |
|---|---|---|
| `blockchain/contracts/FairTicket.sol` | Unified contract exactly per spec §6: roles, event registry, identity-bound 2-ticket cap (multi-wallet safe), integer 110% resale cap, blocked direct transfers, single-use backend-signed ECDSA permits, price history, one-time redemption | **Not compiled** (no Solidity compiler offline here). Hand-reviewed; purchase/resale split into helpers to avoid "stack too deep" |
| `blockchain/test/FairTicket.test.js` | ~25 tests: cap boundary (exact cap passes, +1 paisa fails), 5x scalping, 2-ticket limit incl. second wallet, redeemed-still-counts, permit forgery/expiry/replay/wrong-wallet/price-binding, wash-trading, double redemption | **Not run** |
| `blockchain/scripts/deploy.js` + `npm run deploy` | Deploys, grants VERIFIER/ORGANIZER/GATE roles to Hardhat accounts #1–#3, writes `deployments/localhost.json` and the ABI into `backend/src/contracts/` | **Not run** |
| `backend/src/utils/deterministicShuffle.js` | Auditable seeded Fisher-Yates + commitment hash + `verifyShuffle` for the public audit endpoint | **12/12 unit tests pass** (run here) |
| `backend/src/services/qr.service.js` | 30-second HMAC QR tokens with zero personal data, constant-time verify, stable failure codes | **12/12 unit tests pass** (run here) |
| `backend/tests/unit/*.test.js` | Jest-style tests for the two modules above | Ran via a small Jest stand-in (real Jest unavailable offline) |

**To verify my unrun work, run:**
```bash
cd blockchain && npm install && npx hardhat compile && npx hardhat test
cd ../backend && npm install && npm test
```
If the compile reports "Stack too deep", set `solidity.settings.viaIR: true` in `hardhat.config.js`. If it reports another error, paste it to me and I'll fix it.

## 3. Still missing — in priority order

**P0 — Without these there is no working demo**
1. **Backend ↔ chain service** (`blockchain.service.js`, `config/blockchain.js`): ethers provider + VERIFIER/ORGANIZER/GATE signers; call `verifyWallet` after wallet link and `createEvent` on publish; helper that signs purchase/resale permits using the exact digest in `FairTicket.sol` (`address(this), chainid, "PURCHASE"|"RESALE_BUY", msg.sender, id, qty|price, nonce, expiry`).
2. **Queue** (`queue.service/controller/routes`): join, atomic `allocate` using `deterministicShuffle`, status, public audit.
3. **Holds → CAPTCHA → pay → confirm-onchain** (`booking.service`, `captcha.service`, `holdExpiry.job`): the atomic inventory decrement (`availableTickets: {$gte: qty}`) and the non-extendable timer.
4. **Tickets + My Tickets page + QR modal** using `qr.service`.
5. **Gate verify/redeem** with the atomic `USED` lock, then rollback on chain failure.

**P1 — The differentiators judges will look for**
6. **Resale marketplace** with off-chain `SecurityLogs` for rejected/≥5x attempts (reverted txs emit no events, so this must be logged off-chain).
7. **Trust Guardian** (decoder via `ethers.Interface` + the ABI, `eth_call` simulator, trusted-contract registry, deterministic rule engine, template explainer) and its review page. This is your standout feature and is currently 0% built.
8. Price-history and ownership-history pages with on-chain vs DB consistency badge.

**P2 — Completeness**
9. Admin + organizer dashboards (backend `dashboard.service` + 2 routers; frontend pages).
10. `demoSeed.js` (Coldplay Mumbai demo event, roles, sample resale and scalping logs).
11. Concurrency tests (parallel hold claims, parallel gate scans) and the 17-threat security test pass from spec §12.

## 4. Issues found in what already exists

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | **Root-level AI Studio scaffold is a blank app** (`src/App.tsx` returns an empty `<div>`, `vite.config.ts`, `@google/genai`, TypeScript 7 / Vite 8 pins). The real app is in `frontend/`. | AI Studio's preview can show blank; two competing toolchains (Tailwind v4 at root vs v3 in `frontend/`) | Keep root `package.json` scripts (they delegate to `frontend/`); delete root `src/`, `vite.config.ts`, `tsconfig.json`, `index.html` once you stop using AI Studio's preview, or point them at `frontend/` |
| 2 | JWT lives only in memory (a deliberate, good XSS choice) | **Page refresh logs the user out** — painful during a live demo | Short-term: accept and warn in demo notes. Better: httpOnly refresh cookie |
| 3 | `logout` is audit-only; tokens stay valid up to 12h | A stolen token survives logout | Add a `tokenVersion` on `User` checked in `auth.middleware`, or shorten expiry |
| 4 | Wallet link not mirrored on-chain | The 2-ticket cap is not enforced by the chain yet | Item P0-1 above |
| 5 | Stray files: `public/assets/aistudio/Paste_…` (pasted text), empty `bun.lock`, `.aistudio/` folder | Repo noise | Delete the first two; add `.aistudio/` to `.gitignore` |
| 6 | `README.md` says "Beginner friendly" but never mentions that **9 pages are placeholders** | Judges may click a placeholder | Add a "Status" table (below) and hide unfinished routes from the Navbar until built |
| 7 | Tests need a local MongoDB and have no CI | Tests can't run on a fresh machine | Add `mongodb-memory-server` for tests and a GitHub Actions workflow |
| 8 | Real secrets pattern: `.env.example` ships Hardhat's well-known dev private keys | Fine for local demo, dangerous if reused | Keep the "NEVER COMMIT / local only" comments; never deploy these keys anywhere but localhost |

## 5. Suggested next prompts (in order)

1. "Wire `blockchain.service.js` + permit signer and call `verifyWallet`/`createEvent` from existing flows."
2. "Build queue backend + `RandomizedQueuePage`."
3. "Build holds, CAPTCHA, payment, and `TimedBookingPage` + `BookingConfirmationPage`."
4. "Build tickets, QR modal, `MyTicketsPage`, then gate verify/redeem + scanner pages."
5. "Build resale + Trust Guardian."
6. "Build dashboards, `demoSeed.js`, concurrency + security tests."
