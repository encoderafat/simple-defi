// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Using OpenZeppelin's ERC20 is standard and safer.
// The Ownable import allows the deployer to mint more tokens if needed.
contract MockERC20 is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        if (initialSupply > 0) {
            _mint(msg.sender, initialSupply);
        }
    }

    // You can add a mint function for more flexibility in tests
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}