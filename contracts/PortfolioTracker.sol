// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AMM.sol";
import "./LendingPool.sol";
import "./Staking.sol";

contract PortfolioTracker {

    struct AMMPosition {
        address ammPair;
        uint256 lpBalance;
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
    }

    struct LendingPosition {
        address lendingPool;
        address collateralToken;
        uint256 collateralAmount;
        address borrowToken;
        uint256 borrowedAmount;
    }

    struct StakingPosition {
        address stakingPool;
        address stakingToken;
        uint256 stakedAmount;
        address rewardToken;
        uint256 pendingRewards;
    }

    struct FullPortfolio {
        AMMPosition[] ammPositions;
        LendingPosition[] lendingPositions;
        StakingPosition[] stakingPositions;
    }

    function getFullPortfolio(
        address _user,
        address[] calldata _ammPairs,
        address[] calldata _lendingPools,
        address[] calldata _stakingPools
    ) external view returns (FullPortfolio memory) {
        
        AMMPosition[] memory amms = new AMMPosition[](_ammPairs.length);
        for(uint i = 0; i < _ammPairs.length; i++) {
            amms[i] = getAMMPosition(_user, _ammPairs[i]);
        }
        
        LendingPosition[] memory lendings = new LendingPosition[](_lendingPools.length);
        for(uint i = 0; i < _lendingPools.length; i++) {
            lendings[i] = getLendingPosition(_user, _lendingPools[i]);
        }

        StakingPosition[] memory stakings = new StakingPosition[](_stakingPools.length);
        for(uint i = 0; i < _stakingPools.length; i++) {
            stakings[i] = getStakingPosition(_user, _stakingPools[i]);
        }
        
        return FullPortfolio(amms, lendings, stakings);
    }

    function getAMMPosition(address _user, address _ammPair) public view returns (AMMPosition memory) {
        AMM amm = AMM(_ammPair);
        return AMMPosition({
            ammPair: _ammPair,
            lpBalance: amm.balanceOf(_user),
            token0: amm.token0(),
            token1: amm.token1(),
            reserve0: amm.reserve0(),
            reserve1: amm.reserve1()
        });
    }

    function getLendingPosition(address _user, address _lendingPool) public view returns (LendingPosition memory) {
        LendingPool lending = LendingPool(_lendingPool);
        return LendingPosition({
            lendingPool: _lendingPool,
            collateralToken: address(lending.collateralToken()),
            collateralAmount: lending.collateralDeposits(_user),
            borrowToken: address(lending.borrowToken()),
            borrowedAmount: lending.getBorrowBalance(_user)
        });
    }

    function getStakingPosition(address _user, address _stakingPool) public view returns (StakingPosition memory) {
        Staking staking = Staking(_stakingPool);
        return StakingPosition({
            stakingPool: _stakingPool,
            stakingToken: address(staking.stakingToken()),
            stakedAmount: staking.stakedBalance(_user),
            rewardToken: address(staking.rewardToken()),
            pendingRewards: staking.earned(_user)
        });
    }
}