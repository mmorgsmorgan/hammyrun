> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# Build owner actions

> Prepare SqueekStaking and SqueekNFT merge calls as unsigned bundles for an owner's wallet, and run checkpoints from any account.

Web version: https://docs.squeekchain.com/developers/owner-actions/

## TL;DR

- The staker signs deposits, withdrawals, stakes, unstakes, claims and merges. Your app or agent checks preconditions, simulates and hands the wallet an unsigned call.
- Rewards accrue to the staker, not to a Squeek, and `claim(account)` pays the claim recipient of `account`, which is `account` itself unless another address is set.
- A merge permanently burns the donor NFT, and `unstake` burns an exit fee; show both before the owner signs.
- Any account can run `SqueekMining.checkpoint()`; it has no owner check.

## Before you start

This guide is for wallets, marketplaces, dashboards and agents acting for an account: your code prepares, and the account's wallet signs, pays gas and submits.

The calls target the Sepolia deployment's `SqueekStaking`, `SqueekNFT` and `SqueekMining`. Verify their addresses with `verifyGraph()` from [Verify the deployment](quickstart.md#verify-the-deployment) before preparing anything.

| Input | Where it comes from |
|---|---|
| Contract addresses | [Deployments](overview.md#deployments), checked with `verifyGraph()` |
| Account address | The connected wallet; a contract wallet must itself be the owner or depositor |
| Token IDs, amounts | The owner's selection |
| Explicit authorization | The owner, after seeing the exact action, IDs, amounts and irreversible effects |

| Action | Contract and call | Who signs | Effect |
|---|---|---|---|
| Deposit Squeeks | `SqueekStaking.deposit(collection, tokenIds)` | NFT owner, after `setApprovalForAll` or `approve` for `SqueekStaking` | 1–100 NFTs move into custody; the account's Squeek power rises in the same transaction |
| Withdraw Squeeks | `SqueekStaking.withdraw(collection, tokenIds)` | The registered depositor | 1–100 NFTs return to the caller; power falls; earned rewards stay with the account |
| Stake $SQK | `SqueekStaking.stake(amount)` | $SQK holder, after `approve` for `SqueekStaking` | Principal and power rise in the same transaction; the new principal is fresh until the next 600-second round |
| Unstake $SQK | `SqueekStaking.unstake(amount, maxFee, deadline)` | Staker | Mature principal leaves; the exit fee is burned and the net is paid |
| Claim rewards | `SqueekStaking.claim(account)` | The address returned by `claimRecipient(account)` | All claimable $SQK base units go to that address; the scaled remainder stays with the account |
| Set claim recipient | `SqueekStaking.setClaimRecipient(recipient)` | The account | Only `recipient` may trigger and receive this account's claims; zero or self clears it |
| Claim and stake | `SqueekStaking.claimAndStake()` | The account | All claimable $SQK base units become fresh principal with no token transfer |
| Merge deposited Squeeks | `SqueekStaking.mergeDeposited(collection, survivor, donor)` | Depositor of both IDs | Donor burns; survivor stays deposited one level higher; power rises |
| Merge wallet Squeeks | `SqueekNFT.merge(survivor, donor)` | Wallet owner of both IDs | Donor burns; survivor gains one level |
| Checkpoint | `SqueekMining.checkpoint()` | Any account | Funds `SqueekStaking` for up to 32 earning rounds of completed Squeek blocks |

Only the Squeek's owner can call `deposit(...)` or merge it: `SqueekStaking` pulls each token from the caller, and `SqueekNFT.merge` checks that the caller owns both tokens. The one-token `safeTransferFrom` path is different: an approved NFT operator can send the owner's Squeek to `SqueekStaking`, and the previous owner is recorded as depositor.

## Steps

### Deposit and withdraw Squeeks

1. Read `ownerOf` for every ID. Stop and name any ID the account does not own.
2. Read `SqueekStaking.paused()`. Deposits wait while intake is paused; withdrawals do not.
3. Check that `SqueekStaking` is approved for the collection (`isApprovedForAll` or `getApproved`). If not, prepare the approval as a separate call.
4. Simulate `deposit(collection, tokenIds)` from the account with 1–100 IDs. A wallet may instead `safeTransferFrom` one Squeek to `SqueekStaking` with empty data; the previous owner becomes the depositor.
5. To withdraw, read `depositor(collection, id)` for every ID, then simulate `withdraw(collection, tokenIds)`.

Deposit each Squeek from its owner's wallet; `SqueekStaking` rejects deposits from the collection's launch contract.

### Stake and unstake $SQK

1. Read `stakeOf(account)` for `principal`, `freshPrincipal` and `freshUntilRound`. Fresh principal earns from the staking transaction but cannot be unstaked until round `freshUntilRound` begins.
2. To stake, check $SQK `allowance(account, staking)` and simulate `stake(amount)` with a positive amount.
3. To unstake, read `quoteUnstake(account, amount)` for `fee` and `net`. The fee depends on recent exits across all stakers and can rise before inclusion.
4. Set `maxFee` to the most the owner accepts and `deadline` to a near Unix time, then simulate `unstake(amount, maxFee, deadline)`.
5. Present the burned fee and the net before the owner signs.

Unstaking and withdrawing stay available while `SqueekStaking` intake or `SqueekMining` is paused.

### Claim rewards

1. Read `claimRecipient(account)`: it returns the account itself when no recipient is set, and only the returned address may call `claim(account)`.
2. Read `claimable(account)` at the simulation block. It grows while the 1,200-second reward stream runs.
3. Simulate `claim(account)` from the recipient's address and present the payout.
4. To compound instead, simulate `claimAndStake()` from the account. It reverts with `ExclusiveClaimRecipient` when an external recipient is set, and waits while intake is paused.

A zero claim returns `0` without an event.

### Merge Squeeks

1. Ask the owner which ID survives. The survivor keeps its token ID and image; the donor is burned and cannot be restored.
2. At one block, read `SqueekNFT.mergesOpen()`, `level(id)` and `nextMergeHeight(id)` for both IDs, and SqueekCore `state().blockHeight`.
3. Stop with the reason if the IDs are the same, merges are closed, the levels differ, the level is `MAXIMUM_LEVEL()`, or either `nextMergeHeight` is above the height. Completed Squeek blocks count toward a cooldown; time alone does not.
4. Check ownership: wallet-held Squeeks need `ownerOf(id) == account` and use `SqueekNFT.merge(survivor, donor)`. Deposited Squeeks need `SqueekStaking.depositor(collection, id) == account` and use `SqueekStaking.mergeDeposited(collection, survivor, donor)`; intake must not be paused.
5. Simulate the call, present the burn and the new level, then hand the unsigned call to the wallet.

### Hand over unsigned calls

Each `prepare-*` example exports a function that simulates the call and returns a call bundle; it sends nothing. The files are ready to import; the returned `bundle` looks like this:

```json
{
  "version": "2.0.0",
  "chainId": "0xaa36a7",
  "from": "0xAccount…",
  "atomicRequired": true,
  "calls": [{ "to": "0xStaking…", "data": "0x…", "value": "0x0" }]
}
```

Pass the bundle to a supporting wallet as an [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) `wallet_sendCalls` request; otherwise send each call as an ordinary transaction. An agent hands off the bundle and waits for the receipt; it never signs.

Shared ABI fragments and bundle helper:

```ts
// staking-abi.ts
import { getAddress, parseAbi, toHex, type Address, type Hex } from "viem";

export const stakingAbi = parseAbi([
  "function deposit(address collection, uint256[] tokenIds)",
  "function withdraw(address collection, uint256[] tokenIds)",
  "function mergeDeposited(address collection, uint256 survivor, uint256 donor)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount, uint256 maxFee, uint64 deadline) returns (uint256 net)",
  "function claim(address account) returns (uint256 amount)",
  "function claimAndStake() returns (uint256 amount)",
  "function setClaimRecipient(address recipient)",
  "function claimRecipient(address account) view returns (address)",
  "function claimable(address account) view returns (uint256)",
  "function depositor(address collection, uint256 tokenId) view returns (address)",
  "function stakeOf(address account) view returns (uint256 principal, uint256 freshPrincipal, uint64 freshUntilRound)",
  "function quoteUnstake(address account, uint256 amount) view returns (uint256 fee, uint256 net)",
  "function paused() view returns (bool)",
  "error Unauthorized()",
  "error EmergencyPaused()",
  "error InvalidDeposit()",
  "error InvalidWithdrawal()",
  "error InvalidStake()",
  "error InvalidUnstake()",
  "error InvalidBounds()",
  "error DeadlineExpired()",
  "error FeeLimitExceeded(uint256 fee, uint256 maxFee)",
  "error InvalidClaimRecipient()",
  "error ExclusiveClaimRecipient()",
]);

export function callBundle(chainId: bigint, from: Address, to: Address, data: Hex) {
  return { version: "2.0.0", chainId: toHex(chainId), from: getAddress(from), atomicRequired: true, calls: [{ to, data, value: "0x0" }] };
}
```

Claim: check the recipient, simulate, then return the bundle.

```ts
// prepare-claim.ts
import { encodeFunctionData, getAddress, zeroAddress, type Address } from "viem";
import { client, required } from "./setup";
import { callBundle, stakingAbi } from "./staking-abi";

export async function prepareClaim(staking: Address, account: Address, caller: Address) {
  const configured = await client.readContract({ address: staking, abi: stakingAbi, functionName: "claimRecipient", args: [account] });
  const recipient = configured === zeroAddress ? getAddress(account) : getAddress(configured);
  if (recipient !== getAddress(caller)) throw new Error(`Only ${recipient} may claim for ${account}`);
  const { result } = await client.simulateContract({ address: staking, abi: stakingAbi, functionName: "claim", args: [account], account: caller });
  const data = encodeFunctionData({ abi: stakingAbi, functionName: "claim", args: [account] });
  // Present the payout, then let the recipient's wallet sign the bundle. This never sends a transaction.
  return { simulatedPayoutBaseUnits: result.toString(), recipient, bundle: callBundle(BigInt(required("EXPECTED_CHAIN_ID")), caller, staking, data) };
}
```

Unstake: quote the fee, bound it, simulate, then return the bundle.

```ts
// prepare-unstake.ts
import { encodeFunctionData, type Address } from "viem";
import { client, required } from "./setup";
import { callBundle, stakingAbi } from "./staking-abi";

export async function prepareUnstake(staking: Address, account: Address, amount: bigint, maxFee: bigint, deadline: bigint) {
  const [fee, net] = await client.readContract({ address: staking, abi: stakingAbi, functionName: "quoteUnstake", args: [account, amount] });
  if (fee > maxFee) throw new Error(`Quoted fee ${fee} exceeds the accepted maximum ${maxFee}`);
  await client.simulateContract({ address: staking, abi: stakingAbi, functionName: "unstake", args: [amount, maxFee, deadline], account });
  const data = encodeFunctionData({ abi: stakingAbi, functionName: "unstake", args: [amount, maxFee, deadline] });
  return { burnedFeeBaseUnits: fee.toString(), netBaseUnits: net.toString(), bundle: callBundle(BigInt(required("EXPECTED_CHAIN_ID")), account, staking, data) };
}
```

Merge: check the gate, levels, cooldowns and ownership, simulate, then return the bundle for the right contract.

```ts
// prepare-merge.ts
import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";
import { client, required } from "./setup";
import { callBundle, stakingAbi } from "./staking-abi";

const nftAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function level(uint256 tokenId) view returns (uint8)",
  "function nextMergeHeight(uint256 tokenId) view returns (uint64)",
  "function mergesOpen() view returns (bool)",
  "function MAXIMUM_LEVEL() view returns (uint8)",
  "function merge(uint256 survivor, uint256 donor)",
]);
const coreAbi = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
]);

export async function prepareMerge(core: Address, nft: Address, staking: Address, account: Address, survivor: bigint, donor: bigint) {
  const owner = getAddress(account);
  const blockNumber = await client.getBlockNumber();
  const at = { blockNumber } as const;
  const [open, maximum, height, levels, nextHeights, holders] = await Promise.all([
    client.readContract({ address: nft, abi: nftAbi, functionName: "mergesOpen", ...at }),
    client.readContract({ address: nft, abi: nftAbi, functionName: "MAXIMUM_LEVEL", ...at }),
    client.readContract({ address: core, abi: coreAbi, functionName: "state", ...at }).then((s) => s.blockHeight),
    Promise.all([survivor, donor].map((id) => client.readContract({ address: nft, abi: nftAbi, functionName: "level", args: [id], ...at }))),
    Promise.all([survivor, donor].map((id) => client.readContract({ address: nft, abi: nftAbi, functionName: "nextMergeHeight", args: [id], ...at }))),
    Promise.all([survivor, donor].map((id) => client.readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [id], ...at }))),
  ]);
  const problems: string[] = [];
  if (survivor === donor) problems.push("survivor and donor are the same NFT");
  if (!open) problems.push("merges are closed");
  const [survivorLevel, donorLevel] = levels;
  if (survivorLevel === undefined || donorLevel === undefined) throw new Error("level read failed");
  if (survivorLevel !== donorLevel) problems.push(`levels differ: ${survivorLevel} and ${donorLevel}`);
  if (survivorLevel >= maximum) problems.push("already at the maximum level");
  nextHeights.forEach((next, i) => { if (next > height) problems.push(`${[survivor, donor][i]} can merge at Squeek block ${next}; height is ${height}`); });
  const deposited = holders.every((h) => getAddress(h) === getAddress(staking));
  if (deposited) {
    const depositors = await Promise.all([survivor, donor].map((id) => client.readContract({ address: staking, abi: stakingAbi, functionName: "depositor", args: [nft, id], ...at })));
    depositors.forEach((d, i) => { if (getAddress(d) !== owner) problems.push(`${owner} is not the depositor of ${[survivor, donor][i]}`); });
  } else {
    holders.forEach((h, i) => { if (getAddress(h) !== owner) problems.push(`${owner} does not hold ${[survivor, donor][i]} in its wallet`); });
  }
  if (problems.length > 0) throw new Error(`Not mergeable:\n- ${problems.join("\n- ")}`);
  const [to, data] = deposited
    ? [staking, encodeFunctionData({ abi: stakingAbi, functionName: "mergeDeposited", args: [nft, survivor, donor] })]
    : [nft, encodeFunctionData({ abi: nftAbi, functionName: "merge", args: [survivor, donor] })];
  await client.call({ account: owner, to, data });
  return {
    warning: `Squeek #${donor} will be burned permanently`,
    survivor: survivor.toString(),
    newLevel: survivorLevel + 1,
    bundle: callBundle(BigInt(required("EXPECTED_CHAIN_ID")), owner, to, data),
  };
}
```

`level` is a `uint8`, so viem returns it as `number`; `nextMergeHeight` and `blockHeight` are `bigint`.

### Run a checkpoint

Any account may call `checkpoint()` to issue $SQK for Squeek blocks completed after `SqueekMining` starts and fund `SqueekStaking` with it. The caller pays gas and receives nothing.

1. Read `SqueekMining.state()` at the latest block. Stop if `paused` is true or `startRound` is `0`; `checkpoint()` would revert with `EmergencyPaused` or `StartNotScheduled`.
2. Read `SqueekMining.checkpointStatus()` at the same block. Stop if `corePaused` is true or `roundSettled` is false.
3. Simulate `checkpoint()` against the same latest state. When nothing new is settled it returns without effect.
4. After a confirmed receipt, read `checkpointStatus()` again; one call processes at most 32 earning rounds, so another call may continue.

```ts
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
```

## Expected result

| Transaction | Events, in order | State change |
|---|---|---|
| Deposit with `deposit(...)` | Per token `Deposited` then SqueekNFT `Transfer` to `SqueekStaking`; then `PowerChanged` | `depositor(collection, id)` is the account; `accountPower` rises |
| Deposit with `safeTransferFrom` | SqueekNFT `Transfer` to `SqueekStaking`, then `Deposited` with the previous owner as account, then `PowerChanged` | `depositor(collection, id)` is the previous owner; `accountPower` rises |
| Withdraw | Per token `Withdrawn` then SqueekNFT `Transfer` to the account; then `PowerChanged` | `depositor` is zero; `accountPower` falls |
| Stake | `Staked(account, amount, principal, freshUntilRound)`, `PowerChanged`, $SQK `Transfer` to `SqueekStaking` | `stakeOf` principal and fresh amount rise |
| Unstake | `Unstaked(account, amount, fee, net)`, `PowerChanged`, $SQK burn `Transfer` of `fee`, $SQK `Transfer` of `net` | Principal falls by `amount`; SqueekToken `totalBurned` rises by `fee` |
| Claim | $SQK `Transfer` to the recipient, then `RewardClaimed(account, recipient, amount)` | `claimable` drops to zero; `rewardState().paid` rises |
| Set claim recipient | `ClaimRecipientSet(account, recipient)` | `claimRecipient(account)` returns the new value |
| Claim and stake | `PowerChanged`, then `ClaimedAndStaked(account, amount, principal, freshUntilRound)` | Principal rises by `amount`; `rewardState().compounded` rises |
| Merge, deposited | SqueekNFT burn `Transfer` and `Merged`, then `DepositedMerge` and `PowerChanged` | Survivor one level higher and still deposited; donor `depositor` is zero |
| Merge, wallet | SqueekNFT burn `Transfer`, then `Merged(survivor, donor, level, nextMergeHeight)` | `ownerOf(donor)` reverts; `level(survivor)` rises by one |
| Checkpoint | `StakingFunded` per earning round, $SQK mint `Transfer` to `SqueekMining`, `CheckpointMinted`, $SQK `Transfer` to `SqueekStaking`, `RewardFunded`, then `Checkpointed` | `state().minted` and `processedThroughRound` advance |

A checkpoint with nothing to fund emits only `Checkpointed` with `amount` `0`. Field layouts are on the [SqueekMining](mining.md#events) page; use the [SqueekStaking](https://docs.squeekchain.com/assets/abi/SqueekStaking.json) ABI to decode its events.

## Common failures

| Error | Contract | Cause | Fix |
|---|---|---|---|
| `Unauthorized` | SqueekStaking | Caller is not the depositor, or not the account's claim recipient | Sign from the depositor or the recipient |
| `EmergencyPaused` | SqueekStaking | Intake is paused for `deposit`, `stake`, `claimAndStake` or `mergeDeposited` | Wait for unpause; withdraw, unstake and claim still work |
| `InvalidDeposit` | SqueekStaking | Empty or over-100 batch, unbound collection, or the sale custodian depositing | Batch 1–100 from the owner's wallet |
| `InvalidWithdrawal` | SqueekStaking | Empty or over-100 batch | Batch 1–100 |
| `InvalidStake` | SqueekStaking | Zero amount, or the received $SQK differs from `amount` | Stake a positive amount |
| `InvalidBounds` | SqueekStaking | Principal or power would reach 2^128 | Use a smaller amount |
| `InvalidUnstake` | SqueekStaking | Zero amount, or more than mature principal | Wait for `freshUntilRound`, or unstake less |
| `FeeLimitExceeded(fee, maxFee)` | SqueekStaking | Exit fee rose above the owner's limit | Re-quote and ask the owner again |
| `DeadlineExpired` | SqueekStaking | `deadline` passed before inclusion | Prepare a new call |
| `ExclusiveClaimRecipient` | SqueekStaking | `claimAndStake` with an external claim recipient set | Clear the recipient, or claim to it |
| `InvalidClaimRecipient` | SqueekStaking | Recipient is `SqueekStaking` itself | Choose another address |
| `MergeSameToken`, `MergeLevelMismatch`, `MergeAtMaximumLevel` | SqueekNFT | Invalid pair | Choose a valid pair |
| `MergeNotOwner(caller, tokenId)` | SqueekNFT | Caller does not hold the token; deposited Squeeks are held by `SqueekStaking` | Use `mergeDeposited` for deposited Squeeks, or sign from the holder |
| `MergesClosed` | SqueekNFT | The admin has not opened merges | Wait for `MergesOpenChanged(true)` |
| `MergeCooldown(tokenId, nextMergeHeight)` | SqueekNFT | Completed Squeek block height is below `nextMergeHeight` | Wait for more completed blocks |
| `StartNotScheduled`, `EmergencyPaused` | SqueekMining | Mining not started, or paused | Wait for start or unpause |
| `CorePaused` | SqueekMining | SqueekCore is paused | Retry checkpoints after unpause; claims still work |
| Simulation passed, transaction failed | Any | State changed between simulation and inclusion | Re-read and prepare again; never reuse the old bundle |

## Verify the result

1. Check the receipt status and that its logs come from the addresses listed under [Deployments](overview.md#deployments).
2. Decode the events above and compare them with the simulation.
3. Re-read `depositor`, `stakeOf`, `accountPower`, `claimable`, ownership and $SQK balances at the receipt's block. After a merge, `ownerOf(donor)` must revert.
4. Show the result as final only after your confirmation depth.

## Related pages

- [SqueekMining](mining.md)
- [SqueekNFT](nft.md)
- [SqueekStaking](staking.md)
- [Quickstart](quickstart.md)
- [Index events](index-events.md)
- [Build with AI](https://docs.squeekchain.com/developers/build-with-ai.md)
- [Claiming rewards](https://docs.squeekchain.com/rewards/claim.md)
- [Merging Squeeks](https://docs.squeekchain.com/squeeks/merge.md)
