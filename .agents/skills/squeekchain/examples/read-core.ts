// read-core.ts
import { parseAbi } from "viem";
import { block, blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { core } = await verifyGraph();
const abi = parseAbi([
  "function configuration() view returns ((bytes32 streamId, uint64 genesisTimestamp, uint64 roundDuration, uint64 maxWorkPerRound, uint16 maxRoundsPerBatch, address guardian, address reporter, uint32 initialWorkPerThousandBlocks, uint64 targetBlocksPerActiveRound, uint64 difficultySmoothingRounds, uint96 blockUnitsPerBlock))",
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns ((uint64 certifiedThroughRound, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, (uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))",
]);
const read = { address: core, abi, blockNumber } as const;
const config = await client.readContract({ ...read, functionName: "configuration" });
const state = await client.readContract({ ...read, functionName: "state" });
const units = config.blockUnitsPerBlock;
if (state.blockHeight !== state.cumulativeBlockUnits / units || state.blockProgress !== state.cumulativeBlockUnits % units) {
  throw new Error("Inconsistent block units");
}
const frontier = state.settledThroughRound;
const point = await client.readContract({ ...read, functionName: "roundPage", args: [frontier, frontier, 0n] });
if (
  point.certifiedThroughRound !== frontier ||
  point.end.cumulativeBlockUnits !== state.cumulativeBlockUnits ||
  point.end.workPerThousandBlocks !== state.workPerThousandBlocks
) throw new Error("Inconsistent frontier endpoint");
const currentRound = block.timestamp < config.genesisTimestamp
  ? 0n
  : (block.timestamp - config.genesisTimestamp) / config.roundDuration + 1n;
console.log({ blockNumber, blockHash: block.hash, currentRound, frontier, height: state.blockHeight, state });
