// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AMM is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable token0;
    address public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;
    
    // Events for backend monitoring
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event LiquidityAdded(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );

    constructor(address _token0, address _token1) ERC20("SimpleLP", "SLP") {
        token0 = _token0;
        token1 = _token1;
    }

    function _update(uint256 _balance0, uint256 _balance1) private {
        reserve0 = _balance0;
        reserve1 = _balance1;
    }

    function addLiquidity(uint256 _amount0, uint256 _amount1) external nonReentrant returns (uint256 liquidity) {
        uint256 _reserve0 = reserve0;
        uint256 _reserve1 = reserve1;

        if (_reserve0 == 0 && _reserve1 == 0) {
            liquidity = _sqrt(_amount0 * _amount1);
            _mint(msg.sender, liquidity);
        } else {
            uint256 amount1Optimal = (_amount0 * _reserve1) / _reserve0;
            require(_amount1 >= amount1Optimal, "Insufficient amount1");
            liquidity = (_amount0 * totalSupply()) / _reserve0;
            _mint(msg.sender, liquidity);
        }

        IERC20(token0).safeTransferFrom(msg.sender, address(this), _amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), _amount1);
        
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit LiquidityAdded(msg.sender, _amount0, _amount1, liquidity);
    }

    function removeLiquidity(uint256 _liquidity) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(_liquidity > 0, "Zero liquidity");
        require(balanceOf(msg.sender) >= _liquidity, "Insufficient LP tokens");

        uint256 _totalSupply = totalSupply();
        amount0 = (_liquidity * reserve0) / _totalSupply;
        amount1 = (_liquidity * reserve1) / _totalSupply;

        _burn(msg.sender, _liquidity);
        
        IERC20(token0).safeTransfer(msg.sender, amount0);
        IERC20(token1).safeTransfer(msg.sender, amount1);

        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit LiquidityRemoved(msg.sender, amount0, amount1, _liquidity);
    }

    function swap(address _tokenIn, uint256 _amountIn) external nonReentrant returns (uint256 amountOut) {
        require(_amountIn > 0, "Zero amount in");
        require(_tokenIn == token0 || _tokenIn == token1, "Invalid token");
        
        address _tokenOut = _tokenIn == token0 ? token1 : token0;
        uint256 reserveIn = _tokenIn == token0 ? reserve0 : reserve1;
        uint256 reserveOut = _tokenIn == token0 ? reserve1 : reserve0;

        // Calculate amountOut with a 0.3% fee
        uint256 amountInWithFee = _amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
        
        require(amountOut > 0, "Insufficient output");
        
        IERC20(_tokenIn).safeTransferFrom(msg.sender, address(this), _amountIn);
        IERC20(_tokenOut).safeTransfer(msg.sender, amountOut);
        
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Swap(msg.sender, _tokenIn, _tokenOut, _amountIn, amountOut);
    }
    
    // Internal square root function for initial liquidity calculation
    function _sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}