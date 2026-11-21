const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const EVENT_ID = 1n;
const PRICE = 500000n; // Rs 5,000 in paise
const CAP = 550000n; // floor(500000 * 110 / 100)

describe("FairTicket", () => {
  let c, admin, verifier, organizer, gate, alice, aliceTwo, bob, carol, mallory;
  const ID = (s) => ethers.id(s); // deterministic bytes32 identity hashes

  async function permit(signer, types, values) {
    const hash = ethers.solidityPackedKeccak256(types, values);
    return signer.signMessage(ethers.getBytes(hash));
  }

  async function buyPrimary(buyer, qty = 1n, opts = {}) {
    const nonce = opts.nonce ?? ethers.hexlify(ethers.randomBytes(32));
    const expiry = opts.expiry ?? BigInt((await time.latest()) + 180);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const sig = await permit(
      opts.signer ?? verifier,
      ["address", "uint256", "string", "address", "uint256", "uint256", "bytes32", "uint256"],
      [await c.getAddress(), chainId, "PURCHASE", buyer.address, EVENT_ID, qty, nonce, expiry]
    );
    return c.connect(buyer).purchaseTicket(EVENT_ID, qty, nonce, expiry, sig);
  }

  async function buyResale(buyer, ticketId, price, opts = {}) {
    const nonce = opts.nonce ?? ethers.hexlify(ethers.randomBytes(32));
    const expiry = BigInt((await time.latest()) + 180);
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const sig = await permit(
      verifier,
      ["address", "uint256", "string", "address", "uint256", "uint256", "bytes32", "uint256"],
      [await c.getAddress(), chainId, "RESALE_BUY", buyer.address, ticketId, price, nonce, expiry]
    );
    return c.connect(buyer).buyResaleTicket(ticketId, nonce, expiry, sig);
  }

  beforeEach(async () => {
    [admin, verifier, organizer, gate, alice, aliceTwo, bob, carol, mallory] = await ethers.getSigners();
    c = await (await ethers.getContractFactory("FairTicket")).deploy(admin.address);
    await c.grantRole(await c.VERIFIER_ROLE(), verifier.address);
    await c.grantRole(await c.ORGANIZER_ROLE(), organizer.address);
    await c.grantRole(await c.GATE_ROLE(), gate.address);
    await c.connect(organizer).createEvent(EVENT_ID, PRICE, 10, 2);
    await c.connect(verifier).verifyWallet(alice.address, ID("alice"));
    await c.connect(verifier).verifyWallet(aliceTwo.address, ID("alice")); // same person, 2nd wallet
    await c.connect(verifier).verifyWallet(bob.address, ID("bob"));
    await c.connect(verifier).verifyWallet(carol.address, ID("carol"));
  });

  describe("integer 110% cap", () => {
    it("computes floor(original * 110 / 100)", async () => {
      expect(await c.calculateMaxResalePrice(PRICE)).to.equal(CAP);
      expect(await c.calculateMaxResalePrice(999n)).to.equal(1098n); // floor(1098.9)
    });

    it("accepts exactly the cap and rejects one paisa above", async () => {
      await buyPrimary(alice);
      await c.connect(alice).listForResale(1, CAP);
      await c.connect(alice).cancelResaleListing(1);
      await expect(c.connect(alice).listForResale(1, CAP + 1n))
        .to.be.revertedWithCustomError(c, "ResalePriceCapExceeded")
        .withArgs(CAP + 1n, CAP);
    });

    it("rejects a zero price and a 5x scalping price", async () => {
      await buyPrimary(alice);
      await expect(c.connect(alice).listForResale(1, 0)).to.be.revertedWithCustomError(c, "InvalidPrice");
      await expect(c.connect(alice).listForResale(1, PRICE * 5n)).to.be.revertedWithCustomError(c, "ResalePriceCapExceeded");
    });
  });

  describe("per-identity ticket limit", () => {
    it("allows 2 tickets and blocks the 3rd", async () => {
      await buyPrimary(alice, 2n);
      await expect(buyPrimary(alice, 1n)).to.be.revertedWithCustomError(c, "TicketLimitExceeded");
    });

    it("cannot be bypassed by a second wallet linked to the same identity", async () => {
      await buyPrimary(alice, 2n);
      await expect(buyPrimary(aliceTwo, 1n)).to.be.revertedWithCustomError(c, "TicketLimitExceeded");
    });

    it("a redeemed ticket still counts against the limit", async () => {
      await buyPrimary(alice, 2n);
      await c.connect(gate).redeemTicket(1);
      await c.connect(gate).redeemTicket(2);
      expect(await c.getActiveTicketCount(ID("alice"), EVENT_ID)).to.equal(0);
      await expect(buyPrimary(alice, 1n)).to.be.revertedWithCustomError(c, "TicketLimitExceeded");
    });

    it("rejects unverified wallets", async () => {
      await expect(buyPrimary(mallory)).to.be.revertedWithCustomError(c, "WalletNotVerified");
    });
  });

  describe("backend permits", () => {
    it("rejects a permit signed by a non-verifier", async () => {
      await expect(buyPrimary(alice, 1n, { signer: mallory })).to.be.revertedWithCustomError(c, "InvalidBackendSignature");
    });

    it("rejects an expired permit", async () => {
      const expiry = BigInt((await time.latest()) - 1);
      await expect(buyPrimary(alice, 1n, { expiry })).to.be.revertedWithCustomError(c, "AuthPermitExpired");
    });

    it("rejects replay of a used nonce", async () => {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      await buyPrimary(alice, 1n, { nonce });
      await expect(buyPrimary(alice, 1n, { nonce })).to.be.revertedWithCustomError(c, "AuthNonceAlreadyUsed");
    });

    it("rejects a permit used by a different wallet than it was issued for", async () => {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const expiry = BigInt((await time.latest()) + 180);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const sig = await permit(
        verifier,
        ["address", "uint256", "string", "address", "uint256", "uint256", "bytes32", "uint256"],
        [await c.getAddress(), chainId, "PURCHASE", alice.address, EVENT_ID, 1n, nonce, expiry]
      );
      await expect(c.connect(bob).purchaseTicket(EVENT_ID, 1n, nonce, expiry, sig))
        .to.be.revertedWithCustomError(c, "InvalidBackendSignature");
    });

    it("rejects malformed signature bytes", async () => {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const expiry = BigInt((await time.latest()) + 180);
      await expect(c.connect(alice).purchaseTicket(EVENT_ID, 1n, nonce, expiry, "0x1234"))
        .to.be.revertedWithCustomError(c, "InvalidBackendSignature");
    });
  });

  describe("resale + transfers", () => {
    beforeEach(async () => {
      await buyPrimary(alice);
      await c.connect(alice).listForResale(1, CAP);
    });

    it("blocks direct transfers unconditionally", async () => {
      await expect(c.connect(alice).transferTicket(1, bob.address)).to.be.revertedWithCustomError(c, "DirectTransferBlocked");
    });

    it("moves ownership and counts on an official resale, recording price history", async () => {
      await buyResale(bob, 1, CAP);
      expect(await c.getTicketOwner(1)).to.equal(bob.address);
      expect(await c.getActiveTicketCount(ID("alice"), EVENT_ID)).to.equal(0);
      expect(await c.getActiveTicketCount(ID("bob"), EVENT_ID)).to.equal(1);
      const history = await c.getTicketHistory(1);
      expect(history.map((h) => Number(h.action))).to.deep.equal([0, 1, 3]); // MINTED, LISTED, RESOLD
      expect(history[2].pricePaise).to.equal(CAP);
    });

    it("blocks wash-trading to your own second wallet", async () => {
      await expect(buyResale(aliceTwo, 1, CAP)).to.be.revertedWithCustomError(c, "CannotBuyOwnTicket");
    });

    it("enforces the buyer's 2-ticket limit on resale purchases", async () => {
      await buyPrimary(bob, 2n);
      await expect(buyResale(bob, 1, CAP)).to.be.revertedWithCustomError(c, "TicketLimitExceeded");
    });

    it("binds the permit to the listed price", async () => {
      await expect(buyResale(bob, 1, CAP - 1n)).to.be.revertedWithCustomError(c, "InvalidBackendSignature");
    });

    it("only the owner can list or cancel", async () => {
      await expect(c.connect(bob).cancelResaleListing(1)).to.be.revertedWithCustomError(c, "NotTicketOwner");
    });
  });

  describe("redemption", () => {
    it("redeems once, then rejects a second scan", async () => {
      await buyPrimary(alice);
      await c.connect(gate).redeemTicket(1);
      expect((await c.getTicketDetails(1)).isUsed).to.equal(true);
      await expect(c.connect(gate).redeemTicket(1)).to.be.revertedWithCustomError(c, "TicketAlreadyUsed");
    });

    it("only GATE_ROLE can redeem", async () => {
      await buyPrimary(alice);
      await expect(c.connect(alice).redeemTicket(1)).to.be.reverted;
    });

    it("clears an active resale listing on redemption and blocks later resale", async () => {
      await buyPrimary(alice);
      await c.connect(alice).listForResale(1, CAP);
      await c.connect(gate).redeemTicket(1);
      expect((await c.getResaleListing(1)).isActive).to.equal(false);
      await expect(buyResale(bob, 1, CAP)).to.be.revertedWithCustomError(c, "TicketNotListed");
    });

    it("reverts for unknown tickets", async () => {
      await expect(c.getTicketOwner(999)).to.be.revertedWithCustomError(c, "TicketNotFound");
    });
  });

  describe("supply + event controls", () => {
    it("blocks purchases when the event is deactivated", async () => {
      await c.connect(organizer).setEventStatus(EVENT_ID, false);
      await expect(buyPrimary(alice)).to.be.revertedWithCustomError(c, "EventNotActive");
    });

    it("never mints beyond total supply", async () => {
      await c.connect(organizer).createEvent(2, PRICE, 1, 2);
      // fresh event id 2 has supply 1
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const expiry = BigInt((await time.latest()) + 180);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const sig = await permit(
        verifier,
        ["address", "uint256", "string", "address", "uint256", "uint256", "bytes32", "uint256"],
        [await c.getAddress(), chainId, "PURCHASE", alice.address, 2n, 2n, nonce, expiry]
      );
      await expect(c.connect(alice).purchaseTicket(2, 2, nonce, expiry, sig))
        .to.be.revertedWithCustomError(c, "InsufficientSupply");
    });

    it("validates event parameters and role", async () => {
      await expect(c.connect(organizer).createEvent(3, PRICE, 10, 3)).to.be.revertedWithCustomError(c, "InvalidEventParameters");
      await expect(c.connect(organizer).createEvent(EVENT_ID, PRICE, 10, 2)).to.be.revertedWithCustomError(c, "EventAlreadyExists");
      await expect(c.connect(mallory).createEvent(9, PRICE, 10, 2)).to.be.reverted;
    });
  });
});
