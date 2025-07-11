// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IPriceOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockPriceOracle is IPriceOracle, Ownable {
    uint256 private price;

    constructor(uint256 _price) Ownable(msg.sender) {
        price = _price;
    }

    function setPrice(uint256 _price) external onlyOwner {
        price = _price;
    }

    function getPrice() external view override returns (uint256) {
        return price;
    }
}
