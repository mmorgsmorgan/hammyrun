// simulate-checkpoint.ts
import { parseAbi, type Address } from "viem";
import { client } from "./setup";

const miningAbi = parseAbi([
  "function checkpoint()",
  "function checkpointStatus() view returns (bool corePaused, uint64 nextRound, bool roundSettled)",
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
  "error EmergencyPaused()",
  "error StartNotScheduled()",
  "error CorePaused()",
]);

export async function simulateCheckpoint(mining: Address, caller: Address) {
  // Read the latest state, the same state the simulation uses: a Keeper may have just checkpointed.
  const blockNumber = await client.getBlockNumber();
  const [state, [corePaused, nextRound, roundSettled]] = await Promise.all([
    client.readContract({ address: mining, abi: miningAbi, functionName: "state", blockNumber }),
    client.readContract({ address: mining, abi: miningAbi, functionName: "checkpointStatus", blockNumber }),
  ]);
  if (state.paused) return { nextRound, simulated: false, reason: "SqueekMining is paused" };
  if (state.startRound === 0n) return { nextRound, simulated: false, reason: "SqueekMining start is not scheduled" };
  if (corePaused) return { nextRound, simulated: false, reason: "SqueekCore is paused" };
  if (!roundSettled) return { nextRound, simulated: false, reason: "next round is not settled" };
  await client.simulateContract({ address: mining, abi: miningAbi, functionName: "checkpoint", account: caller, blockNumber });
  return { nextRound, simulated: true };
}
