// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title FairTicket
 * @notice Anti-scalping ticket ledger. Payments are simulated off-chain (INR paise),
 *         so this contract is the authoritative record of ownership, per-identity
 *         ticket limits, the 110% resale cap, price history and one-time redemption.
 *         Implements docs/ARCHITECTURE.md section 6 verbatim.
 *
 * Anti-bypass: purchaseTicket / buyResaleTicket require a single-use ECDSA permit
 * signed by a VERIFIER_ROLE key, issued by the backend only after queue + CAPTCHA +
 * simulated payment succeed. Calling the contract directly fails.
 */
contract FairTicket is AccessControl, ReentrancyGuard {
    using MessageHashUtils for bytes32;

    // ---------------------------------------------------------------- roles
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant GATE_ROLE = keccak256("GATE_ROLE");

    // ------------------------------------------------------------ constants
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

    // -------------------------------------------------------------- storage
    mapping(uint256 => EventRecord) private _events;
    mapping(address => bytes32) private _walletToIdentity;
    mapping(bytes32 => mapping(uint256 => uint256)) private _activeTicketCount;
    mapping(bytes32 => mapping(uint256 => uint256)) private _redeemedTicketCount;
    mapping(uint256 => TicketRecord) private _tickets;
    mapping(uint256 => ResaleListing) private _resaleListings;
    mapping(uint256 => TicketHistoryRecord[]) private _ticketHistory;
    mapping(bytes32 => bool) public usedAuthNonces;
    uint256 private _nextTicketId = 1;

    // --------------------------------------------------------------- events
    event EventCreated(uint256 indexed eventId, uint256 basePricePaise, uint256 totalSupply, uint256 maxPerIdentity);
    event EventStatusUpdated(uint256 indexed eventId, bool isActive);
    event WalletVerified(address indexed wallet, bytes32 indexed identityHash);
    event WalletRevoked(address indexed wallet, bytes32 indexed previousIdentityHash);
    event TicketPurchased(uint256 indexed ticketId, uint256 indexed eventId, address indexed buyer, bytes32 identityHash, uint256 pricePaise);
    event TicketListedForResale(uint256 indexed ticketId, uint256 indexed eventId, address indexed seller, uint256 askingPricePaise, uint256 maxAllowedPricePaise);
    event ResaleListingCancelled(uint256 indexed ticketId, address indexed seller);
    event TicketResold(uint256 indexed ticketId, uint256 indexed eventId, address indexed seller, address buyer, uint256 salePricePaise);
    event TicketRedeemed(uint256 indexed ticketId, uint256 indexed eventId, address indexed owner, uint256 redeemedAt);

    // --------------------------------------------------------------- errors
    error EventAlreadyExists(uint256 eventId);
    error EventNotFound(uint256 eventId);
    error EventNotActive(uint256 eventId);
    error InvalidEventParameters();
    error WalletNotVerified(address wallet);
    error InvalidIdentityHash();
    error InvalidQuantity();
    error InsufficientSupply(uint256 requested, uint256 remaining);
    error TicketLimitExceeded(bytes32 identityHash, uint256 eventId, uint256 currentTotal, uint256 maxAllowed);
    error AuthPermitExpired(uint256 authExpiry);
    error AuthNonceAlreadyUsed(bytes32 authNonce);
    error InvalidBackendSignature();
    error TicketNotFound(uint256 ticketId);
    error NotTicketOwner(address caller, address actualOwner);
    error TicketAlreadyUsed(uint256 ticketId);
    error TicketAlreadyListed(uint256 ticketId);
    error TicketNotListed(uint256 ticketId);
    error InvalidPrice();
    error ResalePriceCapExceeded(uint256 askingPricePaise, uint256 maxAllowedPricePaise);
    error CannotBuyOwnTicket();
    error DirectTransferBlocked();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------- event registry
    function createEvent(
        uint256 eventId,
        uint256 basePricePaise,
        uint256 totalSupply,
        uint256 maxPerIdentity
    ) external onlyRole(ORGANIZER_ROLE) {
        if (_events[eventId].exists) revert EventAlreadyExists(eventId);
        if (
            eventId == 0 ||
            basePricePaise == 0 ||
            totalSupply == 0 ||
            maxPerIdentity == 0 ||
            maxPerIdentity > MAX_ACTIVE_TICKETS
        ) revert InvalidEventParameters();

        _events[eventId] = EventRecord({
            eventId: eventId,
            basePricePaise: basePricePaise,
            totalSupply: totalSupply,
            mintedCount: 0,
            maxPerIdentity: maxPerIdentity,
            isActive: true,
            exists: true
        });
        emit EventCreated(eventId, basePricePaise, totalSupply, maxPerIdentity);
    }

    function setEventStatus(uint256 eventId, bool isActive) external onlyRole(ORGANIZER_ROLE) {
        if (!_events[eventId].exists) revert EventNotFound(eventId);
        _events[eventId].isActive = isActive;
        emit EventStatusUpdated(eventId, isActive);
    }

    // ------------------------------------------------------ identity wallet
    function verifyWallet(address wallet, bytes32 identityHash) external onlyRole(VERIFIER_ROLE) {
        if (identityHash == bytes32(0)) revert InvalidIdentityHash();
        _walletToIdentity[wallet] = identityHash;
        emit WalletVerified(wallet, identityHash);
    }

    function revokeWallet(address wallet) external onlyRole(VERIFIER_ROLE) {
        bytes32 previous = _walletToIdentity[wallet];
        _walletToIdentity[wallet] = bytes32(0);
        emit WalletRevoked(wallet, previous);
    }

    function checkTicketLimit(
        bytes32 identityHash,
        uint256 eventId,
        uint256 additionalQuantity
    )
        external
        view
        returns (bool allowed, uint256 currentActive, uint256 currentRedeemed, uint256 maxAllowed)
    {
        maxAllowed = _events[eventId].maxPerIdentity;
        currentActive = _activeTicketCount[identityHash][eventId];
        currentRedeemed = _redeemedTicketCount[identityHash][eventId];
        allowed = currentActive + currentRedeemed + additionalQuantity <= maxAllowed;
    }

    // ----------------------------------------------------- primary purchase
    function purchaseTicket(
        uint256 eventId,
        uint256 quantity,
        bytes32 authNonce,
        uint256 authExpiry,
        bytes calldata backendSignature
    ) external nonReentrant returns (uint256[] memory ticketIds) {
        bytes32 idHash = _requireVerified(msg.sender);
        _validatePurchase(eventId, quantity, idHash);

        bytes32 digest = _purchaseDigest(eventId, quantity, authNonce, authExpiry);
        _consumePermit(digest, authNonce, authExpiry, backendSignature);

        ticketIds = _mintBatch(eventId, quantity, idHash);
    }

    function _validatePurchase(uint256 eventId, uint256 quantity, bytes32 idHash) private view {
        EventRecord storage ev = _events[eventId];
        if (!ev.exists) revert EventNotFound(eventId);
        if (!ev.isActive) revert EventNotActive(eventId);
        if (quantity == 0) revert InvalidQuantity();
        if (quantity > ev.totalSupply - ev.mintedCount) {
            revert InsufficientSupply(quantity, ev.totalSupply - ev.mintedCount);
        }
        _enforceLimit(idHash, eventId, quantity, ev.maxPerIdentity);
    }

    function _purchaseDigest(
        uint256 eventId,
        uint256 quantity,
        bytes32 authNonce,
        uint256 authExpiry
    ) private view returns (bytes32) {
        bytes memory prefix = abi.encodePacked(address(this), block.chainid, "PURCHASE", msg.sender);
        return keccak256(abi.encodePacked(prefix, eventId, quantity, authNonce, authExpiry));
    }

    function _mintBatch(uint256 eventId, uint256 quantity, bytes32 idHash) private returns (uint256[] memory ticketIds) {
        EventRecord storage ev = _events[eventId];
        ticketIds = new uint256[](quantity);
        for (uint256 i = 0; i < quantity; i++) {
            ticketIds[i] = _mint(ev, msg.sender, idHash);
        }
        ev.mintedCount += quantity;
        _activeTicketCount[idHash][eventId] += quantity;
    }

    function _mint(EventRecord storage ev, address buyer, bytes32 idHash) private returns (uint256 ticketId) {
        ticketId = _nextTicketId++;
        _tickets[ticketId] = TicketRecord({
            ticketId: ticketId,
            eventId: ev.eventId,
            originalOwner: buyer,
            currentOwner: buyer,
            currentOwnerIdentityHash: idHash,
            originalPricePaise: ev.basePricePaise,
            lastSalePricePaise: ev.basePricePaise,
            isListedForResale: false,
            isUsed: false,
            mintedAt: block.timestamp,
            redeemedAt: 0
        });
        _ticketHistory[ticketId].push(
            TicketHistoryRecord(HistoryAction.MINTED, address(0), buyer, ev.basePricePaise, block.timestamp)
        );
        emit TicketPurchased(ticketId, ev.eventId, buyer, idHash, ev.basePricePaise);
    }

    // ----------------------------------------------------- controlled resale
    function listForResale(uint256 ticketId, uint256 askingPricePaise) external {
        TicketRecord storage t = _getTicket(ticketId);
        if (t.currentOwner != msg.sender) revert NotTicketOwner(msg.sender, t.currentOwner);
        _requireVerified(msg.sender);
        if (t.isUsed) revert TicketAlreadyUsed(ticketId);
        if (t.isListedForResale) revert TicketAlreadyListed(ticketId);
        if (askingPricePaise == 0) revert InvalidPrice();

        uint256 maxAllowed = calculateMaxResalePrice(t.originalPricePaise);
        if (askingPricePaise > maxAllowed) revert ResalePriceCapExceeded(askingPricePaise, maxAllowed);

        t.isListedForResale = true;
        _resaleListings[ticketId] = ResaleListing({
            ticketId: ticketId,
            seller: msg.sender,
            askingPricePaise: askingPricePaise,
            isActive: true,
            listedAt: block.timestamp
        });
        _ticketHistory[ticketId].push(
            TicketHistoryRecord(HistoryAction.LISTED_FOR_RESALE, msg.sender, address(0), askingPricePaise, block.timestamp)
        );
        emit TicketListedForResale(ticketId, t.eventId, msg.sender, askingPricePaise, maxAllowed);
    }

    function cancelResaleListing(uint256 ticketId) external {
        TicketRecord storage t = _getTicket(ticketId);
        if (t.currentOwner != msg.sender) revert NotTicketOwner(msg.sender, t.currentOwner);
        if (!t.isListedForResale) revert TicketNotListed(ticketId);

        t.isListedForResale = false;
        delete _resaleListings[ticketId];
        _ticketHistory[ticketId].push(
            TicketHistoryRecord(HistoryAction.RESALE_CANCELLED, msg.sender, address(0), 0, block.timestamp)
        );
        emit ResaleListingCancelled(ticketId, msg.sender);
    }

    function buyResaleTicket(
        uint256 ticketId,
        bytes32 authNonce,
        uint256 authExpiry,
        bytes calldata backendSignature
    ) external nonReentrant {
        bytes32 buyerId = _requireVerified(msg.sender);
        _validateResale(ticketId, buyerId);

        bytes32 digest = _resaleDigest(ticketId, authNonce, authExpiry);
        _consumePermit(digest, authNonce, authExpiry, backendSignature);

        _executeResale(ticketId, buyerId);
    }

    function _validateResale(uint256 ticketId, bytes32 buyerId) private view {
        TicketRecord storage t = _getTicket(ticketId);
        if (!_resaleListings[ticketId].isActive || !t.isListedForResale) revert TicketNotListed(ticketId);
        if (t.isUsed) revert TicketAlreadyUsed(ticketId);
        // Blocks buying from yourself AND wash-trading between your own wallets.
        if (msg.sender == t.currentOwner || buyerId == t.currentOwnerIdentityHash) revert CannotBuyOwnTicket();
        _enforceLimit(buyerId, t.eventId, 1, _events[t.eventId].maxPerIdentity);
    }

    function _resaleDigest(
        uint256 ticketId,
        bytes32 authNonce,
        uint256 authExpiry
    ) private view returns (bytes32) {
        bytes memory prefix = abi.encodePacked(address(this), block.chainid, "RESALE_BUY", msg.sender);
        // The price is read from the on-chain listing, so the permit is bound to
        // the exact price the buyer was shown.
        return keccak256(
            abi.encodePacked(prefix, ticketId, _resaleListings[ticketId].askingPricePaise, authNonce, authExpiry)
        );
    }

    function _executeResale(uint256 ticketId, bytes32 buyerId) private {
        TicketRecord storage t = _tickets[ticketId];
        address seller = t.currentOwner;
        bytes32 sellerId = t.currentOwnerIdentityHash;
        uint256 eventId = t.eventId;
        uint256 price = _resaleListings[ticketId].askingPricePaise;

        _activeTicketCount[sellerId][eventId] -= 1;
        _activeTicketCount[buyerId][eventId] += 1;

        t.currentOwner = msg.sender;
        t.currentOwnerIdentityHash = buyerId;
        t.lastSalePricePaise = price;
        t.isListedForResale = false;
        delete _resaleListings[ticketId];

        _ticketHistory[ticketId].push(
            TicketHistoryRecord(HistoryAction.RESOLD, seller, msg.sender, price, block.timestamp)
        );
        emit TicketResold(ticketId, eventId, seller, msg.sender, price);
    }

    /// @notice Direct peer-to-peer transfers are never allowed.
    function transferTicket(uint256 /* ticketId */, address /* to */) external pure {
        revert DirectTransferBlocked();
    }

    // ---------------------------------------------------------- redemption
    function redeemTicket(uint256 ticketId) external onlyRole(GATE_ROLE) {
        TicketRecord storage t = _getTicket(ticketId);
        if (t.isUsed) revert TicketAlreadyUsed(ticketId);

        if (t.isListedForResale) {
            t.isListedForResale = false;
            delete _resaleListings[ticketId];
        }
        t.isUsed = true;
        t.redeemedAt = block.timestamp;

        bytes32 ownerId = t.currentOwnerIdentityHash;
        _activeTicketCount[ownerId][t.eventId] -= 1;
        _redeemedTicketCount[ownerId][t.eventId] += 1;

        _ticketHistory[ticketId].push(
            TicketHistoryRecord(HistoryAction.REDEEMED, t.currentOwner, address(0), 0, block.timestamp)
        );
        emit TicketRedeemed(ticketId, t.eventId, t.currentOwner, block.timestamp);
    }

    // --------------------------------------------------------------- views
    function getTicketOwner(uint256 ticketId) external view returns (address) {
        return _getTicket(ticketId).currentOwner;
    }

    function getTicketDetails(uint256 ticketId) external view returns (TicketRecord memory) {
        return _getTicket(ticketId);
    }

    function getTicketHistory(uint256 ticketId) external view returns (TicketHistoryRecord[] memory) {
        _getTicket(ticketId);
        return _ticketHistory[ticketId];
    }

    function getResaleListing(uint256 ticketId) external view returns (ResaleListing memory) {
        return _resaleListings[ticketId];
    }

    function getEventDetails(uint256 eventId) external view returns (EventRecord memory) {
        return _events[eventId];
    }

    function getActiveTicketCount(bytes32 identityHash, uint256 eventId) external view returns (uint256) {
        return _activeTicketCount[identityHash][eventId];
    }

    function getIdentityForWallet(address wallet) external view returns (bytes32) {
        return _walletToIdentity[wallet];
    }

    function calculateMaxResalePrice(uint256 originalPricePaise) public pure returns (uint256) {
        return (originalPricePaise * RESALE_CAP_PERCENT) / 100;
    }

    // ------------------------------------------------------------ internals
    function _requireVerified(address wallet) private view returns (bytes32 idHash) {
        idHash = _walletToIdentity[wallet];
        if (idHash == bytes32(0)) revert WalletNotVerified(wallet);
    }

    function _getTicket(uint256 ticketId) private view returns (TicketRecord storage t) {
        t = _tickets[ticketId];
        if (t.ticketId == 0) revert TicketNotFound(ticketId);
    }

    function _enforceLimit(bytes32 idHash, uint256 eventId, uint256 additional, uint256 maxPerIdentity) private view {
        uint256 total = _activeTicketCount[idHash][eventId] + _redeemedTicketCount[idHash][eventId] + additional;
        if (total > maxPerIdentity) revert TicketLimitExceeded(idHash, eventId, total, maxPerIdentity);
    }

    /// Validates expiry, single-use nonce and that a VERIFIER_ROLE key signed `digest`.
    function _consumePermit(
        bytes32 digest,
        bytes32 authNonce,
        uint256 authExpiry,
        bytes calldata signature
    ) private {
        if (block.timestamp > authExpiry) revert AuthPermitExpired(authExpiry);
        if (usedAuthNonces[authNonce]) revert AuthNonceAlreadyUsed(authNonce);

        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest.toEthSignedMessageHash(), signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(VERIFIER_ROLE, signer)) {
            revert InvalidBackendSignature();
        }
        usedAuthNonces[authNonce] = true;
    }
}
