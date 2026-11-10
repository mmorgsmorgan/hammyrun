> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# Admin and upgrades

> What can never change in Squeekchain, which contracts can be upgraded and by whom, and how every change is made public before it applies.

Web version: https://docs.squeekchain.com/security/admin/

## TL;DR

- Most of the system can't be changed: the token and the Squeeks aren't upgradeable, and the $SQK cap, premint, Squeek supply, maximum level and cooldown table are permanent.
- Only Core, Mining and Staking can be upgraded, and only by the admin through a Timelock: each change is scheduled publicly onchain and applies only after a delay.
- Pauses are narrow: none of them blocks claiming rewards, withdrawing Squeeks, or unstaking $SQK from Staking.
- Every upgrade is public and delayed before it applies. The delay gives notice rather than reviewing the new code, so upgraded contracts still rely on the admin. On the Sepolia testnet the delay is a short testing setting.

## Why is there an admin?

Squeekchain is a new idea: proof of work powered by a hamster. With little precedent to learn from, its trust model balances two needs: rules that no one can change, and a careful, public way to fix problems if they appear. The admin handles the second. It can't act on its own schedule: every change it makes goes through a Timelock, a contract that publishes the change onchain and holds it for a set time before it can run, so anyone can see it coming.

A second role, the Guardian, is a safety switch. If something looks wrong, it can pause specific actions straight away, but it can't move anyone's $SQK or Squeeks or change a rule.

## What stays fixed?

The token (`SqueekToken`) isn't upgradeable: its lifetime cap and premint are fixed, and it binds one Mining contract permanently, which mints only to itself. Mining, not the token, checks work, processes rounds, and applies the issuance schedule.

`SqueekNFT` isn't upgradeable either. Its 9,999-Squeek supply, the split between IDs 1–8,888 and the protocol's 8,889–9,999, maximum level and merge cooldowns are fixed at construction. The admin can set the launch contract, which receives IDs 1–8,888 at issuance, only while issuance is paused and before any NFT exists, and can open or close merges at any time.

Token binds once to Mining, and Mining binds once to Staking; neither binding can change. The NFT's launch binding becomes fixed once NFT issuance starts. The admin starts Mining once, after Staking is bound.

Pauses are narrower than upgrades. The Core Guardian can stop settlement, NFT issuance, and new Staking intake; the Mining Guardian can stop issuance. Claims of funded rewards, Squeek withdrawals, and unstaking of mature $SQK continue through every pause; [Pauses and unavailable services](https://docs.squeekchain.com/security/availability.md#contract-pauses) lists the full matrix.

## What can an upgrade change?

Only Core, Mining and Staking can be upgraded, and only by the admin through its `Timelock`. Each upgrade is scheduled publicly onchain and can be executed only after the delay, so it's visible before it applies. Nothing else can change their code.

An upgrade can change how Core records work, how Mining issues $SQK within the cap, and how Staking holds deposits and calculates power, rewards, and exit fees ([how staking works](https://docs.squeekchain.com/rewards/staking.md)). The Timelock gives notice rather than reviewing the change, so these contracts rely on the admin.

## Who holds these powers on Sepolia?

On Sepolia, the admin `Timelock` owns the Core, Mining, and Staking `ProxyAdmin` contracts, is the admin address of Mining, Staking and the NFT, and is the token's Mining binding authority. Its delay is a short testing setting. [Operational addresses](overview.md#operational-addresses) lists the proposers, the exact delay, the Guardian, the Reporter, and the reserve recipient.

These are testnet settings for testing only, not a mainnet policy. Before relying on any deployment:

- Read `owner()` on each `ProxyAdmin` and `getMinDelay()` on the timelock; a proxy's code can change.
- Watch the timelock's `CallScheduled` events, which announce an upgrade or binding before it can execute.
- After an `Upgraded` event, treat the new implementation as unknown until its runtime hash, version and storage layout match a reviewed record. The [Quickstart](quickstart.md#verify-the-deployment) shows the check.
- `SqueekToken` and `SqueekNFT` have no proxy or owner; read their admin-set bindings and flags rather than assuming them.

## Technical detail: admin roles

The admin is a `Timelock` (OpenZeppelin `TimelockController`). Its only proposer and canceller is the admin Safe, the team's multisig; once a change's delay has passed, anyone can execute it. The admin owns the Core, Mining, and Staking `ProxyAdmin` contracts, is the address `governance()` returns in Mining, Staking, and the NFT, and is the token's `miningBindingAuthority`. The Guardians are separate roles that act without a delay.

The Core Guardian pauses and unpauses settlement and NFT issuance, and can replace the Reporter while Core is paused; the NFT and Staking contracts read that Guardian from Core on every call. It can pause Staking intake, but only the admin resumes it. Mining stores its own Guardian, which the admin can replace; it pauses issuance, and only the admin resumes it. The Reporter signs settlements; relayers submit them.

`Timelock` proposers schedule changes and cancellers can cancel them. After the configured delay, an eligible operation can execute through a `ProxyAdmin` or an admin-only (`onlyGovernance`) function without Guardian or Reporter approval.

### Permissions
| Component | Admin boundary |
| --- | --- |
| `SqueekCore` | The `Timelock`'s `ProxyAdmin` upgrades code; the Core Guardian separately pauses/unpauses `SqueekCore` and changes the Reporter while paused |
| `SqueekMining` | Upgradeable through its `Timelock`-owned `ProxyAdmin`. The admin calls `bindStaking` once, then `start` once; unpauses; replaces the Mining Guardian. The Mining Guardian pauses issuance and start |
| `SqueekStaking` | Upgradeable through its `Timelock`-owned `ProxyAdmin`, which `bindStaking` requires. The admin unpauses intake and recovers NFTs held without a registered depositor. The Core Guardian pauses intake only |
| `SqueekToken` | Cannot be upgraded. `miningBindingAuthority` calls `bindMining` once, which atomically completes Mining's bootstrap; after that the mint caller and recipient never change |
| `SqueekNFT` | Cannot be upgraded. The admin calls `configureLaunch` while paused and before issuance, and `setMergesOpen`; the Core Guardian pauses and unpauses issuance; owners merge their own Squeeks and the NFT burns the donor |

A compatible Core upgrade preserves stored positions and the exact pricing, steering, and block-unit rules. Core has no difficulty setter; difficulty changes only under that fixed rule. Release policy is that changing the rule or its constants requires a separately approved fresh ledger, so existing history isn't reinterpreted; the contracts don't enforce this, and an upgrade could change the rule.

### Guarantees
Core exposes settlement and Guardian administration, with no manual difficulty adjustment or arbitrary-call entrypoint. Settlement signatures name the executing implementation, so a signature naming a different implementation can't authorize settlement after an upgrade.

The token mints its premint once at construction, to at most eight recipients, and enforces its lifetime minting cap; holder burns never reopen it. Its mint function can't rewrite holders' existing balances, spending allowances, or permit nonces.

Mining binds only a Staking proxy whose `ProxyAdmin` is owned by the admin and whose Mining, Token, Core, and admin bindings match. Every checkpoint that mints must transfer exactly that amount to Staking and notify it, or the whole checkpoint reverts.

After every reward payout and every unstake, Staking checks that its $SQK balance covers all staked principal plus funded, unpaid rewards. $SQK sent to it directly doesn't become a reward.

### Assumptions
Upgrade administrators must preserve stored data and economic rules; what each upgrade can change is [above](admin.md#what-can-an-upgrade-change). Mining's checks can't detect consistent false work from Core. A Mining upgrade could also change how round records are processed, and the token enforces neither a per-block issuance limit nor Mining's schedule. A Staking upgrade could also change exit fees, and its balance check runs inside the upgradeable code, so it guards against faults in the code it ships with.

Mining, not the token, requires work-backed issuance, processes each round once, and prices completed blocks by its schedule; Staking, not Mining, shares funded $SQK across stakers by their current power.

### Failure behavior
| Condition | Effect |
| --- | --- |
| Core Guardian pauses `SqueekCore` | Settlement stops; `SqueekMining` checkpoint reverts `CorePaused` |
| Mining Guardian pauses `SqueekMining` | `checkpoint` and `start` revert `EmergencyPaused` until the admin unpauses; funded Staking rewards keep streaming and stay claimable |
| Core Guardian pauses `SqueekStaking` intake | Deposits, staking, compounding, and deposited merges stop until the admin resumes; claims, withdrawals, unstaking, and funding continue |
| Reporter change while unpaused | Fails; `SqueekCore` must be paused and the new Reporter address unused |
| Second `bindMining` or `bindStaking` | Reverts; neither binding can be replaced |
| `start` before Staking is bound | Reverts `StakingNotBound` |
| `Timelock` operation not ready | Cannot execute through the normal admin path |
| Mint request exceeds remaining supply | `SqueekToken` rejects the entire mint; Mining clips scheduled issuance to the remaining cap |
| `SqueekMining` mint request within the cap that work doesn't back | `SqueekToken` accepts it; the token doesn't check work |

## Related pages
- [Roles and permissions](https://docs.squeekchain.com/security/roles.md)
- [Pauses and unavailable services](https://docs.squeekchain.com/security/availability.md)
- [SqueekToken](token.md)
- [Staking](https://docs.squeekchain.com/rewards/staking.md)
