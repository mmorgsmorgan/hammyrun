// decode-round.ts — `log` is a raw log already filtered to the verified SqueekCore proxy
import { decodeEventLog, parseAbi, type Log } from "viem";

const abi = parseAbi([
  "event RoundRecorded(uint64 indexed roundId, uint64 work, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)",
]);
export function decodeRound(log: Log) {
  const { args } = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
  return {
    round: args.roundId,
    physicalWork: args.cumulativeWork,
    completedBlocks: args.cumulativeBlockUnits / 1_000_000_000n,
    blockProgress: args.cumulativeBlockUnits % 1_000_000_000n,
    nextDifficulty: BigInt(args.workPerThousandBlocks),
  };
}
