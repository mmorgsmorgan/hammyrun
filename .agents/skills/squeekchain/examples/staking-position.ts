// staking-position.ts
import { getAddress, parseAbi } from "viem";
import { blockNumber, client, required } from "./setup";
import { verifyGraph } from "./verify";

const { staking } = await verifyGraph();
const account = getAddress(required("ACCOUNT_ADDRESS"));
const abi = parseAbi([
  "function accountPower(address account) view returns (uint256 nftPower, uint256 sqkPower)",
  "function stakeOf(address account) view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound)",
  "function claimable(address account) view returns (uint256)",
  "function quoteUnstake(address account, uint256 amount) view returns (uint256 fee, uint256 net)",
]);
const read = { address: staking, abi, blockNumber } as const;
const [nftPower, sqkPower] = await client.readContract({ ...read, functionName: "accountPower", args: [account] });
const [principal, freshPrincipal, freshUntilRound] = await client.readContract({ ...read, functionName: "stakeOf", args: [account] });
const rewards = await client.readContract({ ...read, functionName: "claimable", args: [account] });
const mature = principal - freshPrincipal;
const quote = mature > 0n
  ? await client.readContract({ ...read, functionName: "quoteUnstake", args: [account, mature] })
  : undefined;
console.log({ power: nftPower + sqkPower, principal, mature, freshUntilRound, rewards, quote });
