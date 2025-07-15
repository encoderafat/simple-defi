import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

require('dotenv').config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      viaIR: true,
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: "custom-salt", // Disables parallel deployments
      },
    },
  },
  networks: {
    hardhat: {  // Add this configuration
      chainId: 1337,
      allowUnlimitedContractSize: false,
    },
    blockDAGtestnet: {
      url: 'https://rpc.primordial.bdagscan.com/',
      accounts: [process.env.DEPLOY_WALLET_1 as string],
      // Add these options to help with nonce issues
      timeout: 60000,
      gas: 30000000, // 30M gas limit
      gasPrice: 20000000000, // 20 gwei
      // Force nonce management
      allowUnlimitedContractSize: true,
    },
  },
  etherscan: {
    apiKey: {
      blockDAGtestnet: 'abc',
    },
    customChains: [
      {
        network: 'blockDAGtestnet',
        chainId: 1043,
        urls: {
          apiURL: 'https://api.primordial.bdagscan.com/',
          browserURL: 'https://primordial.bdagscan.com/',
        },
      },
    ],
  },
};


export default config;
