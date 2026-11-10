> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# SqueekCore

> SqueekCore function by function: settled work, block progress, difficulty, settlement, events, errors and the published ABI.

Web version: https://docs.squeekchain.com/developers/core/

## TL;DR

- SqueekCore records settled work per ten-minute round and converts it into Squeek block progress at an adaptive difficulty.
- Read `state()` for height and progress and `roundPage` for history; only the Reporter's signed settlements change them.
- Count blocks from block units, never from physical work divided by difficulty.
- Call the Sepolia proxy listed under [Deployments](overview.md#deployments), not its implementation.

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

SqueekCore is the onchain work ledger. A settlement certifies a span of rounds: listed rounds record their work and data hash; omitted rounds record zero work. Core converts each listed round's work into block units (billionths of a Squeek block) at the current difficulty, then updates that difficulty. The contract mints nothing and calls no other contract; SqueekMining reads it.

## Functions

### Types

```solidity
struct CoreState {
    uint64 settledThroughRound;    // certified frontier: every round ≤ this is settled
    uint64 cumulativeWork;         // physical work units, all time
    uint96 cumulativeBlockUnits;   // earned progress; 10^9 units = one Squeek block
    uint64 blockHeight;            // cumulativeBlockUnits / 10^9
    uint96 blockProgress;          // cumulativeBlockUnits % 10^9
    uint32 workPerThousandBlocks;  // difficulty for the next active round
    uint256 authorizationNonce;    // nonce the next settlement signature must use
    bool paused;
}

struct CoreConfiguration {
    bytes32 streamId;
    uint64 genesisTimestamp;           // seconds; round 1 starts here
    uint64 roundDuration;              // 600 seconds
    uint64 maxWorkPerRound;            // work units
    uint16 maxRoundsPerBatch;          // 16
    address guardian;
    address reporter;
    uint32 initialWorkPerThousandBlocks;
    uint64 targetBlocksPerActiveRound; // 40
    uint64 difficultySmoothingRounds;  // 30
    uint96 blockUnitsPerBlock;         // 1_000_000_000
}

struct Round { uint64 roundId; uint64 work; bytes32 dataHash; }

struct LedgerPosition { uint64 cumulativeWork; uint96 cumulativeBlockUnits; uint32 workPerThousandBlocks; }

struct RoundCheckpoint {
    uint64 roundId;
    uint64 cumulativeWork;
    uint96 cumulativeBlockUnits;
    uint32 workPerThousandBlocks;   // difficulty after this round steered
    bytes32 dataHash;
}

struct RoundPage {
    uint64 certifiedThroughRound;   // last round this answer covers completely
    LedgerPosition start;           // position after afterRound
    LedgerPosition end;             // position after certifiedThroughRound
    RoundCheckpoint[] rounds;       // active rounds only, oldest first
}

struct BlockInfo { uint64 roundId; uint64 workThreshold; }

struct SqueekLaunchConfig {
    bytes32 streamId;
    address guardian;
    address initialReporter;
    uint64 genesisTimestamp;
    uint32 initialWorkPerThousandBlocks;
    uint64 maxWorkPerRound;
}
```

`uint32` difficulty decodes to `number` in viem; every other numeric field here decodes to `bigint`.

### Views

#### `state`

```solidity
function state() external view returns (CoreState result);
```

Current ledger position, height and progress, certified frontier, authorization nonce and pause flag. Rounds after `settledThroughRound` are unknown, not zero.

#### `roundPage`

```solidity
function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) external view returns (RoundPage result);
```

Up to `maxRecords` active rounds after `afterRound`, with the ledger positions at both ends.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `afterRound` | `uint64` | round | Exclusive start |
| `throughRound` | `uint64` | round | Inclusive requested end; at most `settledThroughRound` |
| `maxRecords` | `uint256` | records | 0–16 active rounds to return |

If the next active round would exceed `maxRecords`, the page stops before it; continue from the returned `certifiedThroughRound`, not `throughRound`. For a point read at certified round `r`, use `roundPage(r, r, 0).end`; round 0 returns the launch position. Reverts with `InvalidRoundPageBounds` for a reversed range, an end past the frontier, or more than 16 records.

#### `blockInfo`

```solidity
function blockInfo(uint64 squeekBlock) external view returns (BlockInfo result);
```

The round that completed Squeek block `squeekBlock` (from 1 to `blockHeight`) and the cumulative physical work at which it completed, computed at that round's pre-steering difficulty. Reverts with `BlockNotSettled` for block 0 or a block not yet completed.

#### `configuration`

```solidity
function configuration() external view returns (CoreConfiguration result);
```

Launch configuration, the current Guardian and Reporter, and the difficulty rule's constants.

#### `paused`

```solidity
function paused() external view returns (bool);
```

Whether settlement is paused. Reads keep working while paused.

#### `hasEverBeenReporter`

```solidity
function hasEverBeenReporter(address candidate) external view returns (bool);
```

Whether `candidate` has ever held the Reporter role. A retired Reporter address can never be reused.

#### `eip712Domain`

```solidity
function eip712Domain() external view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions);
```

The EIP-712 domain for settlement signatures: name `SqueekCore`, version `1`, this chain and this proxy.

#### Identity

```solidity
function proxyAdmin() external view returns (address);
function implementationCodeAddress() external view returns (address);
function implementationStorageLayoutDigest() external pure returns (bytes32);
```

The ProxyAdmin from the proxy's admin slot, and the running implementation's address and storage-layout digest. [Verify the deployment](quickstart.md#verify-the-deployment) checks them.

### Settlement

#### `submitRounds`

```solidity
function submitRounds(Round[] rounds, uint64 settledThroughRound, uint256 expectedNonce, uint256 deadline, bytes signature) external;
```

Settles the listed active rounds and certifies every omitted round through `settledThroughRound` as zero work. Anyone may submit; only a valid Reporter signature authorizes it. On Sepolia a relayer submits and pays gas.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `rounds` | `Round[]` | — | 0–16 active rounds with strictly increasing IDs, each with nonzero work and a nonzero data hash, all after the current frontier |
| `settledThroughRound` | `uint64` | round | New frontier; must advance and must have ended by wall-clock time |
| `expectedNonce` | `uint256` | — | The current `authorizationNonce` |
| `deadline` | `uint256` | Unix seconds | Last time the signature is accepted |
| `signature` | `bytes` | — | The Reporter's EIP-712 signature over these fields, this proxy, chain and implementation |

Reverts with `EnforcedPause`, `BatchTooLarge`, `InvalidActiveRound`, `NonIncreasingRoundId`, `InvalidRoundId`, `WorkExceeded`, `SettledThroughRoundNotAdvanced`, `RoundNotElapsed`, `ExpiredAuthorization`, `AuthorizationNonceMismatch`, `InvalidReporterSignature` or a signature-format error. Over-cap work is rejected, never truncated.

### Admin

#### `pause`

```solidity
function pause() external;
```

Guardian only. Stops settlement and voids every outstanding signature by advancing the nonce. Reverts with `UnauthorizedGuardian` or `EnforcedPause`.

#### `unpause`

```solidity
function unpause() external;
```

Guardian only. Resumes settlement and voids signatures made while paused. Reverts with `UnauthorizedGuardian` or `ExpectedPause`.

#### `setReporter`

```solidity
function setReporter(address newReporter) external;
```

Guardian only, while paused: replaces the Reporter with an address that has never held the role. Reverts with `UnauthorizedGuardian`, `ExpectedPause`, `InvalidReporter` or `ReporterAlreadyUsed`.

#### `initialize`

```solidity
function initialize(SqueekLaunchConfig config) external;
```

Sets the launch configuration and starts the ledger paused at zero, during proxy construction only. Reverts with `InvalidInitialization`, `NotInitializing`, `InvalidProxyAdmin`, `InvalidImplementationCodeAddress`, `InvalidStreamId`, `InvalidGuardian`, `InvalidReporter`, `InvalidGenesisTimestamp`, `InvalidWorkCap` or `InvalidWorkPerThousandBlocks`.

## Events

```solidity
event CoreInitialized(bytes32 indexed streamId, address indexed guardian, address indexed reporter, uint64 genesisTimestamp, uint32 initialWorkPerThousandBlocks, uint64 maxWorkPerRound);
event RoundRecorded(uint64 indexed roundId, uint64 work, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash);
event BatchSettled(bytes32 indexed digest, address indexed reporter, uint64 indexed settledThroughRound, uint256 nonce, uint64 previousSettledThroughRound, uint16 activeRoundCount, uint64 cumulativeWork, uint96 cumulativeBlockUnits);
event ReporterUpdated(address indexed previousReporter, address indexed newReporter);
event Paused(address account);
event Unpaused(address account);
event Initialized(uint64 version);
event EIP712DomainChanged();
```

| Event | Emitted when |
|---|---|
| `CoreInitialized`, `ReporterUpdated`, `Initialized` | Launch; `ReporterUpdated` also on every Reporter change, with `previousReporter` zero at launch |
| `RoundRecorded` | Once per active round in a settlement, in round order; positions are after the round, and `workPerThousandBlocks` is the difficulty after its steering |
| `BatchSettled` | Once per settlement, after its `RoundRecorded` events, including settlements with no active rounds; `nonce` is the one consumed |
| `Paused`, `Unpaused` | The Guardian pauses or resumes settlement |
| `EIP712DomainChanged` | Declared by the inherited EIP-712 interface; not emitted by a SqueekCore action |

There is no per-block event: derive completed blocks from `cumulativeBlockUnits`.

## Errors

| Error | Cause | Fix |
|---|---|---|
| `InvalidRoundPageBounds` | Reversed range, end past the frontier, or more than 16 records | Read at most `settledThroughRound` with 0–16 records |
| `BlockNotSettled` | Block 0 or a block not yet completed | Query `1..blockHeight` |
| `EnforcedPause`, `ExpectedPause` | Settling while paused, or an unpause or Reporter change while not paused | Check `paused()` |
| `UnauthorizedGuardian` | A Guardian action from another address | Guardian only |
| `BatchTooLarge` | More than 16 active rounds | Split the span |
| `InvalidActiveRound` | A listed round has zero work or a zero data hash | Omit zero-work rounds; they are certified implicitly |
| `NonIncreasingRoundId`, `InvalidRoundId` | Round IDs out of order, already settled, or past the new frontier | Rebuild the batch from the current frontier |
| `WorkExceeded` | A round's work is above `maxWorkPerRound` | The round cannot settle; the measurement pipeline must reject it |
| `SettledThroughRoundNotAdvanced`, `RoundNotElapsed` | The frontier does not advance, or targets a round that has not ended | Wait for the round to end |
| `ExpiredAuthorization` | `deadline` has passed | Sign again |
| `AuthorizationNonceMismatch` | The signature used a stale nonce, for example after a pause | Re-read `authorizationNonce` and sign again |
| `InvalidReporterSignature`, `ECDSAInvalidSignature`, `ECDSAInvalidSignatureLength(length)`, `ECDSAInvalidSignatureS(s)` | Not the current Reporter's valid signature over these exact fields | Sign with the current Reporter key |
| `InvalidReporter`, `ReporterAlreadyUsed` | Reporter is zero, a privileged address, or previously used | Choose a fresh address |
| `InvalidStreamId`, `InvalidGuardian`, `InvalidGenesisTimestamp`, `InvalidWorkCap`, `InvalidWorkPerThousandBlocks` | Invalid launch configuration | Setup only |
| `InvalidInitialization`, `NotInitializing`, `InvalidProxyAdmin`, `InvalidImplementationCodeAddress` | Initialization outside proxy construction | Setup only |
| `SafeCastOverflowedUintDowncast(bits, value)` | Inherited overflow guard | The call rolled back; investigate |

## Integrator patterns

- **Count blocks from block units.** `blockHeight = cumulativeBlockUnits / 10^9`. Over an interval, subtract endpoint heights: `floor(end / 10^9) − floor(start / 10^9)`. Never divide physical work by difficulty.
- **Respect the certified frontier.** Treat rounds after `settledThroughRound` as unknown. Act only on certified rounds, not on `block.timestamp` alone.
- **Page by the returned frontier.** Advance your cursor to `certifiedThroughRound`; a page may end before the round you requested.
- **Price with the previous difficulty.** A `RoundRecorded` difficulty is the one after its steering; the round itself was priced at the preceding position's difficulty.
- **Derive the current round yourself.** SqueekCore has no `currentRound()`: at Ethereum timestamp `t ≥ genesisTimestamp`, the round is `floor((t − genesisTimestamp) / 600) + 1`.
- **Handle several blocks per settlement.** One settlement can complete several Squeek blocks, with no callback or event for each block.
- **Consume from a contract.** Contracts can read `state()`, `roundPage` and `blockInfo` without a role, but must keep their own cursor, eligibility rules and replay protection.

## Price first, then steer

Difficulty `D = workPerThousandBlocks` is the work 1,000 Squeek blocks cost. For each active round with `w` work, in round order:

```text
U_next = U + floor(w * 10^12 / D)
W_next = W + w
D_next = D                                            if w < 40
D_next = floor((29 * D + floor(w * 1000 / 40)) / 30)  otherwise
```

`W` is cumulative physical work and `U` cumulative block units. A round with 1–39 work earns progress without steering; a round with at least 40 moves difficulty toward the price at which it would have earned 40 blocks (a steering target, not a guaranteed count). Zero-work gaps change nothing. Port the integer expressions exactly: floating-point or reordered arithmetic rounds differently.

## Usage example

The [Quickstart](quickstart.md#read-squeekcore-state) reads `configuration()`, `state()` and a point endpoint and cross-checks them. This example counts the Squeek blocks completed in a span of certified rounds.

```ts
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
```

## ABI

[`SqueekCore.json`](https://docs.squeekchain.com/assets/abi/SqueekCore.json) matches the Sepolia deployment. Call the proxy listed under [Deployments](overview.md#deployments), not the implementation.

## Related pages

- [Quickstart](quickstart.md)
- [Index events](index-events.md)
- [SqueekMining](mining.md)
- [Rounds and Squeek blocks](https://docs.squeekchain.com/system/rounds-and-blocks.md)
- [How work reaches Ethereum](https://docs.squeekchain.com/system/settlement.md)
