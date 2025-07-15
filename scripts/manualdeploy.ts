import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  
  // 1. Deploy MockERC20 Tokens
  console.log("Deploying MockERC20 tokens...");
  
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const meth = await MockERC20.deploy(
    "Mock ETH",
    "METH",
    ethers.parseUnits("1000000", 18)
  );
  await meth.waitForDeployment();
  console.log(`METH deployed: ${await meth.getAddress()}`);
  
  const mbtc = await MockERC20.deploy(
    "Mock BTC",
    "MBTC",
    ethers.parseUnits("1000000", 18)
  );
  await mbtc.waitForDeployment();
  console.log(`MBTC deployed: ${await mbtc.getAddress()}`);
  
  // 2. Deploy Price Oracle
  console.log("Deploying MultiTokenPriceOracle...");
  const PriceOracle = await ethers.getContractFactory("MultiTokenPriceOracle");
  const priceOracle = await PriceOracle.deploy();
  await priceOracle.waitForDeployment();
  console.log(`PriceOracle deployed: ${await priceOracle.getAddress()}`);
  
  // 3. Deploy AMM
  console.log("Deploying AMM...");
  const AMM = await ethers.getContractFactory("AMM");
  const amm = await AMM.deploy(
    await meth.getAddress(),
    await mbtc.getAddress()
  );
  await amm.waitForDeployment();
  console.log(`AMM deployed: ${await amm.getAddress()}`);
  
  // 4. Deploy LendingPool
  console.log("Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(
    await mbtc.getAddress(),  // Collateral token
    await meth.getAddress(),   // Borrow token
    await priceOracle.getAddress(),
    300,    // 3% APR
    150,    // 150% collateral ratio
    120,    // 120% liquidation threshold
    5       // 5% liquidation bonus
  );
  await lendingPool.waitForDeployment();
  console.log(`LendingPool deployed: ${await lendingPool.getAddress()}`);
  
  // 5. Deploy Staking
  console.log("Deploying Staking...");
  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(
    await meth.getAddress(),
    await mbtc.getAddress()
  );
  await staking.waitForDeployment();
  console.log(`Staking deployed: ${await staking.getAddress()}`);
  
  // 6. Deploy PortfolioTracker
  console.log("Deploying PortfolioTracker...");
  const PortfolioTracker = await ethers.getContractFactory("PortfolioTracker");
  const portfolioTracker = await PortfolioTracker.deploy();
  await portfolioTracker.waitForDeployment();
  console.log(`PortfolioTracker deployed: ${await portfolioTracker.getAddress()}`);
  
  // --- POST-DEPLOYMENT CONFIGURATION ---
  console.log("\nStarting post-deployment configuration...");
  
  // A. Set prices in Oracle
  console.log("Setting token prices...");
  const mbtcPriceUSD = ethers.parseUnits("60000", 18); // $60,000
  const methPriceUSD = ethers.parseUnits("3000", 18);  // $3,000
  
  let tx = await priceOracle.setPrice(
    await mbtc.getAddress(), 
    mbtcPriceUSD
  );
  await tx.wait();
  console.log("Set MBTC price");
  
  tx = await priceOracle.setPrice(
    await meth.getAddress(), 
    methPriceUSD
  );
  await tx.wait();
  console.log("Set METH price");
  
  // B. Fund LendingPool
  console.log("Funding LendingPool...");
  const lendingPoolFunding = ethers.parseUnits("100000", 18);
  tx = await meth.transfer(
    await lendingPool.getAddress(),
    lendingPoolFunding
  );
  await tx.wait();
  console.log(`Transferred ${lendingPoolFunding} METH to LendingPool`);
  
  // C. Fund Staking and set reward rate
  console.log("Configuring Staking contract...");
  const stakingRewardFunding = ethers.parseUnits("50000", 18);
  tx = await mbtc.transfer(
    await staking.getAddress(),
    stakingRewardFunding
  );
  await tx.wait();
  console.log(`Transferred ${stakingRewardFunding} MBTC to Staking`);
  
  const rewardRate = ethers.parseUnits("0.00000001", 18);
  tx = await staking.setRewardRate(rewardRate);
  await tx.wait();
  console.log(`Set reward rate to ${rewardRate} MBTC per second`);
  
  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("Contracts:");
  console.log(`METH: ${await meth.getAddress()}`);
  console.log(`MBTC: ${await mbtc.getAddress()}`);
  console.log(`PriceOracle: ${await priceOracle.getAddress()}`);
  console.log(`AMM: ${await amm.getAddress()}`);
  console.log(`LendingPool: ${await lendingPool.getAddress()}`);
  console.log(`Staking: ${await staking.getAddress()}`);
  console.log(`PortfolioTracker: ${await portfolioTracker.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});