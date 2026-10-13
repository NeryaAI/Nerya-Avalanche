// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILFJRouter} from "../NeryaPolicyVault.sol";

/// @dev Intentionally a fixture. Cannot deploy on Fuji or mainnet.
contract LocalToken is ERC20 {
    uint8 private immutable precision;
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        require(block.chainid == 31337, "LOCAL_TEST_ONLY"); precision = decimals_;
    }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 value) external { _mint(to, value); }
}

/// @dev Tests PolicyVault semantics, NOT LFJ liquidity or economics.
contract LocalRouterFixture is ILFJRouter {
    uint256 public rateWad;
    bool public underpay;
    constructor(uint256 rate_) { require(block.chainid == 31337, "LOCAL_TEST_ONLY"); rateWad = rate_; }
    function setRate(uint256 rate_) external { rateWad = rate_; }
    function setUnderpay(bool value) external { underpay = value; }
    function swapExactTokensForTokens(
        uint256 amountIn, uint256 minOut, Path calldata path, address to, uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "DEADLINE");
        require(path.tokenPath.length == 2 && path.pairBinSteps.length == 1 && path.versions.length == 1, "PATH");
        IERC20(path.tokenPath[0]).transferFrom(msg.sender, address(this), amountIn);
        amountOut = Math.mulDiv(amountIn, rateWad, 1e18);
        require(amountOut >= minOut, "MIN_OUT");
        IERC20(path.tokenPath[1]).transfer(to, underpay ? 1 : amountOut);
    }
}
