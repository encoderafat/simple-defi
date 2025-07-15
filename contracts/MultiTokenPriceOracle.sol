// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IMultiTokenPriceOracle.sol";

contract MultiTokenPriceOracle is IMultiTokenPriceOracle, Ownable {
    mapping(address => uint256) private tokenPrices; // Token Address -> Price in USD (with 18 decimals)

    constructor() Ownable(msg.sender) {}

    function setPrice(address token, uint256 price) external onlyOwner {
        tokenPrices[token] = price;
    }

    function getPrice(address token) external view override returns (uint256) {
        uint256 price = tokenPrices[token];
        require(price > 0, "Price not available for this token");
        return price;
    }
}