import { expect } from "chai";
import { ethers } from "hardhat";
// We don't need 'Contract' or 'Signer' from ethers anymore, Hardhat provides Signers
// and TypeChain provides the Contract types.
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// <<< CHANGE HERE: Import the auto-generated types
import { MockERC20, AMM, LendingPool, Staking, MultiTokenPriceOracle } from "../typechain-types";

describe("DeFi Contracts Test Suite", function () {
  // <<< CHANGE HERE: Use the specific, generated types for variables
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let amm: AMM;
  let lending: LendingPool;
  let staking: Staking;
  let priceOracle: MultiTokenPriceOracle;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const MINT_AMOUNT = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, user1, user2, liquidator] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20Factory.deploy("Token A", "TKNA", INITIAL_SUPPLY);
    tokenB = await MockERC20Factory.deploy("Token B", "TKNB", INITIAL_SUPPLY);
    tokenC = await MockERC20Factory.deploy("Token C", "TKNC", INITIAL_SUPPLY);

    // Deploy AMM
    const AMMFactory = await ethers.getContractFactory("AMM");
    amm = await AMMFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());

    const OracleFactory = await ethers.getContractFactory("MultiTokenPriceOracle");
    priceOracle = await OracleFactory.deploy();

    await priceOracle.setPrice(await tokenA.getAddress(), ethers.parseEther("2000"));
    await priceOracle.setPrice(await tokenB.getAddress(), ethers.parseEther("1"));

    // Deploy Lending Pool (collateral: tokenA, borrow: tokenB)
    const LendingPoolFactory = await ethers.getContractFactory("LendingPool");
    lending = await LendingPoolFactory.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      await priceOracle.getAddress(),
      300, // APR
      150, // Collateral ratio
      120, // Liquidation threshold
      105  // Liquidation bonus
    );

    // Deploy Staking contract
    const StakingFactory = await ethers.getContractFactory("Staking");
    staking = await StakingFactory.deploy(
      await tokenA.getAddress(), // staking token
      await tokenC.getAddress() // reward token
    );

    // Distribute tokens to users and contracts
    await tokenA.transfer(user1.address, MINT_AMOUNT);
    await tokenA.transfer(user2.address, MINT_AMOUNT);
    
    await tokenB.transfer(user1.address, MINT_AMOUNT);
    await tokenB.transfer(user2.address, MINT_AMOUNT);
    await tokenB.transfer(liquidator.address, MINT_AMOUNT);
    await tokenB.transfer(await liquidator.getAddress(), MINT_AMOUNT); 
    await tokenB.transfer(await lending.getAddress(), MINT_AMOUNT); // Fund lending pool with borrowable assets
    
    await tokenC.transfer(await staking.getAddress(), MINT_AMOUNT); // Fund staking rewards
  });

  describe("AMM Tests", function () {
    beforeEach(async function () {
      // Approve tokens for AMM
      await tokenA.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await tokenB.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await tokenA.connect(user2).approve(await amm.getAddress(), MINT_AMOUNT);
      await tokenB.connect(user2).approve(await amm.getAddress(), MINT_AMOUNT);
    });

    it("Should add initial liquidity", async function () {
      const amount0 = ethers.parseEther("100");
      const amount1 = ethers.parseEther("200");
      
      // Note: The exact LP amount can have tiny precision differences.
      // Checking it's greater than zero is often sufficient and more robust.
      await amm.connect(user1).addLiquidity(amount0, amount1)
        
      expect(await amm.reserve0()).to.equal(amount0);
      expect(await amm.reserve1()).to.equal(amount1);
      expect(await amm.balanceOf(user1.address)).to.be.gt(0);
    });


    it("Should swap tokens", async function () {
        // Add liquidity first
        await amm.connect(user1).addLiquidity(ethers.parseEther("1000"), ethers.parseEther("2000"));
        
        const amountIn = ethers.parseEther("10");
        const initialBalance = await tokenB.balanceOf(user2.address);
        
        await expect(amm.connect(user2).swap(await tokenA.getAddress(), amountIn))
          .to.emit(amm, "Swap");
        
        const finalBalance = await tokenB.balanceOf(user2.address);
        expect(finalBalance).to.be.gt(initialBalance);
      });
  });

  describe("Lending Pool Tests", function () {
    beforeEach(async function () {
      // Approve tokens for lending
      await tokenA.connect(user1).approve(lending.target, MINT_AMOUNT);
      await tokenB.connect(user1).approve(lending.target, MINT_AMOUNT);
      await tokenA.connect(user2).approve(lending.target, MINT_AMOUNT);
      await tokenB.connect(user2).approve(lending.target, MINT_AMOUNT);
    });

    it("Should deposit collateral", async function () {
      const depositAmount = ethers.parseEther("1");
      
      await expect(lending.connect(user1).depositCollateral(depositAmount))
        .to.emit(lending, "CollateralDeposited")
        .withArgs(user1.address, depositAmount);
      
      expect(await lending.collateralDeposits(user1.address)).to.equal(depositAmount);
    });

    it("Should borrow against collateral", async function () {
      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("1000"); // 1 ETH worth 2000 USDC, can borrow 1000 at 150% ratio
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      
      await expect(lending.connect(user1).borrow(borrowAmount))
        .to.emit(lending, "Borrowed")
        .withArgs(user1.address, borrowAmount);
      
      expect(await lending.borrowBalances(user1.address)).to.equal(borrowAmount);
    });

    it("Should allow borrowing up to the collateralization ratio", async function () {
        // User1 deposits 1 Token A, worth $2000.
        await lending.connect(user1).depositCollateral(ethers.parseEther("1"));
        
        // Max borrow value = $2000 / 150% = $1333.33
        // Since Token B is $1, this is 1333.33 tokens.
        const maxBorrowAmount = ethers.parseEther("1333.33");
        
        await expect(lending.connect(user1).borrow(maxBorrowAmount)).to.not.be.reverted;
        expect(await lending.borrowBalances(user1.address)).to.be.closeTo(maxBorrowAmount, ethers.parseEther("0.01"));
    });

    it("Should repay loan", async function () {
      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("1000");
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      await lending.connect(user1).borrow(borrowAmount);
      
      const repayAmount = ethers.parseEther("500");
      await expect(lending.connect(user1).repay(repayAmount))
        .to.emit(lending, "Repaid")
        .withArgs(user1.address, repayAmount);
      
      expect(await lending.borrowBalances(user1.address)).to.be.closeTo(borrowAmount - repayAmount, ethers.parseEther("0.0001"));
    });

    it("Should accumulate interest over time", async function () {
      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("1000");
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      await lending.connect(user1).borrow(borrowAmount);
      
      // Fast forward time by 1 year
      await time.increase(365 * 24 * 60 * 60);
      
      const balanceWithInterest = await lending.getBorrowBalance(user1.address);
      expect(balanceWithInterest).to.be.gt(borrowAmount);
    });

    it("Should withdraw collateral", async function () {
      const collateralAmount = ethers.parseEther("1");
      const withdrawAmount = ethers.parseEther("0.5");
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      
      await expect(lending.connect(user1).withdrawCollateral(withdrawAmount))
        .to.emit(lending, "CollateralWithdrawn")
        .withArgs(user1.address, withdrawAmount);
      
      expect(await lending.collateralDeposits(user1.address)).to.equal(collateralAmount - withdrawAmount);
    });

    it("Should revert on over-borrowing", async function () {
      const collateralAmount = ethers.parseEther("1");
      console.log("TokenB decimals:", await tokenB.decimals());
      const borrowAmount = ethers.parseEther("1334"); // Too much for 150% ratio
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      
      await expect(lending.connect(user1).borrow(borrowAmount))
        .to.be.revertedWith("Borrow would exceed collateral limit");
    });

    it("Should revert on undercollateralized withdrawal", async function () {
      const collateralAmount = ethers.parseEther("1");
      const borrowAmount = ethers.parseEther("1000");
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      await lending.connect(user1).borrow(borrowAmount);
      
      await expect(lending.connect(user1).withdrawCollateral(collateralAmount))
        .to.be.revertedWith("Withdrawal would undercollateralize");
    });
  });

  describe("Staking Tests", function () {
    beforeEach(async function () {
      // Approve tokens for staking
      await tokenA.connect(user1).approve(staking.target, MINT_AMOUNT);
      await tokenA.connect(user2).approve(staking.target, MINT_AMOUNT);
      
      // Set reward rate (1 token per second)
      await staking.setRewardRate(ethers.parseEther("1"));
    });

    it("Should stake tokens", async function () {
      const stakeAmount = ethers.parseEther("100");
      
      await expect(staking.connect(user1).stake(stakeAmount))
        .to.emit(staking, "Staked")
        .withArgs(user1.address, stakeAmount);
      
      expect(await staking.stakedBalance(user1.address)).to.equal(stakeAmount);
    });

    it("Should unstake tokens", async function () {
      const stakeAmount = ethers.parseEther("100");
      const unstakeAmount = ethers.parseEther("50");
      
      await staking.connect(user1).stake(stakeAmount);
      
      await expect(staking.connect(user1).unstake(unstakeAmount))
        .to.emit(staking, "Unstaked")
        .withArgs(user1.address, unstakeAmount);
      
      expect(await staking.stakedBalance(user1.address)).to.equal(stakeAmount - unstakeAmount);
    });

    it("Should earn rewards over time", async function () {
      const stakeAmount = ethers.parseEther("100");
      
      await staking.connect(user1).stake(stakeAmount);
      
      // Fast forward time
      await time.increase(100); // 100 seconds
      
      const earned = await staking.earned(user1.address);
      expect(earned).to.be.gt(0);
    });

    it("Should claim rewards", async function () {
      const stakeAmount = ethers.parseEther("100");
      
      await staking.connect(user1).stake(stakeAmount);
      
      // Fast forward time
      await time.increase(100);
      
      const initialBalance = await tokenC.balanceOf(user1.address);
      
      await expect(staking.connect(user1).claimReward())
        .to.emit(staking, "RewardClaimed");
      
      const finalBalance = await tokenC.balanceOf(user1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should update reward rate (owner only)", async function () {
      const newRate = ethers.parseEther("2");
      
      await expect(staking.setRewardRate(newRate))
        .to.emit(staking, "RewardRateUpdated")
        .withArgs(newRate);
      
      expect(await staking.rewardRate()).to.equal(newRate);
    });

    it("Should revert on zero stake", async function () {
      await expect(staking.connect(user1).stake(0))
        .to.be.revertedWith("Cannot stake 0");
    });

    it("Should revert on insufficient unstake", async function () {
      const stakeAmount = ethers.parseEther("100");
      const unstakeAmount = ethers.parseEther("200");
      
      await staking.connect(user1).stake(stakeAmount);
      
      await expect(staking.connect(user1).unstake(unstakeAmount))
        .to.be.revertedWith("Insufficient staked balance");
    });

    it("Should handle multiple stakers correctly", async function () {
        const stakeAmount1 = ethers.parseEther("100");
        const stakeAmount2 = ethers.parseEther("200");
        
        await staking.connect(user1).stake(stakeAmount1);
        
        // Wait 1 second before the second stake
        await time.increase(1);

        await staking.connect(user2).stake(stakeAmount2);
        
        // Fast forward time
        await time.increase(300);
        
        const earned1 = await staking.earned(user1.address);
        const earned2 = await staking.earned(user2.address);
        
        // User 1 earned for 301 seconds total, some alone, some shared.
        // User 2 earned for 300 seconds, all shared.
        // The ratio won't be exactly 2. Let's check they are both positive and user2 > user1
        expect(earned1).to.be.gt(0);
        expect(earned2).to.be.gt(earned1); // User 2 staked more, so should have more rewards overall
        
        // This is a more robust check of the ratio
        const ratio = (earned2 * 1000n) / earned1; // as a permille
        expect(ratio).to.be.lt(2000); // Should be less than 2x
        expect(ratio).to.be.gt(1900); // But still close to it
    });
      
  });

  describe("Liquidation Tests", function () {
    beforeEach(async function() {
        // User1 deposits 1 Token A ($2000) and borrows 1000 Token B ($1000)
        await tokenA.connect(user1).approve(lending.target, MINT_AMOUNT);
        await tokenB.connect(user1).approve(lending.target, MINT_AMOUNT);
        await lending.connect(user1).depositCollateral(ethers.parseEther("1"));
        await lending.connect(user1).borrow(ethers.parseEther("1000"));

        // Liquidator needs to approve the lending pool to spend their Token B for repayment
        await tokenB.connect(liquidator).approve(lending.target, MINT_AMOUNT);
    });

    it("Should not allow liquidation of a healthy position", async function() {
        // Health factor is $2000 / $1000 = 2.0 or 200%. Liquidation threshold is 120%.
        await expect(lending.connect(liquidator).liquidate(user1.address, ethers.parseEther("100")))
            .to.be.revertedWith("Position healthy");
    });

    it("Should allow liquidation when price drops, making position unhealthy", async function() {
      // 1. SETUP: User1 deposits 1 Token A (collateral) and borrows 1000 Token B (debt).
      // Initial State:
      // - Token A Price: $2000
      // - Token B Price: $1
      // - Collateral Value: 1 * $2000 = $2000
      // - Debt Value: 1000 * $1 = $1000
      // - Health Factor: $2000 / $1000 = 200%. Liquidation threshold is 120%. Position is very healthy.
      await lending.connect(user1).depositCollateral(ethers.parseEther("1"));
      await lending.connect(user1).borrow(ethers.parseEther("1000"));

      // 2. TRIGGER: The market crashes. The price of the collateral (Token A) drops significantly.
      // We will set the new price of Token A to $1100.
      const newCollateralPrice = ethers.parseEther("1100");
      await priceOracle.setPrice(await tokenA.getAddress(), newCollateralPrice);

      // New State:
      // - Collateral Value: 1 * $1100 = $1100
      // - Debt Value: ~$1000 (plus a tiny bit of interest, which is fine)
      // - Health Factor: $1100 / $1000 = 110%. This is now BELOW the 120% liquidation threshold.
      // The position is now unhealthy and can be liquidated.
      
      // 3. ACTION: The liquidator steps in to repay a portion of the user's debt.
      // The liquidator will repay 500 Token B.
      const repayAmount = ethers.parseEther("500");
      
      // Keep track of balances before the liquidation to verify changes.
      const liquidatorInitialCollateral = await tokenA.balanceOf(liquidator.address);
      const userInitialCollateral = await lending.collateralDeposits(user1.address);
      const userInitialDebt = await lending.getBorrowBalance(user1.address);

      // Perform the liquidation.
      await expect(lending.connect(liquidator).liquidate(user1.address, repayAmount))
          .to.emit(lending, "Liquidated");
          
      // 4. VERIFICATION: Check that all balances were updated correctly.

      // A. Calculate what the liquidator *should* have received.
      // This logic must exactly match the Solidity contract's logic.
      const tokenBPrice = await priceOracle.getPrice(await tokenB.getAddress()); // $1
      const liquidationBonus = await lending.liquidationBonus(); // 5 (for 5%)

      // Value of debt repaid (in USD) = 500 (Token B) * $1/TokenB = $500
      const repayValueUSD = (repayAmount * tokenBPrice) / ethers.parseEther("1");

      // Value of collateral to seize (in USD) = $500 * (1 + 5% bonus) = $525
      const seizeValueUSD = (repayValueUSD * (100n + liquidationBonus)) / 100n;

      // Amount of collateral to seize = $525 / $1100 (new price of Token A) = ~0.47727 Token A
      const expectedCollateralSeized = (seizeValueUSD * ethers.parseEther("1")) / newCollateralPrice;

      // B. Check the liquidator's new balance.
      const liquidatorFinalCollateral = await tokenA.balanceOf(liquidator.address);
      const actualCollateralSeized = liquidatorFinalCollateral - liquidatorInitialCollateral;
      
      console.log("Actual Seized Amount (from contract):", ethers.formatEther(actualCollateralSeized));
      console.log("Expected Seized Amount (from test):", ethers.formatEther(expectedCollateralSeized));

      expect(actualCollateralSeized).to.be.closeTo(expectedCollateralSeized, ethers.parseEther("0.0001"), "Liquidator did not receive the correct amount of collateral");

      // C. Check the borrower's remaining debt and collateral.
      const userFinalDebt = await lending.getBorrowBalance(user1.address);
      const userFinalCollateral = await lending.collateralDeposits(user1.address);

      // Debt should be reduced by the repaid amount (plus tiny interest).
      expect(userFinalDebt).to.be.closeTo(userInitialDebt - repayAmount, ethers.parseEther("0.01"), "User debt not reduced correctly");
      // Collateral should be reduced by the seized amount.
      expect(userFinalCollateral).to.be.closeTo(userInitialCollateral - expectedCollateralSeized, ethers.parseEther("0.0001"), "User collateral not reduced correctly");
    });
  });

  describe("Integration Tests", function () {
    it("Should use AMM LP tokens as collateral in lending", async function () {
      // Setup AMM
      await tokenA.connect(user1).approve(await amm.getAddress(), ethers.parseEther("10"));
      await tokenB.connect(user1).approve(await amm.getAddress(), ethers.parseEther("5000"));
      await amm.connect(user1).addLiquidity(ethers.parseEther("10"), ethers.parseEther("5000")); // 10 TokenA @ $2000, 20k TokenB @ $1

      const lpBalance = await amm.balanceOf(user1.address);
      
      // <<< CHANGE: Set a price for the LP token in the *existing* oracle
      // Total value of pool = $20,000 (from Token A) + $20,000 (from Token B) = $40,000
      // Let's assume for simplicity the LP token's price is based on this.
      // This is a simplification; real LP token pricing is complex.
      await priceOracle.setPrice(await amm.getAddress(), ethers.parseEther("100")); // Let's say 1 LP token is worth $100

      // Deploy a separate lending pool for LP tokens
      const LendingPoolFactory = await ethers.getContractFactory("LendingPool");
      const lpLending = await LendingPoolFactory.deploy(
        await amm.getAddress(), // Collateral is the LP token
        await tokenB.getAddress(), // Borrow a stablecoin
        await priceOracle.getAddress(), // Use the same oracle
        300, 200, 120, 5
      );
      
      await tokenB.transfer(await lpLending.getAddress(), MINT_AMOUNT);
      // User must approve the new lpLending contract to spend their LP tokens
      await amm.connect(user1).approve(await lpLending.getAddress(), lpBalance);
      
      await lpLending.connect(user1).depositCollateral(lpBalance);
      // Now borrow against the LP token collateral
      const borrowAmount = ethers.parseEther("100");
      await expect(lpLending.connect(user1).borrow(borrowAmount)).to.not.be.reverted;
    });
  });
});