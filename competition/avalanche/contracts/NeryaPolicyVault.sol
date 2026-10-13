// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev ABI matches LFJ ILBRouter.Path. Version 2 = V2_1, 3 = V2_2.
interface ILFJRouter {
    struct Path { uint256[] pairBinSteps; uint8[] versions; IERC20[] tokenPath; }
    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, Path calldata path,
        address to, uint256 deadline
    ) external returns (uint256 amountOut);
}

/// @notice Competition prototype, not audited. Fuji or a local test EVM only.
/// @dev No arbitrary call/delegatecall, arbitrary recipient, unlimited approval,
///      LLM-controlled router or withdrawal by an agent. A signed price FLOOR
///      is not a trusted live oracle and does not enforce portfolio drawdown.
contract NeryaPolicyVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Policy {
        address agent;
        address tokenIn;
        address tokenOut;
        bytes32 strategyHash;
        uint256 maxSingle;
        uint256 maxDaily;
        uint256 maxTotal;
        uint256 minRateWad;
        uint256 expiry;
        uint256 nonce;
        uint16 binStep;
        uint8 version;
    }

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "Policy(address agent,address tokenIn,address tokenOut,bytes32 strategyHash,uint256 maxSingle,uint256 maxDaily,uint256 maxTotal,uint256 minRateWad,uint256 expiry,uint256 nonce,uint16 binStep,uint8 version)"
    );
    address public immutable owner;
    address public immutable router;
    bytes32 public activePolicyHash;
    uint256 public policyNonce;
    uint256 public executionNonce;
    Policy private active;
    mapping(bytes32 => uint256) public totalSpent;
    mapping(bytes32 => mapping(uint256 => uint256)) public dailySpent;

    error OwnerOnly();
    error WrongChain();
    error InvalidPolicy();
    error InvalidSignature();
    error PolicyReplay();
    error PolicyInactive();
    error PolicyExpired();
    error AgentOnly();
    error SingleTradeCap();
    error DailyBudgetCap();
    error TotalBudgetCap();
    error PriceFloor();
    error IntentReplay();
    error InvalidEvidence();
    error InvalidDeadline();
    error UnexpectedTokenTransfer();

    event PolicyActivated(bytes32 indexed policyHash, bytes32 indexed strategyHash, address indexed agent, uint256 expiry);
    event PolicyRevoked(bytes32 indexed policyHash, uint256 nextNonce);
    event Executed(
        bytes32 indexed policyHash, bytes32 indexed intentHash, bytes32 indexed evidenceHash,
        bytes32 strategyHash, uint256 amountIn, uint256 amountOut, uint256 nonce
    );
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert OwnerOnly(); _; }

    constructor(address owner_, address router_) EIP712("NeryaPolicyVault", "1") {
        if (block.chainid != 43113 && block.chainid != 31337) revert WrongChain();
        if (owner_ == address(0) || router_.code.length == 0) revert InvalidPolicy();
        // A local test fixture can never be substituted for LFJ on Fuji.
        if (block.chainid == 43113 && router_ != 0x18556DA13313f3532c54711497A8FedAC273220E) revert InvalidPolicy();
        owner = owner_;
        router = router_;
    }

    function hashPolicy(Policy calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(POLICY_TYPEHASH, p)));
    }

    function getPolicy() external view returns (Policy memory) { return active; }

    function activatePolicy(Policy calldata p, bytes calldata signature) external {
        if (p.nonce != policyNonce) revert PolicyReplay();
        if (p.agent == address(0) || p.tokenIn == p.tokenOut || p.tokenIn.code.length == 0 ||
            p.tokenOut.code.length == 0 || p.strategyHash == bytes32(0) || p.maxSingle == 0 ||
            p.maxDaily < p.maxSingle || p.maxTotal < p.maxSingle || p.minRateWad == 0 ||
            p.binStep == 0 || (p.version != 2 && p.version != 3)) revert InvalidPolicy();
        if (p.expiry <= block.timestamp || p.expiry > block.timestamp + 1 days) revert PolicyExpired();
        bytes32 digest = hashPolicy(p);
        if (ECDSA.recover(digest, signature) != owner) revert InvalidSignature();
        active = p;
        activePolicyHash = digest;
        ++policyNonce;
        emit PolicyActivated(digest, p.strategyHash, p.agent, p.expiry);
    }

    function revoke() external onlyOwner {
        bytes32 previous = activePolicyHash;
        activePolicyHash = bytes32(0);
        ++policyNonce;
        emit PolicyRevoked(previous, policyNonce);
    }

    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidPolicy();
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(owner, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - beforeBalance != amount) revert UnexpectedTokenTransfer();
        emit Deposited(token, amount);
    }

    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransfer(owner, amount);
        emit Withdrawn(token, amount);
    }

    function execute(
        bytes32 policyHash, uint256 amountIn, uint256 minAmountOut,
        bytes32 evidenceHash, uint256 nonce, uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (policyHash == bytes32(0) || activePolicyHash != policyHash) revert PolicyInactive();
        Policy memory p = active;
        if (msg.sender != p.agent) revert AgentOnly();
        if (block.timestamp > p.expiry) revert PolicyExpired();
        if (nonce != executionNonce) revert IntentReplay();
        if (evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (deadline < block.timestamp || deadline > p.expiry || deadline > block.timestamp + 5 minutes) revert InvalidDeadline();
        if (amountIn == 0 || amountIn > p.maxSingle) revert SingleTradeCap();
        uint256 day = block.timestamp / 1 days;
        if (dailySpent[policyHash][day] + amountIn > p.maxDaily) revert DailyBudgetCap();
        if (totalSpent[policyHash] + amountIn > p.maxTotal) revert TotalBudgetCap();
        uint256 floor = Math.mulDiv(amountIn, p.minRateWad, 1e18, Math.Rounding.Ceil);
        if (floor == 0 || minAmountOut < floor) revert PriceFloor();

        ++executionNonce;
        dailySpent[policyHash][day] += amountIn;
        totalSpent[policyHash] += amountIn;
        ILFJRouter.Path memory path;
        path.pairBinSteps = new uint256[](1);
        path.versions = new uint8[](1);
        path.tokenPath = new IERC20[](2);
        path.pairBinSteps[0] = p.binStep;
        path.versions[0] = p.version;
        path.tokenPath[0] = IERC20(p.tokenIn);
        path.tokenPath[1] = IERC20(p.tokenOut);
        uint256 beforeIn = IERC20(p.tokenIn).balanceOf(address(this));
        uint256 beforeOut = IERC20(p.tokenOut).balanceOf(address(this));
        IERC20(p.tokenIn).forceApprove(router, amountIn);
        ILFJRouter(router).swapExactTokensForTokens(amountIn, minAmountOut, path, address(this), deadline);
        IERC20(p.tokenIn).forceApprove(router, 0);
        amountOut = IERC20(p.tokenOut).balanceOf(address(this)) - beforeOut;
        if (beforeIn - IERC20(p.tokenIn).balanceOf(address(this)) != amountIn) revert UnexpectedTokenTransfer();
        if (amountOut < minAmountOut) revert PriceFloor();
        bytes32 intentHash = keccak256(abi.encode(
            block.chainid, address(this), policyHash, amountIn, minAmountOut, evidenceHash, nonce, deadline
        ));
        emit Executed(policyHash, intentHash, evidenceHash, p.strategyHash, amountIn, amountOut, nonce);
    }
}
