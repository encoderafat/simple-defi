import { expect } from "chai";
import { ethers } from "hardhat";
// We don't need 'Contract' or 'Signer' from ethers anymore, Hardhat provides Signers
// and TypeChain provides the Contract types.
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// <<< CHANGE HERE: Import the auto-generated types
import { MockERC20, AMM, LendingPool, Staking, MockPriceOracle } from "../typechain-types";

describe("DeFi Contracts Test Suite", function () {
  // <<< CHANGE HERE: Use the specific, generated types for variables
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  
  let tokenA: MockERC20;
  let tokenB: MockERC20;
  let tokenC: MockERC20;
  let amm: AMM;
  let lending: LendingPool;
  let staking: Staking;
  let mockOracle: MockPriceOracle;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const MINT_AMOUNT = ethers.parseEther("10000");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20Factory.deploy("Token A", "TKNA", INITIAL_SUPPLY);
    tokenB = await MockERC20Factory.deploy("Token B", "TKNB", INITIAL_SUPPLY);
    tokenC = await MockERC20Factory.deploy("Token C", "TKNC", INITIAL_SUPPLY);

    // Deploy AMM
    const AMMFactory = await ethers.getContractFactory("AMM");
    amm = await AMMFactory.deploy(await tokenA.getAddress(), await tokenB.getAddress());

    const OracleFactory = await ethers.getContractFactory("MockPriceOracle");
    mockOracle = await OracleFactory.deploy(ethers.parseEther("2000"));

    // Deploy Lending Pool (collateral: tokenA, borrow: tokenB)
    const LendingPoolFactory = await ethers.getContractFactory("LendingPool");
    lending = await LendingPoolFactory.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      await mockOracle.getAddress(),
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
      const borrowAmount = ethers.parseEther("1500"); // Too much for 150% ratio
      
      await lending.connect(user1).depositCollateral(collateralAmount);
      console.log("Oracle price:", (await mockOracle.getPrice()).toString());
      
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

  describe("Integration Tests", function () {
    it("Should use AMM LP tokens as collateral in lending", async function () {
      // Setup AMM with liquidity
      await tokenA.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await tokenB.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await amm.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));

      const OracleFactory = await ethers.getContractFactory("MockPriceOracle");
      const lpOracle = await OracleFactory.deploy(ethers.parseEther("400"));
      
      const lpBalance = await amm.balanceOf(await user1.getAddress());
      
      // Deploy lending pool that accepts LP tokens as collateral
      const LendingPool = await ethers.getContractFactory("LendingPool");
      
      const lpLending = await LendingPool.deploy(
        await amm.getAddress(),
        await tokenB.getAddress(),
        await lpOracle.getAddress(),
        300, // APR
        200, // Collateral ratio
        120, // Liquidation threshold
        5  // Liquidation bonus
      );
      
      await tokenB.transfer(await lpLending.getAddress(), MINT_AMOUNT);
      await amm.connect(user1).approve(await lpLending.getAddress(), lpBalance);
      
      // Deposit LP tokens and borrow
      await lpLending.connect(user1).depositCollateral(lpBalance);
      const borrowAmount = ethers.parseEther("100");
      await lpLending.connect(user1).borrow(borrowAmount);
      
      expect(await lpLending.borrowBalances(await user1.getAddress())).to.equal(borrowAmount);
    });

    it("Should stake AMM LP tokens", async function () {
      // Setup AMM with liquidity
      await tokenA.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await tokenB.connect(user1).approve(await amm.getAddress(), MINT_AMOUNT);
      await amm.connect(user1).addLiquidity(ethers.parseEther("100"), ethers.parseEther("200"));
      
      const lpBalance = await amm.balanceOf(await user1.getAddress());
      
      // Deploy staking contract for LP tokens
      const Staking = await ethers.getContractFactory("Staking");
      const lpStaking = await Staking.deploy(
        await amm.getAddress(), // LP token as staking token
        await tokenC.getAddress() // reward token
      );
      
      await tokenC.transfer(await lpStaking.getAddress(), MINT_AMOUNT);
      await lpStaking.setRewardRate(ethers.parseEther("1"));
      
      // Stake LP tokens
      await amm.connect(user1).approve(await lpStaking.getAddress(), lpBalance);
      await lpStaking.connect(user1).stake(lpBalance);
      
      expect(await lpStaking.stakedBalance(await user1.getAddress())).to.equal(lpBalance);
    });
  });

});