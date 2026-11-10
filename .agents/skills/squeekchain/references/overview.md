> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# Developers

> Squeekchain's contract graph, its Sepolia testnet deployment and launch order, published ABIs, integration rules, and where to start.

Web version: https://docs.squeekchain.com/developers/

## TL;DR

- The contracts are SqueekCore, SqueekNFT, SqueekToken, SqueekMining and SqueekStaking, deployed on the Sepolia testnet for testing only.
- Mining issues $SQK and funds Staking with all of it; Staking holds deposited Squeeks and staked $SQK and streams rewards to stakers.
- SqueekNFT holds 9,999 Squeeks: IDs 1–8,888 are the sale allocation, and IDs 8,889–9,999 go to the protocol and team.
- Verify the deployment before trusting a read, and follow the integration invariants below.

## Overview

Squeekchain's contracts record the hamster's settled work, issue $SQK for completed Squeek blocks, and stream that $SQK to stakers by power. Integrate through the contract ABIs; there is no SDK.

!!! note "Where to start"

    - **First read:** [Quickstart](quickstart.md) verifies the deployment and reads SqueekCore.
    - **Working with a coding agent:** [Build with AI](https://docs.squeekchain.com/developers/build-with-ai.md) installs the `squeekchain` agent skill with `npx skills add https://docs.squeekchain.com`.
    - **Wallets, marketplaces and owner agents:** [Build owner actions](owner-actions.md) prepares unsigned Staking deposits, stakes, claims, exits and merges for the owner's wallet.
    - **Indexers and analytics:** [Index events](index-events.md) builds a projection that survives reorgs.
    - **Exact ABI-level detail:** the contract pages for [SqueekCore](core.md), [SqueekMining](mining.md), [SqueekToken](token.md), [SqueekNFT](nft.md), [SqueekStaking](staking.md) and the [DotGrid renderer](dotgrid.md).

## Contract graph

Each contract has a function-by-function page and a published ABI exported from the same source.

| Contract | Role | Kind | ABI |
|---|---|---|---|
| [SqueekCore](core.md) | Records settled physical work, block units and difficulty | Transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekCore.json) |
| [SqueekNFT](nft.md) | The Genesis ERC-721 collection: 9,999 Squeeks, their levels, merge gate and merge cooldowns | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/SqueekNFT.json) |
| [SqueekToken](token.md) | The $SQK ERC-20: construction premint, one-time Mining binding, 2.1 billion $SQK lifetime cap, holder burns | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/SqueekToken.json) |
| [SqueekMining](mining.md) | Issues $SQK for completed Squeek blocks after its start and funds SqueekStaking with all of it | Guarded transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekMining.json) |
| [SqueekStaking](staking.md) | Holds deposited Squeeks and staked $SQK, computes account power, streams funding, pays claims and burns exit fees | Guarded transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekStaking.json) |
| [DotGrid renderer](dotgrid.md) | Onchain images and traits, and the validator for their page data | Immutable | [Renderer](https://docs.squeekchain.com/assets/abi/DotGridRenderer.json), [validator](https://docs.squeekchain.com/assets/abi/DotGridPageValidator.json) |

The [admin Timelock](admin.md) owns each proxy's ProxyAdmin. SqueekMining and SqueekStaking answer `deploymentIdentity()` from the proxy itself, without delegating, so a binding contract can authenticate their implementation and admin.

$SQK flows one way: SqueekCore certifies completed Squeek blocks; SqueekMining mints their scheduled $SQK through `mintForCheckpoint`, transfers all of it to SqueekStaking and calls `fund`; SqueekStaking streams it to stakers by power.

## Launch lifecycle

Sepolia deployed the graph in the order below; each stage used contracts from earlier stages. The Token-to-Mining and Mining-to-Staking bindings are permanent, and the collection's launch is fixed from its first issued Squeek.

1. **Core.** The SqueekCore proxy is created with its stream, genesis time, Guardian, Reporter, difficulty and work cap.
2. **Visuals and collection.** The DotGrid renderer, validator and page data are deployed, then SqueekNFT against them, SqueekCore, the admin Timelock and the protocol recipient. The collection starts paused, with nothing issued.
3. **Squeek issuance.** While issuance is paused, the admin binds the collection's launch contract with `SqueekNFT.configureLaunch`; the Guardian then unpauses issuance. Anyone may call `premint`, at most 100 Squeeks per call: IDs 1–8,888 go to the launch contract and IDs 8,889–9,999 to the protocol recipient. On Sepolia the launch contract is a testnet-only minter.
4. **Token.** SqueekToken is deployed with its premint (at most eight recipients) and the admin Timelock as binding authority; `mining()` is zero.
5. **Mining.** The deployment factory creates the initialized SqueekMining proxy against SqueekCore and SqueekToken, unbound and not started.
6. **Token binds Mining.** The timelock calls `SqueekToken.bindMining`, which validates the proxy, records it and calls `SqueekMining.completeBootstrap` in the same transaction. A failure reverts both.
7. **Staking.** The SqueekStaking proxy is created with its power table and exit-fee policy, bound to SqueekMining, SqueekToken, SqueekCore, the admin Timelock and the Genesis collection.
8. **Mining binds Staking.** The timelock calls `SqueekMining.bindStaking`, which authenticates the Staking proxy, implementation and admin and binds it permanently.
9. **Reserve stake.** The protocol recipient deposits one reserve Squeek in SqueekStaking to keep total power above zero, so funding never waits. No contract enforces this operational step.
10. **Start.** The timelock calls `SqueekMining.start`, which requires bound Staking and schedules issuance from the next full Core round; blocks completed before that round issue no $SQK.

[Verify the deployment](quickstart.md#verify-the-deployment) checks the Sepolia chain, the three proxies' identities and ProxyAdmins, the NFT, Token, Mining and Staking bindings it lists, that Mining has started, and the supply totals.

## Deployments

The contracts are deployed on the **Sepolia testnet** (chain ID `11155111`) as release `core-sepolia-20261103`, revision 7, for testing only; there is no mainnet deployment. The release's protocol revision is `staged-launch-1`, its reward-model revision `funded-stream-q128-1` and its profile `staging`. Every published ABI is the ABI of the deployed contract of that name.

| Contract | Address | Kind | ABI |
|---|---|---|---|
| SqueekCore | [`0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4`](https://eth-sepolia.blockscout.com/address/0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4) | Transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekCore.json) |
| SqueekNFT (Squeeks) | [`0xC4C7982657f00509548F3a3a41db7FA439a6856B`](https://eth-sepolia.blockscout.com/address/0xc4c7982657f00509548f3a3a41db7fa439a6856b) | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/SqueekNFT.json) |
| SqueekToken ($SQK) | [`0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e`](https://eth-sepolia.blockscout.com/address/0xd78a3956cf63164d1fa1c622ad3c66623162fa1e) | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/SqueekToken.json) |
| SqueekMining | [`0x2dCcB11fcC2dEfdd188555e45aCb52231e82e218`](https://eth-sepolia.blockscout.com/address/0x2dccb11fcc2defdd188555e45acb52231e82e218) | Guarded transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekMining.json) |
| SqueekStaking | [`0x50fd1780526C3186A0c037c7622203bC4fb611ca`](https://eth-sepolia.blockscout.com/address/0x50fd1780526c3186a0c037c7622203bc4fb611ca) | Guarded transparent proxy | [JSON](https://docs.squeekchain.com/assets/abi/SqueekStaking.json) |
| DotGrid renderer | [`0x50888Ea2469Cc4E619bfcBdc4A7E7d58d4Ddd165`](https://eth-sepolia.blockscout.com/address/0x50888ea2469cc4e619bfcbdc4a7e7d58d4ddd165) | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/DotGridRenderer.json) |
| DotGrid page validator | [`0xA605e7a53bdE1bbA13bD6109A55B9C0D8Ea90ad7`](https://eth-sepolia.blockscout.com/address/0xa605e7a53bde1bba13bd6109a55b9c0d8ea90ad7) | Immutable | [JSON](https://docs.squeekchain.com/assets/abi/DotGridPageValidator.json) |
| SqueekMining factory | [`0xA25268579197E03f255a35777C9a666cAF6a4f4e`](https://eth-sepolia.blockscout.com/address/0xa25268579197e03f255a35777c9a666caf6a4f4e) | Deployment tooling; created the SqueekMining proxy | Not published |
| Sepolia test minter | [`0xE78B4420CE205b8864F2F326f3181F9dd5EA8B5F`](https://eth-sepolia.blockscout.com/address/0xe78b4420ce205b8864f2f326f3181f9dd5ea8b5f) | Immutable, testnet only; SqueekNFT `launch()` | Not published |

Call SqueekCore, SqueekMining and SqueekStaking through their proxy addresses. Index from Ethereum block `12057556`, where SqueekCore was deployed. The full record, including implementations, runtime hashes and launch configuration, is published as [`sepolia.json`](https://docs.squeekchain.com/assets/deployments/sepolia.json).

### Implementation identities

[Verify the deployment](quickstart.md#verify-the-deployment) compares these values.

| Proxy | Implementation | Implementation runtime hash | Storage-layout digest | ProxyAdmin |
|---|---|---|---|---|
| SqueekCore | `0x6869D6102696243Fd17013ab955d99CD0c522ad3` | `0x65b5780a4fccafedeca1260806364d2bb512b4501c097253f792ae2839565a9c` | `0x9a9c008e029460808209571703fbf2679785874e0e6d3232f16a864d12abcb20` | `0x21b3CB8f00D0d47b246a57D04152D6e11D24aBB3` |
| SqueekMining | `0x32639fc0bBd16BA0b140F78950751591609cFaa4` | `0xbcc7179f61610f44cf19a8fe4ffe27c06cba083a9430eb2787c5807b30e1e959` | `0xd6b3c14eaf89f7fc4406a878b162d146dc32a171907d2571bc7ba1d2d34763a1` | `0xd857F72F7F73bB8B8050C14e923FF4e05f7d75CB` |
| SqueekStaking | `0xF7027f9759d98190638359920E0422D316b4eA92` | `0xb379b434af414fccf7fbb03105e07a527aba86bec169cdd7afadc640c4104bd1` | `0xc7d9d27b142e9eea9117d439e8c387fdffa8d777ea2c7ea2668654986b085e45` | `0x08AA8200B2A5A863b1eB8396914C49f96f325425` |

The immutable contracts' runtime hashes are in [`sepolia.json`](https://docs.squeekchain.com/assets/deployments/sepolia.json).

### Operational addresses

| Role | Address | What it does |
|---|---|---|
| Admin Timelock | `0xAA2e9621dE9ac23CBB36D1a1baC4C8B0694cc30D` | Owns the three ProxyAdmins; `governance()` of SqueekNFT, SqueekMining and SqueekStaking; SqueekToken's Mining binding authority. Minimum delay 300 seconds; anyone may execute a ready operation |
| Admin Safe | `0x3a83a80B9249EcA85A9540Ec878bD968F13CB676` | Sole timelock proposer and canceller, and controller of the Guardian; a Safe with one owner and threshold 1. Receives the treasury premint |
| Guardian | `0xb2826926eF5cFFEbef86037C27B48ce345eD691f` | Guardian of SqueekCore, SqueekNFT and SqueekMining; controlled by the admin Safe |
| Reporter signer | `0x71f47c02431e6995cf6F757c14bC6BfA443d0A86` | Signs each settlement; sends no transactions |
| Reserve custody Safe | `0xD5DAb9F1D15E9D45548078726C54732a5B59EB78` | SqueekNFT `protocolRecipient()`: holds the protocol reserve Squeeks and the liquidity premint, and deposited the reserve stake |
| DotGrid page root | `0x0677aCa34747cD8e60f988F75e2f89d5E00Bb27D` | Stores the Squeeks image data returned by SqueekNFT `art()` |

### Launch configuration

Unless noted, these values were chosen for this testnet deployment; they aren't constants of the contracts.

SqueekToken premint: 210,000,000 $SQK, a tenth of the 2.1 billion $SQK cap.

| Allocation | $SQK | Recipient |
|---|---|---|
| Team | 63,000,000 | Team account |
| Treasury | 63,000,000 | Admin Safe |
| Liquidity | 84,000,000 | Reserve custody Safe |

SqueekMining issuance: an allowance of 1,890,000,000 $SQK (the cap less the premint), with a launch bonus of 105,000,000 $SQK over the first 97,020 Squeek blocks after the start, then three halving periods of 393,470 Squeek blocks each.

All 9,999 Squeeks are issued:

| Token IDs | Allocation | Holder |
|---|---|---|
| 1–8,888 | Sale allocation (8,888) | The collection's launch contract (on Sepolia, the testnet-only minter) |
| 8,889–9,888 | Protocol reserve (1,000) | Reserve custody Safe; Squeek 8,889 is deposited in SqueekStaking as the reserve stake |
| 9,889–9,999 | Team (111) | Team account |

SqueekCore configuration, as `configuration()` returns it. The round length, rounds per settlement, difficulty rule and block units are constants of SqueekCore; the stream, genesis time, work cap and starting difficulty were chosen for this deployment:

| Setting | Value |
|---|---|
| Stream ID | `0xa78faebd5aad38b4f90c7f61b9c5c10e8d9b9afe74ebfc2e82ca98b7e57ed562` |
| Genesis time | `1793735400` (2026-11-03 19:50 UTC) |
| Most work per round | 10,000 work units |
| Starting difficulty | 10,875 work units per 1,000 Squeek blocks |
| Round length | 600 seconds |
| Most rounds per settlement | 16 |
| Difficulty target | 40 Squeek blocks per active round; each round moves difficulty 1/30 of the way toward it |
| Block units per Squeek block | 1,000,000,000 |

SqueekStaking power, as `basePower`, `powerParameters()` and `exitPolicy()` return it. A Squeek's power at level `L` is `round(1,000 × 2.2^(L − 1))`:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Power | 1,000 | 2,200 | 4,840 | 10,648 | 23,426 | 51,536 | 113,380 | 249,436 | 548,759 | 1,207,269 |

$SQK power is `Q = S / c × (1 + P / P_ref)`, for staked $SQK `S` and Squeek power `P` (see [SqueekStaking](staking.md)):

| Parameter | Value |
|---|---|
| `c`, $SQK per unit of power at the base rate | 40 $SQK |
| `P_ref`, Squeek power that doubles $SQK power | 1,000, one Level 1 Squeek |
| Exit fee, marginal rate | 2% with no recent exits, rising to 60% |
| Exit fee, saturation | Recent exits of 20% of the denominator reach the 60% rate |
| Exit fee, window | 7 UTC days, today included |
| Exit fee, denominator floor | 21,000,000 $SQK |

Merge cooldowns are on [SqueekNFT](nft.md).

### Environment file

The examples read these values from the environment:

```sh
# sepolia-env.sh
EXPECTED_CHAIN_ID=11155111
CORE_ADDRESS=0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4
EXPECTED_CORE_IMPLEMENTATION=0x6869d6102696243fd17013ab955d99cd0c522ad3
EXPECTED_CORE_RUNTIME_HASH=0x65b5780a4fccafedeca1260806364d2bb512b4501c097253f792ae2839565a9c
EXPECTED_CORE_LAYOUT_DIGEST=0x9a9c008e029460808209571703fbf2679785874e0e6d3232f16a864d12abcb20
EXPECTED_CORE_PROXY_ADMIN=0x21b3cb8f00d0d47b246a57d04152d6e11d24abb3
MINING_ADDRESS=0x2dccb11fcc2defdd188555e45acb52231e82e218
EXPECTED_MINING_IMPLEMENTATION=0x32639fc0bbd16ba0b140f78950751591609cfaa4
EXPECTED_MINING_RUNTIME_HASH=0xbcc7179f61610f44cf19a8fe4ffe27c06cba083a9430eb2787c5807b30e1e959
EXPECTED_MINING_LAYOUT_DIGEST=0xd6b3c14eaf89f7fc4406a878b162d146dc32a171907d2571bc7ba1d2d34763a1
EXPECTED_MINING_PROXY_ADMIN=0xd857f72f7f73bb8b8050c14e923ff4e05f7d75cb
STAKING_ADDRESS=0x50fd1780526c3186a0c037c7622203bc4fb611ca
EXPECTED_STAKING_IMPLEMENTATION=0xf7027f9759d98190638359920e0422d316b4ea92
EXPECTED_STAKING_RUNTIME_HASH=0xb379b434af414fccf7fbb03105e07a527aba86bec169cdd7afadc640c4104bd1
EXPECTED_STAKING_LAYOUT_DIGEST=0xc7d9d27b142e9eea9117d439e8c387fdffa8d777ea2c7ea2668654986b085e45
EXPECTED_STAKING_PROXY_ADMIN=0x08aa8200b2a5a863b1eb8396914c49f96f325425
SQK_ADDRESS=0xd78a3956cf63164d1fa1c622ad3c66623162fa1e
NFT_ADDRESS=0xc4c7982657f00509548f3a3a41db7fa439a6856b
AUTH_MINTER_ADDRESS=0xe78b4420ce205b8864f2f326f3181f9dd5ea8b5f
MINING_FACTORY_ADDRESS=0xa25268579197e03f255a35777c9a666caf6a4f4e
INDEX_FROM_BLOCK=12057556
EXPECTED_TIMELOCK=0xaa2e9621de9ac23cbb36d1a1bac4c8b0694cc30d
```

## Integration invariants

1. **Verify before reading.** Check the chain ID; each proxy's implementation, runtime hash, layout digest and ProxyAdmin owner; and the bindings listed under [Verify the deployment](quickstart.md#verify-the-deployment). Check anything else you rely on separately.
2. **Decode with the published ABIs.** They're the ABIs of the deployed contracts; contract source isn't verified on block explorers.
3. **One block per snapshot.** Read everything at one Ethereum block and keep its hash.
4. **Use bigint.** viem returns `bigint` for `uint64` and wider; never convert cumulative totals to `number`.
5. **Count blocks from block units.** Height is `cumulativeBlockUnits / 1_000_000_000`. Never divide physical work by difficulty.
6. **Price with the previous difficulty.** An event's difficulty prices the next active round, not its own.
7. **Respect the certified frontier.** Rounds after `settledThroughRound` are unknown, not zero. Every `BatchSettled` advances the frontier, including zero-work batches.
8. **Bindings are permanent.** `SqueekToken.mining()` and `SqueekMining.bindings().staking` are zero until bound, then never change. `SqueekNFT.launch()` can be replaced by the admin only while issuance is paused and nothing is issued; it is fixed from the first `premint`. Treat a zero as an unfinished launch stage, never as a placeholder to fill.
9. **Rewards accrue to the staker.** Read `SqueekStaking.accountPower(account)` and `claimable(account)`; a Squeek carries its level, not rewards. Only the address returned by `claimRecipient(account)` may call `claim(account)`, and that address receives the $SQK.
10. **Read custody live.** A deposited Squeek is owned by SqueekStaking; its depositor is `SqueekStaking.depositor(collection, tokenId)`. Read `ownerOf` or `depositor` immediately before an owner action. Approved operators cannot merge, stake or claim.
11. **Prepare, don't sign.** Deposits, stakes, claims, exits and merges are signed by the owner's wallet. Simulate every call and hand over unsigned calls; never hold or request a private key.
12. **Count supply once.** `SqueekToken.totalMinted()` equals `totalPreminted()` plus `SqueekMining.state().minted`, and `totalSupply()` equals `totalMinted()` minus `totalBurned()`. `CheckpointMinted` and its mint `Transfer` describe the same $SQK, which then moves to SqueekStaking: `SqueekStaking.rewardState().funded` equals `SqueekMining.state().minted`.
13. **Roll back on reorgs.** Key events by `(chainId, blockHash, transactionHash, logIndex)` and replay derived state from the common ancestor.
14. **Treat metadata as untrusted.** Never inject a `tokenURI` SVG into application markup.

## In this section

- [Quickstart](quickstart.md) Verify the deployment and read SqueekCore.
- [SqueekCore](core.md) Settled work, block progress and difficulty.
- [SqueekMining](mining.md) Issuance schedule, start, checkpoints and Staking funding.
- [SqueekToken](token.md) The $SQK token: premint, Mining binding, burns and the lifetime cap.
- [SqueekNFT](nft.md) The Squeek NFT contract: ownership, levels, merges, reveal and metadata.
- [SqueekStaking](staking.md) Deposits, staking, account power, reward stream, claims and exits.
- [DotGrid renderer](dotgrid.md) Onchain images, traits and the identities that prove them.
- [Build owner actions](owner-actions.md) Prepare Staking and merge calls for the owner's wallet to sign.
- [Index events](index-events.md) Replay settlements, issuance and Staking rewards and survive reorgs.
- [Build with AI](https://docs.squeekchain.com/developers/build-with-ai.md) Install the squeekchain agent skill and connect your coding agent.
- [API](api.md) Read status, statistics, settlements, events and Squeek data over HTTP.

## Related pages

- [Quickstart](quickstart.md)
- [SqueekStaking](staking.md)
- [Build with AI](https://docs.squeekchain.com/developers/build-with-ai.md)
- [What the system proves](https://docs.squeekchain.com/security/proof-limits.md)
- [Glossary](glossary.md)
