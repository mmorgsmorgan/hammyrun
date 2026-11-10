// read-issuance.ts
import { parseAbi } from "viem";
import { blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { mining } = await verifyGraph();
const abi = parseAbi([
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
  "function issuanceSchedule() view returns ((uint256 allowance, uint256 launchBonus, uint64 bonusBlocks, uint64 halvingBlocks, uint256 firstPeriodRate, uint64 startHeight))",
  "function issued(uint64 blocksSinceStart) view returns (uint256)",
  "function checkpointStatus() view returns (bool corePaused, uint64 nextRound, bool roundSettled)",
]);
const read = { address: mining, abi, blockNumber } as const;
const [state, schedule, [corePaused, nextRound, roundSettled]] = await Promise.all([
  client.readContract({ ...read, functionName: "state" }),
  client.readContract({ ...read, functionName: "issuanceSchedule" }),
  client.readContract({ ...read, functionName: "checkpointStatus" }),
]);
const scheduled = await client.readContract({ ...read, functionName: "issued", args: [state.fundedBlocks] });
const capped = scheduled < schedule.allowance ? scheduled : schedule.allowance;
if (state.minted !== capped) throw new Error("Issued SQK differs from the schedule");
console.log({
  startRound: state.startRound,
  startHeight: state.startHeight,
  fundedBlocks: state.fundedBlocks,
  mintedBaseUnits: state.minted,
  firstPeriodRate: schedule.firstPeriodRate,
  checkpoint: { corePaused, nextRound, roundSettled },
});
