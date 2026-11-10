> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# Index events

> Index SqueekCore, SqueekMining, SqueekStaking and SqueekNFT events, reconcile $SQK supply, and stay correct through reorgs.

Web version: https://docs.squeekchain.com/developers/index-events/

## TL;DR

- SqueekCore logs record settled work and block progress; SqueekMining logs record issuance funded into SqueekStaking; SqueekStaking logs record custody, power and account rewards.
- Reconcile supply as `totalMinted == totalPreminted + SqueekMining state().minted`, with burns counted separately in `totalBurned`; every $SQK SqueekMining mints funds SqueekStaking.
- `BatchSettled` advances the certified frontier even when no round recorded work.
- Store block hashes and log order so a reorg can roll back derived state, not just raw logs.

## Before you start

Decode with the published ABIs, which match the [Sepolia deployment](overview.md#deployments), and start at SqueekCore's deployment block, `INDEX_FROM_BLOCK` in the [environment file](overview.md#environment-file); every other event-emitting contract was deployed later.

Filter every log by verified emitter address; a matching topic isn't enough. SqueekCore, SqueekMining and SqueekStaking emit from their proxy addresses, and an upgrade can change their ABI, so track each proxy's implementation history and select the ABI for each block. SqueekToken and SqueekNFT aren't upgradeable.

## Steps

### Fetch and order logs

1. Fetch logs for the verified contract addresses in bounded Ethereum block ranges.
2. Store chain ID, block number and hash, transaction hash and index, and log index. Use `(chainId, blockHash, transactionHash, logIndex)` as the occurrence identity.
3. Process in block, transaction index and log index order.
4. After an upgrade event, verify the new implementation before choosing its ABI. Stop the projection if the code or layout is unknown.

### Know which events each action emits

| Action | Events, in order |
|---|---|
| Settlement | Zero or more SqueekCore `RoundRecorded`, then one `BatchSettled` |
| NFT premint | Per ID a SqueekNFT `Transfer` from zero, then one `GenesisPreminted(firstTokenId, lastTokenId, totalIssued)` |
| Mining start | SqueekMining `MiningBootstrapped`, then SqueekToken `MiningBound` (one binding transaction), then SqueekMining `StakingBound`, then `MiningStarted(startRound)` |
| Checkpoint | SqueekMining `StakingFunded(fromBlock, toBlock, amount)` per earning round, SqueekToken mint `Transfer` to SqueekMining and `CheckpointMinted`, SqueekToken `Transfer` to SqueekStaking, SqueekStaking `RewardFunded`, then SqueekMining `Checkpointed(throughRound, fundedBlocks, amount)` |
| NFT deposit, `deposit(...)` | Per ID SqueekStaking `Deposited` then SqueekNFT `Transfer` to SqueekStaking; then `PowerChanged` |
| NFT deposit, `safeTransferFrom` | SqueekNFT `Transfer` to SqueekStaking, then SqueekStaking `Deposited` with the previous owner as account, then `PowerChanged` |
| NFT withdrawal | Per ID SqueekStaking `Withdrawn` and SqueekNFT `Transfer` to the account, then `PowerChanged` |
| $SQK stake | SqueekStaking `Staked`, `PowerChanged`, then SqueekToken `Transfer` to SqueekStaking |
| $SQK unstake | SqueekStaking `Unstaked(account, amount, fee, net)`, `PowerChanged`, SqueekToken burn `Transfer` of the fee, then `Transfer` of the net |
| Claim | SqueekToken `Transfer` to the recipient, then SqueekStaking `RewardClaimed(account, recipient, amount)`; nothing when the amount is zero |
| Claim and stake | SqueekStaking `PowerChanged`, then `ClaimedAndStaked` |
| Wallet merge | SqueekNFT burn `Transfer` for the donor, then `Merged(survivor, donor, level, nextMergeHeight)` |
| Deposited merge | SqueekNFT burn `Transfer` and `Merged`, then SqueekStaking `DepositedMerge` and `PowerChanged` |
| NFT transfer | SqueekNFT `Transfer` only |

Index ownership from SqueekNFT `Transfer` and staking custody from `Deposited`, `Withdrawn` and `DepositedMerge`. Reverted transactions emit nothing; on a reorg, remove logs from blocks that are no longer canonical.

### Index SqueekCore

1. Start physical work and block units at zero and difficulty at `CoreInitialized.initialWorkPerThousandBlocks`.
2. For each `RoundRecorded`, price its work with the **previous** position's difficulty, then check the emitted totals and the emitted next difficulty.
3. Advance the certified frontier on every `BatchSettled`, including batches with zero active rounds. Reconcile its final totals and `activeRoundCount` with the transaction's `RoundRecorded` events, which all precede it.
4. Derive completed blocks from the change in `cumulativeBlockUnits / 1_000_000_000`. There is no per-block event, and one settlement can complete several blocks.

```ts
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
```

Follow the [price-then-steer rule](core.md#price-first-then-steer) with exact integer arithmetic.

### Index SqueekMining and SqueekToken

1. Record `MiningStarted.startRound`. Completed Squeek blocks before it never earn issuance.
2. For each checkpoint, record every `StakingFunded` range: inclusive Squeek block IDs `fromBlock`–`toBlock` and the issued `amount` in $SQK base units.
3. Count new supply once, from the mint `Transfer`, from `CheckpointMinted.amount` or from `Checkpointed.amount`; they describe the same $SQK. A checkpoint with nothing to fund emits only `Checkpointed` with `amount` `0`.
4. Count burns from SqueekToken `Transfer` events to the zero address, including SqueekStaking exit fees. Burns lower `totalSupply()` but never lower `totalMinted()` or reopen the cap.

### Index SqueekStaking

1. Track custody per `(collection, tokenId)` from `Deposited`, `Withdrawn` and `DepositedMerge` (the donor leaves custody).
2. Track each account's power from `PowerChanged(account, nftPower, sqkPower)`; it carries the full new values, effective in the same transaction.
3. Track principal from `Staked`, `ClaimedAndStaked` and `Unstaked`.
4. Track reward flows: `RewardFunded` adds $SQK to the 1,200-second stream; `RewardClaimed` pays released rewards out and `ClaimedAndStaked` moves them into principal. Per-account accrual is not logged; read `claimable(account)` for it.
5. Track claim recipients from `ClaimRecipientSet`.

### Replay and reconcile

Replay from the deployment block to one confirmed block, then compare the result with each contract's state at that block. A mismatch means a missed log, a wrong decoder or a reorg; never adjust the projection to match.

1. Require each `BatchSettled.previousSettledThroughRound` to equal the frontier you hold, so no settlement is skipped, and sum `activeRoundCount`; it must equal the number of `RoundRecorded` events.
2. Sum `StakingFunded.amount`; it must equal `Checkpointed.amount` summed and SqueekMining `state().minted`.
3. SqueekToken `totalMinted()` must equal `totalPreminted()` plus SqueekMining `state().minted`, and `totalSupply()` plus `totalBurned()` must equal `totalMinted()`.
4. SqueekStaking `rewardState().funded` must equal SqueekMining `state().minted`, because all issuance funds SqueekStaking.

```ts
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
```

A production indexer stores each log with its block hash and runs these checks continuously rather than replaying from the start.

### Handle reorgs

Keep unconfirmed data separate from the confirmed projection. When a stored block hash is no longer canonical, roll derived state back to the common ancestor and replay; deduplicating logs alone doesn't repair derived totals.

## Expected result

| Event | Projection effect |
|---|---|
| `CoreInitialized` | Stream, actors, genesis, work cap and initial difficulty; totals start at zero |
| `RoundRecorded` | One active round's work and hash, with the resulting physical total, earned total and next difficulty |
| `BatchSettled` | New certified frontier, consumed nonce, active count, and final totals |
| `GenesisPreminted` | Issued IDs: 1–8,888 with the collection's launch, 8,889–9,999 with the protocol recipient |
| `MiningStarted` | The first round whose completed Squeek blocks earn issuance |
| `StakingFunded`, `Checkpointed` | Funded Squeek block ranges and their issuance; the processed-round cursor |
| SqueekToken mint `Transfer`, `CheckpointMinted` | One aggregate mint per checkpoint, all transferred to SqueekStaking |
| `Deposited`, `Withdrawn`, `DepositedMerge` | NFT custody per account |
| `Staked`, `ClaimedAndStaked`, `Unstaked` | $SQK principal per account, fresh maturity and burned exit fees |
| `PowerChanged` | The account's current NFT and $SQK power |
| `RewardFunded`, `RewardClaimed`, `ClaimRecipientSet` | Stream funding, account payouts and claim recipients |
| `Merged`, `MergesOpenChanged` | Survivor level and next merge height; the admin's merge gate |
| Pause, Reporter and upgrade events | Availability, signer and implementation history |

Exact field lists are on each contract page: [SqueekCore](core.md#events), [SqueekMining](mining.md#events), [SqueekToken](token.md#events), [SqueekNFT](nft.md#events) and [SqueekStaking](staking.md).

## Common failures

| Failure | Cause | Fix |
|---|---|---|
| Wrong topics or tuple widths | Decoding with an earlier ABI | Select the ABI per implementation and block |
| Earned totals drift | Pricing a round with its own emitted difficulty | Use the previous position's difficulty |
| Block count is off | Dividing physical work by current difficulty | Use block units |
| Frontier lags | Ignoring zero-record `BatchSettled` | Advance on every `BatchSettled` |
| Supply doubled | Counting `CheckpointMinted`, its `Transfer` and `Checkpointed.amount` separately | Count one of them |
| Supply short by the premint | Summing only checkpoint mints against `totalMinted()` | Add `totalPreminted()` |
| Supply short after burns | Comparing mints with `totalSupply()` | Compare with `totalMinted()`, or add `totalBurned()` |
| Rewards attributed to a Squeek | Keying rewards by token ID | Key rewards by the staker's address (`account`) |
| Gaps read as zero work | No `RoundRecorded` outside a certified interval | Treat uncertified rounds as unknown |
| Totals wrong after a reorg | Deduplicating logs without rolling back | Roll back to the common ancestor and replay |

A `dataHash` commits to the round's supporting records; it is not those records or proof of physical causation.

## Verify the result

At one canonical block, compare your replayed frontier, physical total, earned total and difficulty with `SqueekCore.state()`, and selected endpoints with `roundPage(r, r, 0)`, then rerun the supply checks from [Replay and reconcile](index-events.md#replay-and-reconcile).

`BatchSettled.nonce` is the nonce that settlement consumed, not the next one. Read `state()` at the same block before preparing a new authorization.

## Related pages

- [Developers](overview.md)
- [Quickstart](quickstart.md)
- [SqueekCore](core.md)
- [SqueekMining](mining.md)
- [SqueekStaking](staking.md)
- [Build owner actions](owner-actions.md)
- [Rounds and Squeek blocks](https://docs.squeekchain.com/system/rounds-and-blocks.md)
