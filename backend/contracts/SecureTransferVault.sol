// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SecureTransferVault
/// @notice Candidate task: complete the protected ERC20 transfer flow.
/// @dev Transfers should be locked by a sender and claimed by the intended recipient using a secret.
contract SecureTransferVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum TransferStatus {
        Unknown,
        Created,
        Claimed,
        Refunded
    }

    struct ProtectedTransfer {
        address sender;
        address recipient;
        address token;
        uint256 amount;
        bytes32 secretHash;
        uint64 deadline;
        TransferStatus status;
    }

    uint256 public nextTransferId = 1;
    mapping(uint256 => ProtectedTransfer) public transfers;

    event TransferCreated(
        uint256 indexed transferId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint64 deadline
    );

    event TransferClaimed(uint256 indexed transferId, address indexed recipient, bytes32 secretHash);
    event TransferRefunded(uint256 indexed transferId, address indexed sender);

    error InvalidRecipient();
    error InvalidToken();
    error InvalidAmount();
    error InvalidDeadline();
    error TransferNotFound();
    error NotRecipient();
    error NotSender();
    error TransferExpired();
    error TransferNotExpired();
    error TransferAlreadyFinalised();
    error InvalidSecret();

    function createTransfer(
        address recipient,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint64 deadline
    ) external nonReentrant returns (uint256 transferId) {
        if (recipient == address(0) || recipient == msg.sender) revert InvalidRecipient();
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        transferId = nextTransferId++;

        transfers[transferId] = ProtectedTransfer({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            secretHash: secretHash,
            deadline: deadline,
            status: TransferStatus.Created
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit TransferCreated(transferId, msg.sender, recipient, token, amount, secretHash, deadline);
    }

    function claimTransfer(uint256 transferId, string calldata secret) external nonReentrant {
        ProtectedTransfer storage t = _requireExists(transferId);

        if (msg.sender != t.recipient) revert NotRecipient();
        if (t.status != TransferStatus.Created) revert TransferAlreadyFinalised();
        if (block.timestamp >= t.deadline) revert TransferExpired();

        bytes32 providedHash = keccak256(abi.encodePacked(secret));
        if (providedHash != t.secretHash) revert InvalidSecret();

        t.status = TransferStatus.Claimed;

        IERC20(t.token).safeTransfer(t.recipient, t.amount);

        emit TransferClaimed(transferId, t.recipient, t.secretHash);
    }

    function refundTransfer(uint256 transferId) external nonReentrant {
        ProtectedTransfer storage t = _requireExists(transferId);

        if (msg.sender != t.sender) revert NotSender();
        if (t.status != TransferStatus.Created) revert TransferAlreadyFinalised();
        if (block.timestamp < t.deadline) revert TransferNotExpired();

        t.status = TransferStatus.Refunded;

        IERC20(t.token).safeTransfer(t.sender, t.amount);

        emit TransferRefunded(transferId, t.sender);
    }

    function _requireExists(uint256 transferId) internal view returns (ProtectedTransfer storage t) {
        t = transfers[transferId];
        if (t.status == TransferStatus.Unknown) revert TransferNotFound();
    }
}
