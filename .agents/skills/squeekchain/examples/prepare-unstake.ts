// prepare-unstake.ts
import { encodeFunctionData, type Address } from "viem";
import { client, required } from "./setup";
import { callBundle, stakingAbi } from "./staking-abi";

export async function prepareUnstake(staking: Address, account: Address, amount: bigint, maxFee: bigint, deadline: bigint) {
  const [fee, net] = await client.readContract({ address: staking, abi: stakingAbi, functionName: "quoteUnstake", args: [account, amount] });
  if (fee > maxFee) throw new Error(`Quoted fee ${fee} exceeds the accepted maximum ${maxFee}`);
  await client.simulateContract({ address: staking, abi: stakingAbi, functionName: "unstake", args: [amount, maxFee, deadline], account });
  const data = encodeFunctionData({ abi: stakingAbi, functionName: "unstake", args: [amount, maxFee, deadline] });
  return { burnedFeeBaseUnits: fee.toString(), netBaseUnits: net.toString(), bundle: callBundle(BigInt(required("EXPECTED_CHAIN_ID")), account, staking, data) };
}
