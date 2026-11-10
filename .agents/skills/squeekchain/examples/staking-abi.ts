// staking-abi.ts
import { getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

export const stakingAbi = parseAbi([
  "function deposit(address collection, uint256[] tokenIds)",
  "function withdraw(address collection, uint256[] tokenIds)",
  "function mergeDeposited(address collection, uint256 survivor, uint256 donor)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount, uint256 maxFee, uint64 deadline) returns (uint256 net)",
  "function claim(address account) returns (uint256 amount)",
  "function claimAndStake() returns (uint256 amount)",
  "function setClaimRecipient(address recipient)",
  "function claimRecipient(address account) view returns (address)",
  "function claimable(address account) view returns (uint256)",
  "function depositor(address collection, uint256 tokenId) view returns (address)",
  "function stakeOf(address account) view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound)",
  "function quoteUnstake(address account, uint256 amount) view returns (uint256 fee, uint256 net)",
  "function paused() view returns (bool)",
  "error Unauthorized()",
  "error EmergencyPaused()",
  "error InvalidDeposit()",
  "error InvalidWithdrawal()",
  "error InvalidStake()",
  "error InvalidUnstake()",
  "error InvalidBounds()",
  "error DeadlineExpired()",
  "error FeeLimitExceeded(uint256 fee, uint256 maxFee)",
  "error InvalidClaimRecipient()",
  "error ExclusiveClaimRecipient()",
]);

export function callBundle(chainId: bigint, from: Address, to: Address, data: Hex) {
  return { version: "2.0.0", chainId: toHex(chainId), from: getAddress(from), atomicRequired: true, calls: [{ to, data, value: "0x0" }] };
}
