FASTIX

Fair Tickets. Fair Prices. Zero Fakes.Built for The Big Hack 2.0 (Bengaluru) — Track 02: Cybersecurity and Blockchain (Problem B2: Fair Tickets).Problem StatementHigh-demand concerts and live events in India face three interlocking failures:Bots & Bulk Scalping: Automated scripts flood primary queues (such as the 1.3 crore queue for Coldplay's Mumbai concerts in September 2024) and drain inventory within minutes.Exploitative Secondary Markets: Tickets resurface within hours at several times face value (up to ₹3 lakh), and India has no specific anti-scalping law to deter resellers.Fake & Duplicate Tickets: Scammers sell forged tickets or repeated screenshots of valid QR codes on Instagram, WhatsApp, and Telegram—leaving genuine fans stranded at the venue gate.Why Blockchain Is Essential (Track 02 Core Rule)A centralized ticketing database requires fans and artists to blindly trust the platform not to rig queues, leak inventory, or overlook scalping. Removing the blockchain breaks FASTIX's security guarantees because the Solidity smart contract is the sole source of truth for:Per-human ticket caps enforced via privacy-preserving identity nullifiers (identityHash).Verifiable queue randomization using a commit-reveal mechanism that neither bots nor organisers can game.Blind-pool resale escrow that locks direct wallet-to-wallet transfers and eliminates off-chain side-payments.Cryptographic gate redemption that checks live on-chain ownership and atomically marks tickets as used.Key FeaturesFeatureHow It WorksAttack PreventedPrivacy-Preserving Identity BindingOne-time verification generates a salted identityHash (zero PII stored on-chain) linked to a wallet.Multi-wallet Sybil attacksVerifiable Randomized QueueVerified users enter a pre-sale window and receive randomized slots via commit-reveal instead of fastest-click-wins.Speed-based ticketing botsSmart Contract 2-Ticket CapEnforces a hard maximum of 2 active tickets per identityHash directly in Solidity.Bulk hoardingBlind-Pool Capped ResaleDirect P2P transfers (transferFrom) are disabled. Returned tickets enter an on-chain escrow pool and auto-match FIFO to the next verified fan at ≤110% of face price.Price gouging & off-chain UPI side-dealsDynamic Signed QR CodesTicket QRs rotate every 30 seconds with an EIP-712 wallet signature (ticketId, eventId, timestamp).Screenshot duplication & forged PDFsAtomic Gate Check-InGate scanner verifies signature freshness + on-chain ownership, then marks the ticket redeemed on-chain.Double-entry & counterfeit ticketsLive Attack SimulatorBuilt-in demo panel that triggers bot, scalper, and fake-QR attacks live to display real smart contract reverts.Live evidence for judgesTech StackSmart Contracts: Solidity ^0.8.24, OpenZeppelin (ERC-721), Hardhat, Ethers.js v6, ChaiBackend: Node.js, Express.js, MongoDB (Mongoose), Ethers.js v6Frontend: React 18 (Vite), Tailwind CSS, Framer Motion, Lucide React, MetaMask, qrcode.reactProject StructureFASTIX/
├── contracts/          # Solidity smart contracts, Hardhat config, deploy & security tests
├── backend/            # Express API, identity nullifier service, MongoDB models & indexer
├── frontend/           # React + Vite app (Booking, Queue, Resale, Gate Scanner, Attack Lab)
└── README.md
Quick StartPrerequisitesNode.js >= 18MongoDB (local or Atlas URI)MetaMask browser extension1. Clone the Repositorygit clone https://github.com/<your-username>/FASTIX.git
cd FASTIX
2. Deploy Smart Contracts & Run Attack Testscd contracts
npm install
npx hardhat test
npx hardhat node
# In a new terminal:
npx hardhat run scripts/deploy.js --network localhost
3. Start the Backend Servercd ../backend
npm install
cp .env.example .env
npm run dev
4. Launch the Frontendcd ../frontend
npm install
cp .env.example .env
npm run dev
Live Demo & Attack Verification FlowOrganiser Setup: Create an event on-chain with face price, total supply, and resale cap (≤110%).Fair Primary Booking: Verify identity, join the randomized queue, and mint up to 2 tickets.Blind Resale: Return a ticket to the on-chain escrow pool and watch it automatically assign to the next waitlisted fan at the capped price.Gate Check-In: Scan the live 30-second rotating signed QR code to redeem atomically on-chain.Attack Lab Proof: Trigger a multi-wallet bot (>2 tickets), a direct P2P / overpriced resale attempt, and an expired/screenshotted QR scan—confirming every attack reverts or fails verification live.Team[Team Member 1] — Smart Contracts & Security[Team Member 2] — Backend & Web3 Integration[Team Member 3] — Frontend & Motion DesignLicenseMIT License
