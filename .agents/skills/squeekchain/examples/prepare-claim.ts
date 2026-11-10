// prepare-claim.ts
import { encodeFunctionData, getAddress, zeroAddress, type Address } from "viem";
import { client, required } from "./setup";
import { callBundle, stakingAbi } from "./staking-abi";

export async function prepareClaim(staking: Address, account: Address, caller: Address) {
  const configured = await client.readContract({ address: staking, abi: stakingAbi, functionName: "claimRecipient", args: [account] });
  const recipient = configured === zeroAddress ? getAddress(account) : getAddress(configured);
  if (recipient !== getAddress(caller)) throw new Error(`Only ${recipient} may claim for ${account}`);
  const { result } = await client.simulateContract({ address: staking, abi: stakingAbi, functionName: "claim", args: [account], account: caller });
  const data = encodeFunctionData({ abi: stakingAbi, functionName: "claim", args: [account] });
  // Present the payout, then let the recipient's wallet sign the bundle. This never sends a transaction.
  return { simulatedPayoutBaseUnits: result.toString(), recipient, bundle: callBundle(BigInt(required("EXPECTED_CHAIN_ID")), caller, staking, data) };
}
