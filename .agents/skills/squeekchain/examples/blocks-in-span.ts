// blocks-in-span.ts
import { parseAbi } from "viem";
import { blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { core } = await verifyGraph();
const abi = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns ((uint64 certifiedThroughRound, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, (uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))",
]);
const read = { address: core, abi, blockNumber } as const;
const { settledThroughRound } = await client.readContract({ ...read, functionName: "state" });
const through = settledThroughRound;
const after = through > 144n ? through - 144n : 0n; // the last 144 rounds, about one day
const startPoint = await client.readContract({ ...read, functionName: "roundPage", args: [after, after, 0n] });
const endPoint = await client.readContract({ ...read, functionName: "roundPage", args: [through, through, 0n] });
const Q = 1_000_000_000n;
const completedBlocks = endPoint.end.cumulativeBlockUnits / Q - startPoint.end.cumulativeBlockUnits / Q;
const work = endPoint.end.cumulativeWork - startPoint.end.cumulativeWork;
console.log({ afterRound: after, throughRound: through, work, completedBlocks });
