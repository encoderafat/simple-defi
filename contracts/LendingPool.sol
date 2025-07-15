// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMultiTokenPriceOracle.sol";

contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public collateralToken;
    IERC20 public borrowToken;
    IMultiTokenPriceOracle public priceOracle;

    uint256 public fixedBorrowRatePerSecond; // e.g., 1e10 for ~3% APY
    uint256 public collateralizationRatio; // e.g., 150 for 150%
    uint256 public liquidationThreshold; // e.g., 120
    uint256 public liquidationBonus; // e.g., 5 = 5%

    mapping(address => uint256) public collateralDeposits;
    mapping(address => uint256) public borrowBalances;
    mapping(address => uint256) public lastAccumulatedInterestTime;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 repayAmount, uint256 collateralSeized);

    constructor(
        address _collateralToken,
        address _borrowToken,
        address _oracle,
        uint256 _borrowRate,
        uint256 _collateralRatio,
        uint256 _liquidationThreshold,
        uint256 _liquidationBonus
    ) Ownable(msg.sender) {
        collateralToken = IERC20(_collateralToken);
        borrowToken = IERC20(_borrowToken);
        priceOracle = IMultiTokenPriceOracle(_oracle);

        fixedBorrowRatePerSecond = (_borrowRate * 1e18) / (365 days * 100);
        collateralizationRatio = _collateralRatio;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
    }

    function _getAccountHealthInUSD(address user)
        internal
        view
        returns (uint256 collateralValueUSD, uint256 borrowValueUSD)
    {
        uint256 collateralPrice = priceOracle.getPrice(address(collateralToken));
        uint256 borrowPrice = priceOracle.getPrice(address(borrowToken));

        uint256 collateralAmount = collateralDeposits[user];
        uint256 borrowAmount = getBorrowBalance(user);

        // Normalize values to 18 decimals to get their USD-equivalent value
        // Won't work if the token is not of 18 decimals
        collateralValueUSD = (collateralAmount * collateralPrice) / 1e18;
        borrowValueUSD = (borrowAmount * borrowPrice) / 1e18;
    }

    function depositCollateral(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Zero deposit");
        collateralDeposits[msg.sender] += _amount;
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit CollateralDeposited(msg.sender, _amount);
    }

    function withdrawCollateral(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Zero withdraw");
        require(collateralDeposits[msg.sender] >= _amount, "Insufficient collateral");
        _accumulateInterest(msg.sender);

        // Get the current total value of the user's debt in USD.
        (, uint256 borrowValueUSD) = _getAccountHealthInUSD(msg.sender);

        // Calculate the NEW value of the collateral *after* the withdrawal.
        uint256 remainingCollateralAmount = collateralDeposits[msg.sender] - _amount;
        uint256 newCollateralValueUSD = (remainingCollateralAmount * priceOracle.getPrice(address(collateralToken))) / 1e18;

        // Calculate the maximum allowed debt value with this new, lower collateral value.
        uint256 maxBorrowValueUSD = (newCollateralValueUSD * 100) / collateralizationRatio;

        require(borrowValueUSD <= maxBorrowValueUSD, "Withdrawal would undercollateralize");

        collateralDeposits[msg.sender] -= _amount;
        collateralToken.safeTransfer(msg.sender, _amount);
        emit CollateralWithdrawn(msg.sender, _amount);
    }

    function borrow(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Zero borrow amount");
        _accumulateInterest(msg.sender);

        (uint256 collateralValueUSD, uint256 borrowValueUSD) = _getAccountHealthInUSD(msg.sender);

        // Calculate the maximum allowed total debt value in USD.
        uint256 maxBorrowValueUSD = (collateralValueUSD * 100) / collateralizationRatio;

        // Calculate the USD value of the NEW amount being borrowed.
        uint256 newBorrowValueUSD = (_amount * priceOracle.getPrice(address(borrowToken))) / 1e18;

        require(borrowValueUSD + newBorrowValueUSD <= maxBorrowValueUSD, "Borrow would exceed collateral limit");

        borrowBalances[msg.sender] += _amount;
        borrowToken.safeTransfer(msg.sender, _amount);
        emit Borrowed(msg.sender, _amount);
    }

    function repay(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Zero repay amount");
        _accumulateInterest(msg.sender);

        uint256 owed = borrowBalances[msg.sender];
        uint256 repayAmount = _amount > owed ? owed : _amount;

        borrowBalances[msg.sender] -= repayAmount;
        borrowToken.safeTransferFrom(msg.sender, address(this), repayAmount);
        emit Repaid(msg.sender, repayAmount);
    }

    // The definitively correct liquidate function for LendingPool.sol
    function liquidate(address user, uint256 repayAmount) external nonReentrant {
        // Step 1: Update user's debt with the latest interest.
        _accumulateInterest(user);

        // Step 2: Read current state into memory to ensure consistency.
        uint256 currentDebtAmount = borrowBalances[user];
        uint256 currentCollateralAmount = collateralDeposits[user];
        require(currentDebtAmount > 0, "User has no debt");

        // Step 3: Fetch current USD prices for both assets.
        uint256 collateralPriceUSD = priceOracle.getPrice(address(collateralToken));
        uint256 borrowPriceUSD = priceOracle.getPrice(address(borrowToken));
        require(collateralPriceUSD > 0, "Collateral price cannot be zero");

        // Step 4: Calculate total values in USD.
        uint256 collateralValueUSD = (currentCollateralAmount * collateralPriceUSD) / 1e18;
        uint256 borrowValueUSD = (currentDebtAmount * borrowPriceUSD) / 1e18;

        // Step 5: Check if the position is liquidatable.
        // Health Factor = (Collateral Value) / (Borrow Value)
        require(borrowValueUSD > 0, "Cannot liquidate zero debt");
        uint256 healthFactor = (collateralValueUSD * 1e18) / borrowValueUSD;
        uint256 scaledLiquidationThreshold = (liquidationThreshold * 1e18) / 100;
        require(healthFactor < scaledLiquidationThreshold, "Position healthy");

        // Step 6: Determine the actual amount of debt to be repaid.
        uint256 actualRepayAmount = repayAmount > currentDebtAmount ? currentDebtAmount : repayAmount;

        // Step 7: Calculate the value of collateral to seize.
        // This is the core logic: find the USD value of the repaid debt, add the bonus,
        // then convert that final USD value back into an *amount* of collateral tokens.
        uint256 repayValueUSD = (actualRepayAmount * borrowPriceUSD) / 1e18;
        uint256 seizeValueUSD = (repayValueUSD * (100 + liquidationBonus)) / 100;
        uint256 collateralToSeizeAmount = (seizeValueUSD * 1e18) / collateralPriceUSD;

        require(currentCollateralAmount >= collateralToSeizeAmount, "Not enough collateral for seizure");

        // Step 8: Update state and transfer funds.
        borrowBalances[user] -= actualRepayAmount;
        collateralDeposits[user] -= collateralToSeizeAmount;

        borrowToken.safeTransferFrom(msg.sender, address(this), actualRepayAmount);
        collateralToken.safeTransfer(msg.sender, collateralToSeizeAmount);

        emit Liquidated(user, msg.sender, actualRepayAmount, collateralToSeizeAmount);
    }

    function _accumulateInterest(address _user) internal {
        if (lastAccumulatedInterestTime[_user] > 0) {
            uint256 timeElapsed = block.timestamp - lastAccumulatedInterestTime[_user];
            uint256 interest = (borrowBalances[_user] * fixedBorrowRatePerSecond * timeElapsed) / 1e18;
            borrowBalances[_user] += interest;
        }
        lastAccumulatedInterestTime[_user] = block.timestamp;
    }

    function getBorrowBalance(address _user) public view returns (uint256) {
        uint256 balance = borrowBalances[_user];
        if (lastAccumulatedInterestTime[_user] > 0) {
            uint256 timeElapsed = block.timestamp - lastAccumulatedInterestTime[_user];
            uint256 interest = (balance * fixedBorrowRatePerSecond * timeElapsed) / 1e18;
            return balance + interest;
        }
        return balance;
    }

}
