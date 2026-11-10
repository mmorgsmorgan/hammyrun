// replay.ts
import { parseAbi, parseAbiItem, type Address } from "viem";
import { blockNumber, client } from "./setup";

const roundRecorded = parseAbiItem("event RoundRecorded(uint64 indexed roundId, uint64 work, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)");
const batchSettled = parseAbiItem("event BatchSettled(bytes32 indexed digest, address indexed reporter, uint64 indexed settledThroughRound, uint256 nonce, uint64 previousSettledThroughRound, uint16 activeRoundCount, uint64 cumulativeWork, uint96 cumulativeBlockUnits)");
const stakingFunded = parseAbiItem("event StakingFunded(uint64 indexed fromBlock, uint64 indexed toBlock, uint256 amount)");

const views = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function totalSupply() view returns (uint256)",
  "function totalPreminted() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
]);
const miningState = parseAbi([
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
]);
const stakingState = parseAbi([
  "function rewardState() view returns ((uint256 funded, uint256 paid, uint256 compounded, uint256 rewardIndex, uint256 remaining, uint128 totalNftPower, uint128 totalSqkPower, uint256 streamRate, uint64 lastAccruedAt, uint64 streamEndsAt))",
]);

export async function replay(core: Address, mining: Address, token: Address, staking: Address, start: bigint) {
  let frontier = 0n, blockUnits = 0n, activeRounds = 0n, recorded = 0n, funded = 0n;
  for (let from = start; from <= blockNumber; from += 1_000n) {
    const to = from + 999n < blockNumber ? from + 999n : blockNumber;
    const range = { fromBlock: from, toBlock: to, strict: true } as const;
    const [rounds, batches, fundings] = await Promise.all([
      client.getLogs({ address: core, event: roundRecorded, ...range }),
      client.getLogs({ address: core, event: batchSettled, ...range }),
      client.getLogs({ address: mining, event: stakingFunded, ...range }),
    ]);
    recorded += BigInt(rounds.length);
    for (const { args } of batches) {
      if (args.previousSettledThroughRound !== frontier) throw new Error(`Missing settlement before round ${args.settledThroughRound}`);
      frontier = args.settledThroughRound;
      blockUnits = args.cumulativeBlockUnits;
      activeRounds += BigInt(args.activeRoundCount);
    }
    for (const { args } of fundings) funded += args.amount;
  }

  const at = { blockNumber } as const;
  const [coreState, mined, rewards, supply, preminted, burned, totalMinted] = await Promise.all([
    client.readContract({ address: core, abi: views, functionName: "state", ...at }),
    client.readContract({ address: mining, abi: miningState, functionName: "state", ...at }),
    client.readContract({ address: staking, abi: stakingState, functionName: "rewardState", ...at }),
    client.readContract({ address: token, abi: views, functionName: "totalSupply", ...at }),
    client.readContract({ address: token, abi: views, functionName: "totalPreminted", ...at }),
    client.readContract({ address: token, abi: views, functionName: "totalBurned", ...at }),
    client.readContract({ address: token, abi: views, functionName: "totalMinted", ...at }),
  ]);
  const checks = {
    frontier: frontier === coreState.settledThroughRound,
    blockUnits: blockUnits === coreState.cumulativeBlockUnits,
    activeRounds: activeRounds === recorded,
    miningMinted: funded === mined.minted,
    tokenMinted: totalMinted === preminted + mined.minted,
    burns: supply + burned === totalMinted,
    stakingFunded: rewards.funded === mined.minted,
  };
  if (Object.values(checks).includes(false)) throw new Error(`Projection disagrees with contract state: ${JSON.stringify(checks)}`);
  return { blockNumber, frontier, completedBlocks: blockUnits / 1_000_000_000n, recorded, mintedBaseUnits: funded };
}
