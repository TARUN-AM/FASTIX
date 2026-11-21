# FairTicket

> **"Every Fan Deserves a Fair Ticket."**

FairTicket is an anti-scalping, anti-counterfeit event ticketing platform built for the Cybersecurity and Blockchain hackathon track (**Problem B2 — Fair Tickets**).

It combines four protection layers:
1. **Fair Ticket Booking**: Verified identity (simulated phone OTP, simulated KYC with salted hashing, MetaMask wallet ownership proof), an auditable randomized queue, backend-enforced timed booking holds with CAPTCHA, and a strict maximum of 2 active tickets per verified identity per event.
2. **Controlled Official Resale**: On-chain and backend enforcement of a 110% maximum resale price cap using integer paise math (`floor(original * 110 / 100)`), blocked direct peer-to-peer transfers, price history tracking, and off-chain logging of scalping attempts (`>= 5x` original price).
3. **Fake-Ticket Prevention**: Short-lived 30-second HMAC-signed QR codes (zero personal data inside the QR), live MongoDB-vs-blockchain ownership verification at the gate, and atomic one-time redemption (`USED`).
4. **FairTicket Trust Guardian ("Understand Before You Sign")**: Deterministic pre-signing transaction simulation (`eth_call`), calldata decoding, trusted contract checks, deterministic risk rules, and plain-English explanations before any fan signs in MetaMask.

---

## Architecture & Source of Truth

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before modifying any module. Every route, field name, enum, constant, and Solidity function signature is defined there.

---

## Ports

| Service | Port | Notes |
| --- | --- | --- |
| **Frontend (React + Vite)** | `5173` | `http://localhost:5173` |
| **Backend (Express API)** | `5000` | `http://localhost:5000/api/v1` |
| **Hardhat Local Node** | `8545` | `http://127.0.0.1:8545` (Chain ID: `31337`) |
| **MongoDB (Local Standalone)** | `27017` | `mongodb://127.0.0.1:27017/fairticket` |

---

## Prerequisites

- **Node.js** v18 LTS or v20 LTS (with `npm`)
- **MongoDB Community Server** running locally on port `27017`
- **MetaMask** browser extension configured for Hardhat Localhost (`http://127.0.0.1:8545`, Chain ID `31337`)

---

## Step-by-Step Setup (Beginner Friendly)

### 1. Install Dependencies in All Three Folders

Open a terminal in the project root and install dependencies for each workspace:

```bash
cd blockchain && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

### 2. Create Environment Files from Examples

Copy each `.env.example` to `.env`:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp blockchain/.env.example blockchain/.env
```

Generate a strong `JWT_SECRET` (at least 32 characters; the command below generates 96 hex characters) and paste it into `backend/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Start Local Services (Use Separate Terminal Windows)

**Terminal 1 — Start MongoDB (if not already running as a background service):**
```bash
mongod --dbpath /path/to/your/mongodb/data
```
*(On macOS with Homebrew: `brew services start mongodb-community`. On Linux with systemd: `sudo systemctl start mongod`. On Windows, start the `MongoDB` Windows Service.)*

**Terminal 2 — Start Local Hardhat Blockchain Node (Port 8545, Chain ID 31337):**
```bash
cd blockchain
npm run node
```

**Terminal 3 — Start Backend API Server (Port 5000):**
```bash
cd backend
npm run dev
```

**Terminal 4 — Start Frontend Dev Server (Port 5173):**
```bash
cd frontend
npm run dev
```

---

## Verification & Health Checks

**Run Backend Jest + Supertest Suite:**
```bash
cd backend
npm test
```

**Verify Local Hardhat Node Is Reachable (while Terminal 2 is running):**
```bash
cd blockchain
node scripts/checkNode.js
```

**Verify Frontend Production Build:**
```bash
cd frontend
npm run build
```

**Open the App:**
Visit `http://localhost:5173` in your browser. The Home page will automatically call `GET http://localhost:5000/api/v1/health` and show a green **Backend connected** indicator when the backend is running.
