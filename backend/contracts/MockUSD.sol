// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSD
/// @notice Local virtual ERC20 token for this hiring task. It has no real-world value.
contract MockUSD is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    mapping(address => uint256) public lastFaucetClaimedAt;

    error FaucetCooldownActive(uint256 nextClaimAt);

    constructor() ERC20("Mock USD", "mUSD") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function faucet() external {
        uint256 nextClaimAt = lastFaucetClaimedAt[msg.sender] + 1 hours;
        if (block.timestamp < nextClaimAt && lastFaucetClaimedAt[msg.sender] != 0) {
            revert FaucetCooldownActive(nextClaimAt);
        }

        lastFaucetClaimedAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
