> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# SqueekStaking

> SqueekStaking function by function: Squeek and $SQK custody, account power, the 1,200 s reward stream, exit fees, events, errors and ABI.

Web version: https://docs.squeekchain.com/developers/staking/

## TL;DR

- SqueekStaking holds deposited Squeeks and staked $SQK, updates account power in the same transaction as a deposit or stake, and streams $SQK funded by SqueekMining over 1,200 seconds.
- Account power is deposited Squeek power `P` plus boosted $SQK power `Q`; every change settles rewards at the old power first.
- Rewards accrue to the address that staked, not to a Squeek: claim them with `claim(account)` or compound them with `claimAndStake()`.
- Unstaking burns a bounded exit fee; withdrawals, unstaking and claims stay available while intake is paused.

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

The contract holds deposited Squeeks and staked $SQK principal and streams rewards. All $SQK issuance reaches it through `fund`, the only call `SqueekMining` makes into it. It reads `SqueekCore` for the ten-minute round clock and Guardian, and the Genesis collection (`SqueekNFT`) for levels and ownership.

Power is in WAD (`10^18` per whole unit). A deposited Squeek adds its level's base power; staked $SQK adds `Q`, which grows with the account's Squeek power. Power takes effect in the same transaction, and rewards earned under the previous power stay with the account.

The Sepolia proxy address and identities are under [Deployments](overview.md#deployments).

## Functions

### Types

```solidity
struct StakingInitialization {
    address mining;              // sole reward funder
    address token;               // SQK
    address core;                // native clock and guardian source
    address governance;          // the admin Timelock
    address genesis;             // the Genesis collection (SqueekNFT)
    uint64[] genesisBasePower;   // whole power units for levels 1..MAXIMUM_LEVEL
    uint256 sqkPerPower;         // c: SQK base units per whole power unit; 0 < c < 2^96
    uint256 referencePower;      // P_ref: WAD NFT power that doubles the SQK rate; 0 < P_ref < 2^128
    StakingExitPolicy exitPolicy;
}

struct StakingExitPolicy {
    uint16 minBps;          // marginal fee with no recent exits; <= maxBps
    uint16 maxBps;          // marginal fee at and beyond saturation; < 10_000
    uint16 saturationBps;   // share of the pressure denominator that reaches maxBps; 1..10_000
    uint8 windowDays;       // UTC days counted as recent, today included; 1..30
    uint128 pressureFloor;  // smallest pressure denominator, SQK base units; > 0
}

struct StakingRewardState {
    uint256 funded;          // lifetime SQK funded by Mining
    uint256 paid;            // lifetime SQK claimed out
    uint256 compounded;      // lifetime SQK restaked by claimAndStake
    uint256 rewardIndex;     // Q128 reward per WAD of power
    uint256 remaining;       // funded SQK not yet released
    uint128 totalNftPower;   // sum of P, WAD
    uint128 totalSqkPower;   // sum of Q, WAD
    uint256 streamRate;      // informational: stream amount / 1,200, per second
    uint64 lastAccruedAt;    // the read timestamp (views project to now)
    uint64 streamEndsAt;     // projected end if power stays nonzero; 0 when exhausted
}
```

`uint8` and `uint16` fields decode to `number` in viem; every other numeric field decodes to `bigint`. The policy values, base-power table, `c` and `P_ref` are deployment parameters fixed at initialization; read them with `exitPolicy()`, `basePower` and `powerParameters()`.

### Squeek custody

#### `deposit`

```solidity
function deposit(address collection, uint256[] calldata tokenIds) external;
```

Pulls 1–100 of the caller's own Squeeks into custody and raises `P` by each token's base power at its current level. Tokens are pulled from `msg.sender`, so an operator can't deposit someone else's; approve Staking on the collection first.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `collection` | `address` | — | The Genesis collection (`genesis()`) |
| `tokenIds` | `uint256[]` | — | 1–100 token IDs owned by the caller |

Reverts with `InvalidDeposit` (empty or over 100, unbound collection, or the caller is the collection's sale custodian), `InvalidCollection`, `EmergencyPaused`, `InvalidLevel`, `CustodyMismatch`, `InvalidBounds` or `ReentrantCall`.

#### `onERC721Received`

```solidity
function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
```

A `safeTransferFrom` to Staking from a bound collection with empty `data` deposits the token for `from`, the previous owner. Mints (`from` zero), non-empty `data`, and transfers from the sale custodian (the collection's launch, which holds IDs 1–8,888 until it transfers them) are rejected with `InvalidDeposit`; a Squeek deposits from its owner's wallet. Also reverts with `InvalidCollection`, `EmergencyPaused`, `CustodyMismatch`, `InvalidLevel`, `InvalidBounds` or `ReentrantCall`.

#### `withdraw`

```solidity
function withdraw(address collection, uint256[] calldata tokenIds) external;
```

Returns 1–100 of the caller's deposited Squeeks and lowers `P` (and with it `Q`); earned rewards and staked $SQK are untouched. Works while intake is paused. Reverts with `InvalidWithdrawal` (empty or over 100), `Unauthorized` (the caller is not the token's depositor), `InvalidLevel`, `InvalidBounds` or `ReentrantCall`.

#### `mergeDeposited`

```solidity
function mergeDeposited(address collection, uint256 survivor, uint256 donor) external;
```

Merges two of the caller's deposited Squeeks under the collection's merge rules (same level, cooldown, merge gate). The donor is burned; the survivor stays deposited one level higher and `P` rises by `basePower(L + 1) − 2 × basePower(L)`, always positive. Levels are checked before and after, so a misreporting collection can't misstate power. Reverts with `Unauthorized`, `EmergencyPaused`, `InvalidLevel`, `InvalidBounds`, `ReentrantCall` or the collection's merge error.

#### `recover`

```solidity
function recover(address collection, uint256 tokenId, address to) external;
```

The [admin](admin.md) only. Moves out a token Staking holds that has no registered depositor (for example one sent with plain `transferFrom`). Works while paused. Reverts with `Unauthorized`, `RegisteredToken` or `ReentrantCall`.

### $SQK staking

#### `stake`

```solidity
function stake(uint256 amount) external;
```

Pulls `amount` $SQK from the caller (approve Staking on $SQK first) and requires the balance to rise by exactly that. Power updates in the same transaction; the amount is fresh principal and can be unstaked from the next round (see [Freshness](staking.md#freshness-and-maturity)). Reverts with `InvalidStake` (zero, or a balance change other than `amount`), `EmergencyPaused`, `InvalidBounds`, `SafeERC20FailedOperation`, `CustodyShortfall` or `ReentrantCall`.

#### `claimAndStake`

```solidity
function claimAndStake() external returns (uint256 amount);
```

Settles the caller and restakes all whole claimable $SQK as fresh principal, without moving tokens. Returns the amount compounded, `0` if none. Reverts with `EmergencyPaused`, `ExclusiveClaimRecipient` (the caller has set a claim recipient), `InvalidBounds`, `CustodyShortfall` or `ReentrantCall`.

#### `unstake`

```solidity
function unstake(uint256 amount, uint256 maxFee, uint64 deadline) external returns (uint256 net);
```

Removes `amount` of the caller's mature principal, burns the exit fee from Staking's balance and pays `net = amount − fee` to the caller. Power falls in the same transaction. Works while intake or Mining is paused.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `amount` | `uint256` | $SQK base units | Gross principal to remove; at most mature principal |
| `maxFee` | `uint256` | $SQK base units | Largest fee accepted; quote with `quoteUnstake` |
| `deadline` | `uint64` | Unix seconds | Last timestamp the call is accepted |

Reverts with `DeadlineExpired`, `InvalidUnstake` (zero, or more than mature principal), `FeeLimitExceeded(fee, maxFee)`, `InvalidBounds`, `SafeERC20FailedOperation`, `SafeCastOverflowedUintDowncast`, `CustodyShortfall` or `ReentrantCall`.

### Rewards

#### `fund`

```solidity
function fund(uint256 amount) external;
```

SqueekMining only, after transferring `amount` $SQK. Checks the balance covers it, accrues the old stream, then restarts a 1,200-second stream over the unreleased remainder plus `amount`; $SQK sent any other way is never allocated. Reverts with `Unauthorized`, `InvalidFunding` (zero), `CustodyShortfall` or `ReentrantCall`.

#### `claim`

```solidity
function claim(address account) external returns (uint256 amount);
```

Pays all whole claimable $SQK of `account` to its claim recipient (by default the account), which must be the caller. Returns `0` if nothing is claimable; sub-unit dust carries over. Works while intake or Mining is paused. Reverts with `Unauthorized`, `SafeERC20FailedOperation`, `CustodyShortfall` or `ReentrantCall`.

#### `setClaimRecipient`

```solidity
function setClaimRecipient(address recipient) external;
```

Sets the caller's claim recipient. Only that address can call `claim(caller)`, and `claimAndStake` reverts for the caller until it clears the recipient. Zero or the caller's own address clears it. Reverts with `InvalidClaimRecipient` if `recipient` is Staking, or `ReentrantCall`.

### Intake pause

#### `pause`, `unpause`, `paused`

```solidity
function pause() external;
function unpause() external;
function paused() external view returns (bool);
```

The current Core guardian pauses intake; only the admin resumes it. A pause stops `deposit`, `onERC721Received`, `stake`, `claimAndStake` and `mergeDeposited`; everything else, including accrual, `fund`, `claim`, `withdraw` and `unstake`, keeps working. `pause` and `unpause` revert with `Unauthorized` or `ReentrantCall`.

### Views

#### `accountPower`

```solidity
function accountPower(address account) external view returns (uint256 nftPower, uint256 sqkPower);
```

The account's current `P` and `Q` in WAD. Its power is `P + Q`.

#### `stakeOf`

```solidity
function stakeOf(address account) external view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound);
```

Staked principal, the part still fresh, and the round in which it matures. `freshPrincipal` reads `0` once that round has started; mature principal is `principal − freshPrincipal`.

#### `totalStaked`, `totalFresh`

```solidity
function totalStaked() external view returns (uint256);
function totalFresh() external view returns (uint256 freshPrincipal, uint64 freshUntilRound);
```

All staked principal, and the fresh part of it with its maturity round. Principal is separate from unpaid rewards and donations.

#### `quotePower`, `powerParameters`

```solidity
function quotePower(uint256 principal, uint256 nftPower) external view returns (uint256);
function powerParameters() external view returns (uint256 sqkPerPower, uint256 referencePower);
```

`Q` for a principal and NFT power under the fixed formula, and its parameters `c` and `P_ref`. `quotePower` reverts with `InvalidBounds` when `P` or `Q` would reach `2^128`.

#### `quoteUnstake`

```solidity
function quoteUnstake(address account, uint256 amount) external view returns (uint256 fee, uint256 net);
```

The fee and net `unstake(amount, …)` would produce now for `account`. Reverts with `InvalidUnstake` for zero or more than mature principal. Exits by others in the same window raise the fee, so pass the quote as `maxFee` with a short `deadline`.

#### `exitPolicy`, `recentExits`

```solidity
function exitPolicy() external view returns (StakingExitPolicy memory);
function recentExits() external view returns (uint256);
```

The fixed exit-fee constants, and gross $SQK unstaked in the current UTC day and the `windowDays − 1` days before it.

#### `claimable`

```solidity
function claimable(address account) external view returns (uint256);
```

Whole $SQK the account can claim now, projected to the current timestamp.

#### `claimRecipient`, `rewardState`

```solidity
function claimRecipient(address account) external view returns (address);
function rewardState() external view returns (StakingRewardState memory);
```

The address allowed to claim the account's rewards (the account unless one is set), and the projected stream and lifetime totals.

#### `depositor`, `basePower`, `saleCustodian`, `launchReady`

```solidity
function depositor(address collection, uint256 tokenId) external view returns (address);
function basePower(address collection, uint8 level) external view returns (uint64);
function saleCustodian(address collection) external view returns (address);
function launchReady() external view returns (bool);
```

The account a token is deposited for (zero if none); whole power units per level (zero outside the table); the sale custodian, the collection's launch, whose transfers cannot deposit; and whether the Genesis collection has issued its full `MAX_SUPPLY` (lifetime issuance, so later merge burns do not undo it).

#### Bindings

```solidity
function mining() external view returns (address);
function token() external view returns (address);
function core() external view returns (address);
function governance() external view returns (address);
function genesis() external view returns (address);
```

The sole funder, $SQK, Core, the admin Timelock (`governance()`) and the Genesis collection.

#### Constants and identity

```solidity
function MAX_TOKENS() external view returns (uint256);
function POWER_UNIT() external view returns (uint256);
function implementationCodeAddress() external view returns (address);
function implementationStorageLayoutDigest() external pure returns (bytes32);
```

`MAX_TOKENS` is `100` tokens per deposit or withdrawal and `POWER_UNIT` is `10^18`. The identity getters return the running implementation's address and storage-layout digest; state lives in its own ERC-7201 storage namespace. The contract runs behind a guarded transparent proxy that rejects an initializer changing the implementation and exposes `deploymentIdentity()`; upgrades go through its ProxyAdmin, owned by the [admin Timelock](admin.md).

### Admin and setup

#### `initialize`

```solidity
function initialize(StakingInitialization calldata init) external;
```

Runs once, during proxy construction only. Checks that Mining, $SQK, Core and the admin Timelock are bound to each other, that Core's round is 600 seconds, that the Genesis collection is the reviewed runtime sharing Core and the admin Timelock, and that each base-power level is positive and more than double the one below. Reverts with `InvalidInitialization`, `NotInitializing`, `InvalidProxyContext`, `InvalidMining`, `InvalidBinding`, `InvalidGovernance`, `InvalidCollection`, `InvalidBasePower`, `BindingCallFailed`, `InvalidBounds`, `InvalidExitPolicy` or `SafeCastOverflowedUintDowncast`.

## Events

```solidity
event CollectionBound(address indexed collection, uint64[] basePower);
event IntakePaused(address indexed guardian);
event IntakeResumed();
event Deposited(address indexed account, address indexed collection, uint256 indexed tokenId, uint8 level, uint64 basePower, uint256 power);
event Withdrawn(address indexed account, address indexed collection, uint256 indexed tokenId, uint8 level, uint64 basePower, uint256 power);
event Recovered(address indexed collection, uint256 indexed tokenId, address indexed to);
event Staked(address indexed account, uint256 amount, uint256 principal, uint64 freshUntilRound);
event DepositedMerge(address indexed account, address indexed collection, uint256 indexed survivor, uint256 donor, uint8 level, uint256 powerDelta);
event Unstaked(address indexed account, uint256 amount, uint256 fee, uint256 net);
event ClaimedAndStaked(address indexed account, uint256 amount, uint256 principal, uint64 freshUntilRound);
event PowerChanged(address indexed account, uint256 nftPower, uint256 sqkPower);
event RewardFunded(uint256 amount, uint256 remaining, uint64 streamEndsAt);
event RewardClaimed(address indexed account, address indexed recipient, uint256 amount);
event ClaimRecipientSet(address indexed account, address indexed recipient);
event Initialized(uint64 version);
```

| Event | Emitted when |
|---|---|
| `CollectionBound` | Initialization binds the Genesis collection and its base-power table |
| `Initialized` | Initialization |
| `IntakePaused`, `IntakeResumed` | The guardian pauses or the admin resumes intake |
| `Deposited`, `Withdrawn` | Once per token; `power` is `basePower × 10^18` |
| `DepositedMerge` | A deposited merge; `level` is the survivor's new level |
| `Recovered` | The admin recovers an unregistered token |
| `Staked`, `ClaimedAndStaked` | Principal added; `principal` is the new total and `freshUntilRound` its maturity round |
| `Unstaked` | Principal removed; `fee` was burned and `net` paid |
| `PowerChanged` | After every custody, stake, merge or unstake, with the new `P` and `Q` |
| `RewardFunded` | Mining funds; `remaining` is the restarted stream amount |
| `RewardClaimed` | A claim pays `recipient` |
| `ClaimRecipientSet` | An account sets or clears (zero) its claim recipient |

## Errors

| Error | Cause | Fix |
|---|---|---|
| `Unauthorized` | Wrong caller: not the depositor, claim recipient, guardian, admin or Mining | Call from the authorized address |
| `ReentrantCall` | Re-entered a state-changing entry point | Make one call at a time |
| `EmergencyPaused` | Intake action while paused | Wait for the admin to resume; exits still work |
| `InvalidDeposit` | Empty or over-100 batch, unbound collection, mint, non-empty callback data, or sale custodian as depositor | Deposit 1–100 tokens from the owner's wallet |
| `InvalidWithdrawal` | Empty or over-100 batch | Withdraw 1–100 tokens |
| `InvalidLevel(collection, tokenId, level)` | A level outside the table, or a merge that did not raise the survivor exactly one level from a same-level donor | Check levels with the collection |
| `CustodyMismatch(collection, tokenId)` | The collection does not report Staking as owner after a transfer | Deposit through the bound collection |
| `RegisteredToken(collection, tokenId)` | Recovery of a deposited token | Only the depositor can withdraw it |
| `InvalidStake` | Zero stake, or $SQK moved a different amount | Stake a positive amount |
| `InvalidUnstake` | Zero, or more than mature principal | Read `stakeOf`; wait for fresh principal to mature |
| `DeadlineExpired` | `block.timestamp > deadline` | Resubmit with a later deadline |
| `FeeLimitExceeded(fee, maxFee)` | The fee rose above `maxFee` | Re-quote with `quoteUnstake` |
| `InvalidFunding` | `fund(0)` | Mining funds positive amounts |
| `CustodyShortfall(balance, required)` | $SQK balance below principal plus unpaid, uncompounded funding | The call rolled back; investigate |
| `InvalidBounds` | Principal, power or total power would reach `2^128`, or invalid `c`/`P_ref` | Use a smaller amount |
| `InvalidClaimRecipient` | Recipient set to Staking | Choose another address |
| `ExclusiveClaimRecipient` | `claimAndStake` with a claim recipient set | Clear the claim recipient, or claim through it |
| `InvalidProxyContext`, `InvalidMining`, `InvalidBinding`, `InvalidGovernance`, `InvalidCollection`, `InvalidBasePower`, `InvalidExitPolicy`, `BindingCallFailed` | Invalid bindings, tables or policy, or a collection that no longer reports its sale custodian | Setup only |
| `InvalidInitialization`, `NotInitializing` | Initialization outside proxy construction | Setup only |
| `CoreUnavailable`, `CoreInconsistent` | A SqueekCore read failed or returned a malformed answer | The call rolled back; investigate SqueekCore |
| `InvalidCollectionRuntime` | At initialization, the Genesis collection is not the reviewed SqueekNFT runtime | Setup only |
| `SafeERC20FailedOperation(token)` | $SQK transfer failed | Check balance and allowance |
| `SafeCastOverflowedUintDowncast(bits, value)` | Inherited overflow guard | The call rolled back; investigate |

## Integrator patterns

- **Approve, then deposit.** Call `setApprovalForAll(staking, true)` on SqueekNFT and `deposit(genesis(), ids)`, or `safeTransferFrom(owner, staking, id)` with empty data. Never send with plain `transferFrom`: the token is not credited and only the admin can `recover` it.
- **Deposit from the owner's wallet.** Tokens held by `saleCustodian(collection)`, the collection's launch, cannot deposit; they deposit once transferred to an owner's wallet.
- **Quote before unstaking.** Call `quoteUnstake(account, amount)`, pass `fee` as `maxFee` and a near `deadline`.
- **Unstake only mature principal.** Mature principal is `principal − freshPrincipal` from `stakeOf`; fresh principal matures when round `freshUntilRound` starts.
- **Read rewards from Staking.** `claimable(account)` is projected to the current timestamp; claim with `claim(account)` from `claimRecipient(account)`.
- **Track power from events.** `PowerChanged` carries the full new `P` and `Q`; total power is `rewardState().totalNftPower + totalSqkPower`.
- **Don't send $SQK directly.** Raw transfers are donations that never become rewards or principal.

## Account power

### $SQK power

With principal `S` ($SQK base units), Squeek power `P` (WAD), `c = sqkPerPower` and `P_ref = referencePower`:

```text
Q = floor(S * 10^18 * (P_ref + P) / (c * P_ref))
W = P + Q
```

At `P = 0`, `c` $SQK base units buy one whole power unit; at `P = P_ref` the rate doubles. `Q` is recomputed whenever `S` or `P` changes, so withdrawing Squeeks lowers it too. Each change settles the account under the old `W`, then applies the new `W` in the same transaction. `P`, `Q` and total power stay below `2^128`.

### Freshness and maturity

Rounds last ten minutes. For `t ≥ genesisTimestamp`, the current round is `floor((t − genesisTimestamp) / 600) + 1`. Staked or compounded $SQK earns from the same transaction but stays fresh until the next round, `freshUntilRound = floor((t − genesisTimestamp) / 600) + 2` (round `1` before genesis), and can be unstaked once that round starts. Fresh principal does not count in the exit-fee denominator.

## Reward stream

Each `fund` accrues the old stream, adds `amount` to the unreleased remainder `R`, and restarts a 1,200-second stream of `A = R`. After `e` seconds of stream time, `floor(A * e / 1200)` has been released. Stream time pauses while total power is zero, leaving the unreleased $SQK in `remaining`. Released $SQK raises a Q128 index by `released * 2^128 / W_total`; an account earns `W * Δindex / 2^128`, with global and per-account remainders kept so no checkpoint pattern changes the result. Earned $SQK stays with the account after it withdraws or unstakes.

## Exit fee

Let `x` be recent exits (`recentExits()`), `a` the unstaked amount and `M` all mature principal before the exit. With the policy constants:

```text
D = max(M + x, pressureFloor)
C = max(floor(D * saturationBps / 10000), 1)
rate(y) = minBps + (maxBps − minBps) * (y / C)^2   for y ≤ C
rate(y) = maxBps                                   for y > C
fee = ∫ from x to x + a of rate(y) / 10000 dy
```

The marginal rate starts at `minBps`, rises quadratically to `maxBps` once recent exits reach `saturationBps` of the denominator, then stays flat; the contract evaluates the integral with floored integer steps. Because `maxBps < 10000`, the fee never exceeds the amount (rounding can make it equal on a dust exit), and splitting an exit gives the same total. The window is whole UTC days: a day drops out at midnight. The fee is burned.

### Solvency

After every state change Staking requires:

```text
SQK balance ≥ totalStaked + funded − paid − compounded
```

Staked principal never backs reward liabilities, and `fund` checks the new amount is already held.

## Usage example

Reads an account's power, principal, rewards and an exit quote, using `setup.ts` and `verifyGraph()` from the [Quickstart](quickstart.md#verify-the-deployment) to verify the proxy at `STAKING_ADDRESS`.

```ts
// staking-position.ts
import { getAddress, parseAbi } from "viem";
import { blockNumber, client, required } from "./setup";
import { verifyGraph } from "./verify";

const { staking } = await verifyGraph();
const account = getAddress(required("ACCOUNT_ADDRESS"));
const abi = parseAbi([
  "function accountPower(address account) view returns (uint256 nftPower, uint256 sqkPower)",
  "function stakeOf(address account) view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound)",
  "function claimable(address account) view returns (uint256)",
  "function quoteUnstake(address account, uint256 amount) view returns (uint256 fee, uint256 net)",
]);
const read = { address: staking, abi, blockNumber } as const;
const [nftPower, sqkPower] = await client.readContract({ ...read, functionName: "accountPower", args: [account] });
const [principal, freshPrincipal, freshUntilRound] = await client.readContract({ ...read, functionName: "stakeOf", args: [account] });
const rewards = await client.readContract({ ...read, functionName: "claimable", args: [account] });
const mature = principal - freshPrincipal;
const quote = mature > 0n
  ? await client.readContract({ ...read, functionName: "quoteUnstake", args: [account, mature] })
  : undefined;
console.log({ power: nftPower + sqkPower, principal, mature, freshUntilRound, rewards, quote });
```

## ABI

[`SqueekStaking.json`](https://docs.squeekchain.com/assets/abi/SqueekStaking.json) matches the Sepolia deployment. Call it on the proxy address listed under [Deployments](overview.md#deployments), not the implementation.

## Related pages

- [SqueekMining](mining.md)
- [SqueekNFT](nft.md)
- [SqueekToken](token.md)
- [SqueekCore](core.md)
- [Index events](index-events.md)
- [Owner actions](owner-actions.md)
