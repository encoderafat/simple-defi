// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPriceOracle.sol";

contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public collateralToken;
    IERC20 public borrowToken;
    IPriceOracle public priceOracle;

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
        priceOracle = IPriceOracle(_oracle);

        fixedBorrowRatePerSecond = (_borrowRate * 1e18) / (365 days * 100);
        collateralizationRatio = _collateralRatio;
        liquidationThreshold = _liquidationThreshold;
        liquidationBonus = _liquidationBonus;
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

        uint256 remainingCollateral = collateralDeposits[msg.sender] - _amount;
        uint256 collateralValue = (remainingCollateral * getPrice()) / 1e18;
        uint256 maxBorrowable = (collateralValue * 100) / collateralizationRatio;

        require(getBorrowBalance(msg.sender) <= maxBorrowable, "Withdrawal would undercollateralize");

        collateralDeposits[msg.sender] -= _amount;
        collateralToken.safeTransfer(msg.sender, _amount);
        emit CollateralWithdrawn(msg.sender, _amount);
    }

    function borrow(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Zero borrow amount");
        _accumulateInterest(msg.sender);

        uint256 collateralValue = (collateralDeposits[msg.sender] * getPrice()) / 1e18;
        uint256 maxBorrowable = (collateralValue * 100) / collateralizationRatio;

        require(borrowBalances[msg.sender] + _amount <= maxBorrowable, "Borrow would exceed collateral limit");

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

    function liquidate(address user, uint256 repayAmount) external nonReentrant {
        require(repayAmount > 0, "Zero repay amount");
        _accumulateInterest(user);

        uint256 debt = borrowBalances[user];
        require(debt > 0, "User has no debt");

        uint256 collateralValue = (collateralDeposits[user] * getPrice()) / 1e18;
        uint256 healthFactor = (collateralValue * 100) / debt;

        require(healthFactor < liquidationThreshold, "Position healthy");

        uint256 actualRepay = repayAmount > debt ? debt : repayAmount;
        
        uint256 seizeValue = (actualRepay * (100 + liquidationBonus)) / 100;
    
        // Now convert that value back to an *amount* of collateral tokens.
        // Amount = Value / Price
        uint256 collateralToSeize = (seizeValue * 1e18) / getPrice();

        require(collateralDeposits[user] >= collateralToSeize, "Not enough collateral for seizure");

        borrowBalances[user] -= actualRepay;
        collateralDeposits[user] -= collateralToSeize;

        borrowToken.safeTransferFrom(msg.sender, address(this), actualRepay);
        collateralToken.safeTransfer(msg.sender, collateralToSeize);

        emit Liquidated(user, msg.sender, actualRepay, collateralToSeize);
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

    function getPrice() public view returns (uint256) {
        return priceOracle.getPrice();
    }
}
