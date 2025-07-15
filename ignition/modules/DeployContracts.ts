import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ethers } from "hardhat";

const MODULE_ID = "DeployContractsModule";

const DeployContractsModule = buildModule(MODULE_ID, (m) => {
  // --- DEPLOYMENT PHASE ---
  // This phase just defines the contracts to be deployed.
  // Ignition builds a dependency graph to deploy them efficiently.

  // 1. Deploy MockERC20 Tokens (METH, MBTC)
  console.log("Defining MockERC20 token deployments...");
  const meth = m.contract("MockERC20", [
    "Mock ETH",
    "METH",
    ethers.parseUnits("1000000", 18)
  ], { id: "METH_Token" });

  const mbtc = m.contract("MockERC20", [
    "Mock BTC",
    "MBTC",
    ethers.parseUnits("1000000", 18)
  ], { id: "MBTC_Token" });

  // 2. Deploy the USD-Based MultiTokenPriceOracle
  console.log("Defining MultiTokenPriceOracle deployment...");
  const priceOracle = m.contract("MultiTokenPriceOracle", [], { id: "PriceOracle_Contract" });

  // 3. Deploy AMM (METH/MBTC Pair)
  // AMM depends on the token contracts.
  console.log("Defining AMM deployment...");
  const amm = m.contract("AMM", [meth, mbtc], { id: "AMM_Contract" });

  // 4. Deploy LendingPool (Using MBTC as Collateral to borrow METH)
  // LendingPool depends on the token and oracle contracts.
  console.log("Defining LendingPool deployment...");
  const borrowRate = 300; // Represents 3% APR
  const collateralRatio = 150; // 150%
  const liquidationThreshold = 120; // 120%
  const liquidationBonus = 5; // 5%

  const lendingPool = m.contract("LendingPool", [
    mbtc, // Collateral Token: The more valuable asset
    meth, // Borrow Token: The less valuable asset
    priceOracle,
    borrowRate,
    collateralRatio,
    liquidationThreshold,
    liquidationBonus,
  ], { id: "LendingPool_Contract" });

  // 5. Deploy Staking
  console.log("Defining Staking contract for LP tokens...");
  const staking = m.contract("Staking", [
    meth, // Staking Token:
    mbtc, // Reward Token:
  ], { id: "Staking_Contract" });

  // 6. Deploy PortfolioTracker
  // This contract has no deployment dependencies.
  console.log("Defining PortfolioTracker deployment...");
  const portfolioTracker = m.contract("PortfolioTracker", [], { id: "PortfolioTracker_Contract" });
/*
  // --- POST-DEPLOYMENT CONFIGURATION PHASE ---
  // This phase defines transactions that will run after all contracts are deployed.
  // Ignition ensures these calls happen in the correct order.

  console.log("Defining post-deployment configuration calls...");

  // A. Set initial prices in the oracle (as USD with 18 decimals)
  // This call depends on the priceOracle and token contracts being deployed.
  const mbtcPriceUSD = ethers.parseUnits("60000", 18); // $60,000
  const methPriceUSD = ethers.parseUnits("3000", 18); // $3,000
  
  m.call(priceOracle, "setPrice", [mbtc, mbtcPriceUSD], { id: "SetMBTCPrice" });
  m.call(priceOracle, "setPrice", [meth, methPriceUSD], { id: "SetMETHPrice" });

  // B. Fund the LendingPool with borrowable tokens (METH).
  // This call depends on the METH and lendingPool contracts being deployed.
  // The deployer, who owns all METH initially, sends 100k METH to the pool.
  const lendingPoolFunding = ethers.parseUnits("100000", 18);
  m.call(meth, "transfer", [lendingPool, lendingPoolFunding], { id: "FundLendingPool" });

  // C. Fund the Staking contract with reward tokens (MBTC) and set the reward rate.
  // This call depends on the MBTC and staking contracts being deployed.
  const stakingRewardFunding = ethers.parseUnits("50000", 18);
  m.call(mbtc, "transfer", [staking, stakingRewardFunding], { id: "FundStakingRewards" });

  // Set reward rate: e.g., 0.1 METH per second.
  const rewardRate = ethers.parseUnits("0.00000001", 18);
  m.call(staking, "setRewardRate", [rewardRate], { id: "SetRewardRate" });
*/
  console.log("All deployment definitions are complete!");

  // Return all deployed contracts so their addresses can be easily retrieved
  // after deployment.
  return {
    meth,
    mbtc,
    priceOracle,
    amm,
    lendingPool,
    staking,
    portfolioTracker,
  };
});

export default DeployContractsModule;