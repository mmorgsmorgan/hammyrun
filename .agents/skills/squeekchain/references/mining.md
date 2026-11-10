> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# SqueekMining

> SqueekMining function by function: the issuance schedule, checkpoints that fund SqueekStaking, start, bindings, pause, events, errors and ABI.

Web version: https://docs.squeekchain.com/developers/mining/

## TL;DR

- SqueekMining issues $SQK for each Squeek block completed from `startRound` onward, on a schedule of a launch bonus plus three halving periods, until the 2.1 billion lifetime cap less the premint.
- Anyone can call `checkpoint()`; it mints once and transfers every newly issued $SQK to `SqueekStaking`, then calls `fund`.
- It holds no accounts, positions or claims: owners earn and claim in [SqueekStaking](staking.md).
- Blocks completed before the start round never issue, and issuance needs a bound Staking contract and a `start()` call from the [admin](admin.md).

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

SqueekMining issues $SQK for completed Squeek blocks from `startRound` onward. Each checkpoint mints the scheduled amount through `SqueekToken`, transfers it to the permanently bound `SqueekStaking` and calls `fund`. It keeps no account or Squeek balances and retains none of the $SQK it issues; $SQK sent to it directly stays there.

It runs behind a guarded transparent proxy whose ProxyAdmin the [admin Timelock](admin.md) owns, with its own storage namespace. The Sepolia proxy address and identities are under [Deployments](overview.md#deployments).

## Functions

### Types

```solidity
struct MiningBindings {
    address core;                       // SqueekCore proxy
    address token;                      // SqueekToken
    address staking;                    // SqueekStaking proxy; zero until bindStaking
    address governance;                 // the admin Timelock
    bytes32 streamId;                   // SqueekCore stream
    uint64 genesisTimestamp;            // SqueekCore round 1 start, Unix seconds
    uint64 minimumTimelockDelay;        // seconds the timelock must keep at least
    uint64 maxWorkPerRound;             // SqueekCore work cap, work units
    uint32 initialWorkPerThousandBlocks;
    uint128 premint;                    // SqueekToken totalPreminted, set at bootstrap; 0 before
}

struct MiningState {
    uint256 minted;                     // SQK base units SqueekMining ever issued
    uint64 processedThroughRound;       // last SqueekCore round processed
    uint64 startRound;                  // first earning round; 0 until start()
    uint64 startHeight;                 // h0: completed Squeek block height before startRound
    uint64 fundedBlocks;                // completed blocks after h0 already funded
    address guardian;                   // may pause issuance
    bool bootstrapped;                  // SqueekToken binding completed
    bool startCaptured;                 // h0 has been read from SqueekCore
    bool paused;                        // emergency pause
    bool active;                        // startRound != 0 and the current round has reached it
}

struct MiningIssuanceSchedule {
    uint256 allowance;                  // A = SUPPLY_CAP − premint; 0 before bootstrap
    uint256 launchBonus;                // G, SQK base units
    uint64 bonusBlocks;                 // N, completed blocks over which G is spread
    uint64 halvingBlocks;               // H, completed blocks per halving period
    uint256 firstPeriodRate;            // R0, base units per block; 0 before bootstrap
    uint64 startHeight;                 // h0
}

struct MiningLaunchConfig {
    address core;
    address token;
    bytes32 streamId;
    address governance;
    uint64 minimumTimelockDelay;
    address guardian;
    uint128 launchBonus;
    uint64 bonusBlocks;
    uint64 halvingBlocks;
}
```

All fields here decode to `bigint` in viem except `uint32` (`number`), `bool`, `address` and `bytes32` (`Hex`). Amounts are $SQK base units (`10^-18` $SQK). Block counts are Squeek blocks from `SqueekCore`, never Ethereum blocks. `launchBonus`, `bonusBlocks` and `halvingBlocks` are deployment parameters: read them from `issuanceSchedule()`.

### Permissionless

#### `checkpoint`

```solidity
function checkpoint() external;
```

Funds up to 32 earning rounds of completed Squeek blocks that SqueekCore has certified and Mining hasn't yet processed. Anyone may call it and pays the gas; it takes no input and pays no caller reward.

1. The first call that sees round `startRound − 1` certified reads SqueekCore's position at that round and records its completed height as `startHeight` (h0). Blocks up to h0 are never issued.
2. It processes *earning rounds* (rounds that completed at least one new block), oldest first, at most `MAX_CHECKPOINT_ROUNDS` (32) per call; rounds without a new block don't count toward the limit. For each, it reads `blockInfo` from `SqueekCore` to find the blocks `fromBlock..toBlock` the round completed, prices them with the [issuance schedule](mining.md#issuance-schedule), clips the amount to the remaining cap and emits `StakingFunded`.
3. If every completed block is funded, the cursor jumps to SqueekCore's certified frontier; otherwise it stops after the last earning round processed and the next call resumes there.
4. If the total is nonzero, it calls `SqueekToken.mintForCheckpoint` once, checks exactly that amount arrived, transfers it to `SqueekStaking`, calls `fund(amount)` there, and checks its own $SQK balance is back where it started. Any failure reverts the whole checkpoint, cursor included.
5. It emits `Checkpointed` with the new cursor, funded block count and amount, even when the amount is zero.

It returns without changes or events when nothing new is certified, or before SqueekCore has certified round `startRound − 1`.

Reverts with `BootstrapIncomplete`, `EmergencyPaused`, `StartNotScheduled`, `CorePaused`, `CoreRegression`, `CoreFutureRound`, `CoreInconsistent`, `CoreUnavailable`, `BindingCallFailed`, `TokenSupplyMismatch`, `MintMismatch`, `FundingMismatch`, `SafeERC20FailedOperation(token)`, `SafeCastOverflowedUintDowncast(bits, value)` or `ReentrantCall`.

### Views

#### `state`

```solidity
function state() external view returns (MiningState);
```

Cumulative issuance, funding cursors, start round and captured start height, Guardian and lifecycle flags (see [Types](mining.md#types)). `minted` excludes the premint.

#### `bindings`

```solidity
function bindings() external view returns (MiningBindings);
```

The permanent graph: `SqueekCore`, `SqueekToken`, `SqueekStaking` (zero until bound), the admin Timelock (`governance`), the SqueekCore clock and limits pinned at initialization, and the premint read at bootstrap.

#### `issuanceSchedule`

```solidity
function issuanceSchedule() external view returns (MiningIssuanceSchedule schedule);
```

Fixed schedule parameters and the captured start height. `allowance` and `firstPeriodRate` read zero until bootstrap fixes the premint.

#### `issued`

```solidity
function issued(uint64 blocksSinceStart) external view returns (uint256);
```

Cumulative scheduled issuance, in $SQK base units, after `blocksSinceStart` completed Squeek blocks past h0: `issued(b)` in the [issuance schedule](mining.md#issuance-schedule). Actual funding is also clipped by the remaining cap, which the schedule never exceeds. Reverts with `BootstrapIncomplete` before bootstrap.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `blocksSinceStart` | `uint64` | Squeek blocks | Completed blocks after the start height h0 |

#### `checkpointStatus`

```solidity
function checkpointStatus() external view returns (bool corePaused, uint64 nextRound, bool roundSettled);
```

Whether `SqueekCore` is paused, the next round to process (`startRound` until h0 is captured, then `processedThroughRound + 1`; `0` before `start()`), and whether SqueekCore has certified it. `roundSettled` true means a checkpoint can advance, not that it will issue $SQK; a checkpoint also needs `start()` called and `state().paused` false. Reverts with `BootstrapIncomplete`, `CoreUnavailable` or `CoreInconsistent`.

#### Constants

```solidity
function SUPPLY_CAP() external view returns (uint256);            // 2,100,000,000 × 10^18, premint included
function MAX_CHECKPOINT_ROUNDS() external view returns (uint256); // 32 earning rounds per checkpoint
```

#### Identity

```solidity
function core() external view returns (address);
function proxyAdmin() external view returns (address admin);
function implementationCodeAddress() external view returns (address);
function implementationStorageLayoutDigest() external pure returns (bytes32);
```

The bound `SqueekCore` proxy; this proxy's ProxyAdmin, verified against the proxy runtime (otherwise reverts with `InvalidProxyRuntime` or `InvalidProxyAdmin`); and the running implementation's address and storage-layout digest.

### Admin and Guardian

#### `bindStaking`

```solidity
function bindStaking(address staking_) external;
```

Admin Timelock only, once, after bootstrap: permanently binds the `SqueekStaking` proxy that receives all issuance. The candidate must be a guarded issuance proxy with implementation code, a ProxyAdmin owned by the admin Timelock, and `mining()`, `token()`, `core()` and `governance()` matching this contract's bindings. There's no rebinding.

Reverts with `BootstrapIncomplete`, `Unauthorized`, `StakingAlreadyBound`, `InvalidStaking`, `InvalidStakingImplementation`, `InvalidStakingAdmin`, `InvalidProxyRuntime`, `InvalidProxyAdmin`, `BindingCallFailed` or `ReentrantCall`.

#### `start`

```solidity
function start() external returns (uint64 startRound);
```

Admin Timelock only, once, with `SqueekStaking` bound. Schedules issuance from the next full SqueekCore round: `startRound = currentRound + 1`, where `currentRound = floor((t − genesisTimestamp) / 600) + 1` at Ethereum timestamp `t` (0 before genesis). Blocks completed before `startRound` never issue.

| Returns | Type | Unit |
|---|---|---|
| `startRound` | `uint64` | SqueekCore round |

Reverts with `BootstrapIncomplete`, `Unauthorized`, `EmergencyPaused`, `StartAlreadyScheduled`, `StakingNotBound`, `SafeCastOverflowedUintDowncast(bits, value)` or `ReentrantCall`.

#### `pause`

```solidity
function pause() external;
```

Guardian only. Stops `checkpoint`; rewards already funded to `SqueekStaking` stay claimable. Reverts with `BootstrapIncomplete`, `Unauthorized`, `EmergencyPaused` or `ReentrantCall`.

#### `unpause`

```solidity
function unpause() external;
```

Admin Timelock only. Resumes checkpoints; the next one funds blocks certified while paused. Reverts with `BootstrapIncomplete`, `Unauthorized`, `NotPaused` or `ReentrantCall`.

#### `setGuardian`

```solidity
function setGuardian(address guardian) external;
```

Admin Timelock only. Replaces the Guardian, which must be a contract. Reverts with `BootstrapIncomplete`, `Unauthorized`, `InvalidGuardian` or `ReentrantCall`.

### Setup

#### `initialize`

```solidity
function initialize(MiningLaunchConfig config) external;
```

Proxy construction only. Checks that `SqueekCore` has code, the expected clock and difficulty constants (600-second rounds, 16-round batches, 40-block target, 30-round smoothing, `10^9` block units) and a consistent certified head; that the admin is a self-administered timelock with at least `minimumTimelockDelay`; that the Guardian is a contract; that `halvingBlocks` is nonzero and `bonusBlocks` is nonzero exactly when `launchBonus` is; and that `SqueekToken` exists unbound, with `miningBindingAuthority` equal to the admin Timelock, a cap of `SUPPLY_CAP`, no issuance beyond its premint, and `launchBonus` below the remaining allowance.

Reverts with `InvalidInitialization`, `NotInitializing`, `InvalidProxyContext`, `InvalidConfiguration`, `InvalidGuardian`, `InvalidToken`, `BindingCallFailed`, `CoreIdentityMismatch`, `CoreInconsistent`, `CoreFutureRound` or `CoreUnavailable`.

#### `completeBootstrap`

```solidity
function completeBootstrap() external;
```

Callable only by the configured `SqueekToken`, inside its one-time [`bindMining`](token.md#bindmining). Re-reads the token (now naming this proxy as `mining()`), fixes `bindings().premint`, and re-checks the launch bonus against the allowance, the admin Timelock's ownership of this proxy's ProxyAdmin, the timelock, and SqueekCore's identity. A revert rolls back the whole binding.

Reverts with `BootstrapAlreadyComplete`, `Unauthorized`, `InvalidProxyContext`, `InvalidToken`, `InvalidConfiguration`, `InvalidGraphAdmin`, `InvalidProxyRuntime`, `InvalidProxyAdmin`, `BindingCallFailed`, `CoreIdentityMismatch`, `CoreInconsistent`, `CoreFutureRound`, `CoreUnavailable` or `ReentrantCall`.

## Events

```solidity
event MiningInitialized(address indexed core, bytes32 indexed streamId, address governance);
event MiningBootstrapped(address indexed token);
event StakingBound(address indexed staking);
event MiningStarted(uint64 startRound);
event StakingFunded(uint64 indexed fromBlock, uint64 indexed toBlock, uint256 amount);
event Checkpointed(uint64 indexed throughRound, uint64 fundedBlocks, uint256 amount);
event MiningPaused(address caller);
event MiningUnpaused(address caller);
event MiningGuardianChanged(address previousGuardian, address newGuardian);
event Initialized(uint64 version);
```

| Event | Emitted when |
|---|---|
| `MiningInitialized`, `Initialized` | The proxy is constructed |
| `MiningBootstrapped` | SqueekToken's `bindMining` completes bootstrap |
| `StakingBound` | The admin binds SqueekStaking |
| `MiningStarted` | The admin calls `start()`; carries the first earning round |
| `StakingFunded` | Once per earning round in a checkpoint: the inclusive absolute Squeek block range `fromBlock..toBlock` it completed and that range's entire issuance, possibly `0` at the cap or after the schedule ends |
| `Checkpointed` | Once per checkpoint that processes rounds, after its `StakingFunded` events: the new `processedThroughRound`, cumulative `fundedBlocks` after h0, and this call's total `amount` (possibly `0`) |
| `MiningPaused`, `MiningUnpaused` | The Guardian pauses or the admin resumes issuance |
| `MiningGuardianChanged` | The admin replaces the Guardian |

Within a checkpoint transaction the order is: `StakingFunded` events, SqueekToken's mint `Transfer` and `CheckpointMinted`, the `Transfer` to SqueekStaking, SqueekStaking's funding event, then `Checkpointed`.

## Errors

| Error | Cause | Fix |
|---|---|---|
| `Unauthorized` | Caller is not the admin Timelock, the Guardian or SqueekToken as required | Submit through the right authority |
| `BootstrapIncomplete`, `BootstrapAlreadyComplete` | SqueekToken has not bound this proxy yet, or already did | Wait for, or stop repeating, `bindMining` |
| `StartNotScheduled`, `StartAlreadyScheduled` | `checkpoint` before `start()`, or a second `start()` | Read `state().startRound` |
| `StakingNotBound`, `StakingAlreadyBound` | `start()` before `bindStaking`, or a second binding | Bind SqueekStaking once, before start |
| `InvalidStaking`, `InvalidStakingImplementation`, `InvalidStakingAdmin` | The candidate is not a guarded proxy for this graph, has no implementation code, or its ProxyAdmin is not owned by the admin Timelock | Deploy SqueekStaking against this Mining, SqueekToken, SqueekCore and admin Timelock |
| `EmergencyPaused`, `NotPaused` | Checkpoint, start or pause while paused, or unpause while not paused | Check `state().paused` |
| `InvalidGuardian` | Guardian is not a contract | Use a contract Guardian |
| `CorePaused` | SqueekCore is paused | Retry after SqueekCore resumes; SqueekStaking claims still work |
| `CoreUnavailable`, `CoreInconsistent`, `CoreRegression`, `CoreFutureRound` | A SqueekCore read failed, was malformed, went backwards or certified a round that has not ended | Stop and investigate; never substitute zero progress |
| `CoreIdentityMismatch` | SqueekCore's configuration differs from what was pinned or required | Deployment problem; not caused by callers |
| `TokenSupplyMismatch` | `SqueekToken.totalMinted()` ≠ `premint + minted` | The call rolled back; investigate |
| `MintMismatch`, `FundingMismatch` | The mint, the transfer to SqueekStaking or its `fund` call did not move exactly the amount | The call rolled back; investigate SqueekStaking and SqueekToken |
| `InvalidToken`, `InvalidGraphAdmin`, `BindingCallFailed` | SqueekToken or this proxy's admin is miswired, or a dependency read failed during setup or a checkpoint | Setup: fix the wiring; checkpoint: the call rolled back, investigate the failing dependency |
| `InvalidConfiguration`, `InvalidProxyContext`, `InvalidProxyRuntime`, `InvalidProxyAdmin` | Invalid launch values, a call outside the proxy, or an unrecognized proxy or ProxyAdmin runtime | Setup only |
| `InvalidInitialization`, `NotInitializing` | Initialization outside proxy construction | Setup only |
| `ReentrantCall` | Re-entry during a call | Do not call back into SqueekMining |
| `SafeCastOverflowedUintDowncast(bits, value)`, `SafeERC20FailedOperation(token)` | Inherited overflow guard or token-transfer failure | The call rolled back; investigate |

## Integrator patterns

- **Claim from SqueekStaking.** SqueekMining has no `claim`, `claimable` or position view; account rewards live in [SqueekStaking](staking.md).
- **Check before checkpointing.** Call `checkpointStatus()` and `state()`; submit `checkpoint()` only when `nextRound` is nonzero (started), `state().paused` is false, `corePaused` is false and `roundSettled` is true, and repeat while it stays true, since one call funds at most 32 earning rounds.
- **Measure checkpoint lag.** $SQK is issued only when `checkpoint` processes certified work; compare Mining's `state().processedThroughRound` with SqueekCore's `state().settledThroughRound`.
- **Count issuance once.** Use `StakingFunded.amount` per round or `Checkpointed.amount` per call, not both, and not together with SqueekToken's `CheckpointMinted`.
- **Treat zero as valid.** A checkpoint can fund `0` (no new block, the cap reached or the schedule ended) and still advance the cursor.
- **Don't backdate.** Blocks at or below `state().startHeight` never issue; `issued(b)` counts blocks after h0 only.
- **Reconcile supply.** `SqueekToken.totalMinted() == bindings().premint + state().minted` always holds after a checkpoint.
- **Don't donate.** $SQK sent directly to SqueekMining stays there; it funds nothing and restores no cap.

## Issuance schedule

Each checkpoint prices completed Squeek blocks counted after the start height h0. With `A = SUPPLY_CAP − premint` (`allowance`), `G = launchBonus`, `N = bonusBlocks` and `H = halvingBlocks`:

```text
R0 = 4 * floor((A - G) / (7 * H))                   // firstPeriodRate, base units per block

issued(b) = R0     * min(b, H)
          + R0 / 2 * min(max(b - H, 0), H)
          + R0 / 4 * min(max(b - 2H, 0), H)
          + (G == 0 ? 0 : floor(G * min(b, N) / N))   // launch bonus, linear over N blocks

amount(round) = min(issued(toBlock - h0) - issued(fundedBlocks), A - minted)
```

The first `H` blocks issue `R0` each, the next `H` blocks `R0 / 2`, the next `H` blocks `R0 / 4`, and later blocks nothing; `R0` is a multiple of 4, so the halved rates are exact. The launch bonus adds `G` linearly over the first `N` blocks. `issued(b)` never decreases and never exceeds `A`, because the base series totals `7 · R0 · H / 4 ≤ A − G`; flooring leaves a small part of the allowance unissued. Pricing cumulative issuance at each round's end height makes the result independent of how rounds group into checkpoints.

`H`, `G` and `N` are deployment parameters: read them from `issuanceSchedule()`. The premint, and so `A`, is fixed by SqueekToken's constructor. Funded $SQK reaches accounts through the [SqueekStaking reward stream](staking.md#reward-stream).

## Usage example

Reads the issuance schedule and checkpoint progress and checks issuance so far against the schedule. Uses `setup.ts` and `verifyGraph()` from the [Quickstart](quickstart.md#verify-the-deployment), which verifies the SqueekMining proxy at `MINING_ADDRESS`.

```ts
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
```

## ABI

[`SqueekMining.json`](https://docs.squeekchain.com/assets/abi/SqueekMining.json) matches the Sepolia deployment. Call the proxy listed under [Deployments](overview.md#deployments), not the implementation.

## Related pages

- [SqueekStaking](staking.md)
- [SqueekToken](token.md)
- [SqueekCore](core.md)
- [Index events](index-events.md)
- [How $SQK is issued](https://docs.squeekchain.com/rewards/creation.md)
