> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# SqueekNFT

> SqueekNFT function by function: issuance, launch custody, levels and merges, sealed and revealed metadata, events, errors and the ABI.

Web version: https://docs.squeekchain.com/developers/nft/

## TL;DR

- SqueekNFT is the 9,999-token ERC-721: IDs 1–8,888, the sale allocation, go to the launch; IDs 8,889–9,999 go to reserve custody at `protocolRecipient`.
- Anyone can `premint` up to 100 sequential IDs per call once the [admin](admin.md) has configured the launch and the Guardian has unpaused issuance.
- An owner merges two same-level Squeeks with `merge`: the donor burns and the survivor rises one level, gated by `mergesOpen` and SqueekCore's completed height.
- Metadata stays sealed until the launch reports its reveal; then `tokenURI` renders through the DotGrid renderer.

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

SqueekNFT tracks ownership for at most 9,999 Squeeks, stores each Squeek's level and next merge height, and returns metadata from the [DotGrid renderer](dotgrid.md). It has no proxy or owner. Its constructor fixes the renderer, Genesis DotGrid page, collection seed, `SqueekCore`, admin Timelock, protocol recipient, collection URI, maximum level and cooldown table; the admin binds or replaces the launch until issuance starts.

The bound launch distributes IDs 1–8,888, and `SqueekStaking` pays rewards for deposited Squeeks. Merges use only SqueekCore's completed Squeek block height.

The Sepolia address is under [Deployments](overview.md#deployments). Its testnet launch reports a fixed test reveal.

## Functions

### Types

```solidity
// Internal per-token record; read it through level(tokenId) and nextMergeHeight(tokenId).
struct MergeRecord {
    uint8 level;            // 0 = never merged (Level 1)
    uint64 nextMergeHeight; // SqueekCore completed height
}
```

Collection constants are `uint16` and `MAXIMUM_LEVEL` is `uint8`, so they decode to `number` in viem; token IDs, `totalIssued`, `totalSupply` and heights decode to `bigint`.

### Standard ERC-721 and ERC-2981

```solidity
function balanceOf(address owner) external view returns (uint256);
function ownerOf(uint256 tokenId) external view returns (address);
function getApproved(uint256 tokenId) external view returns (address);
function isApprovedForAll(address owner, address operator) external view returns (bool);
function approve(address to, uint256 tokenId) external;
function setApprovalForAll(address operator, bool approved) external;
function transferFrom(address from, address to, uint256 tokenId) external;
function safeTransferFrom(address from, address to, uint256 tokenId) external;
function safeTransferFrom(address from, address to, uint256 tokenId, bytes data) external;
function name() external view returns (string);
function symbol() external view returns (string);
function supportsInterface(bytes4 interfaceId) external view returns (bool);
function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 amount);
```

OpenZeppelin's [ERC721](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/contracts/token/ERC721/ERC721.sol) and [ERC2981](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/contracts/token/common/ERC2981.sol), unmodified; name `Squeek`, symbol `SQUEEK`. Transfers work while issuance is paused, and level and next merge height stay with the ID. Approvals let an operator transfer, never merge. `supportsInterface` also reports ERC-4906 (`0x49064906`); `royaltyInfo` pays `protocolRecipient` at `royaltyBps` over 10,000.

### Owner actions

#### `merge`

```solidity
function merge(uint256 survivor, uint256 donor) external;
```

Burns `donor` and raises `survivor` one level; the caller must own both (approvals grant nothing). Checks, in order: two distinct live tokens owned by the caller; one shared level below `MAXIMUM_LEVEL`; `mergesOpen`; both next merge heights at or below SqueekCore's completed height. The survivor's next merge height becomes `height + cooldownBlocks(newLevel)`, or 0 at `MAXIMUM_LEVEL`. The issuance pause never blocks merges, and merges never change `totalIssued`.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `survivor` | `uint256` | token ID | Keeps its ID and rises one level |
| `donor` | `uint256` | token ID | Burned; its record is deleted |

Deposited Squeeks are owned by Staking, so their holder merges them with [`SqueekStaking.mergeDeposited`](staking.md). Reverts with `MergeSameToken`, `ERC721NonexistentToken`, `MergeNotOwner`, `MergeLevelMismatch`, `MergeAtMaximumLevel`, `MergesClosed`, `MergeCooldown` or `CoreReadFailed`.

### Permissionless

#### `premint`

```solidity
function premint(uint16 quantity) external;
```

Anyone, while issuance is unpaused: issues the next `quantity` sequential IDs, to `launch` up to `SALE_ALLOCATION` (1–8,888) and to `protocolRecipient` above it (8,889–9,999). It uses `_safeMint`, so contract recipients must accept ERC-721 transfers. Burns never restore issuance capacity.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `quantity` | `uint16` | tokens | 1 to `MAX_PREMINT_QUANTITY` (100) |

Reverts with `EnforcedPause`, `InvalidMintQuantity`, `SupplyExceeded` or `ReentrancyGuardReentrantCall`.

#### `announceReveal`

```solidity
function announceReveal() external;
```

Anyone, once, after the launch reports the canonical reveal: emits `BatchMetadataUpdate(1, 9999)` and `RevealAnnounced(artSeed)` so marketplaces refresh. `tokenURI` switches to revealed metadata at the launch's reveal regardless. Reverts with `RevealAlreadyAnnounced`, `RevealUnavailable` or `LaunchReadFailed`.

### Views

#### `tokenURI`

```solidity
function tokenURI(uint256 tokenId) external view returns (string);
```

JSON metadata as a `data:application/json;base64,` URI: the same sealed metadata for every live token before reveal (see [Reveal and metadata](nft.md#reveal-and-metadata)), then the renderer's `tokenURIForPinnedPage(art, artCodehash, keccak256(abi.encode(collectionSeed, artSeed)), tokenId)`. Reverts with `ERC721NonexistentToken` for an unissued or burned ID, `LaunchReadFailed` if the launch read fails, and `ArtCodehashMismatch` if the page root's code changed; renderer failures propagate.

#### `revealState`

```solidity
function revealState() external view returns (bool revealed, bytes32 artSeed);
```

The launch's canonical reveal, read through a bounded two-word call; `(false, 0)` before a launch is configured. Reverts with `LaunchReadFailed` for a failed or malformed reply.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `revealed` | `bool` | — | Whether the canonical reveal has occurred |
| `artSeed` | `bytes32` | — | Canonical art seed the launch reports; zero before reveal |

#### `level`

```solidity
function level(uint256 tokenId) external view returns (uint8);
```

A live token's level: 1 until it first merges, up to `MAXIMUM_LEVEL`. Reverts with `ERC721NonexistentToken` for an unissued or burned ID.

#### `nextMergeHeight`

```solidity
function nextMergeHeight(uint256 tokenId) external view returns (uint64);
```

The minimum SqueekCore completed height for a live token's next merge: 0 for a never-merged token and for a token at `MAXIMUM_LEVEL`. Reverts with `ERC721NonexistentToken` for an unissued or burned ID.

#### `cooldownBlocks`

```solidity
function cooldownBlocks(uint8 tokenLevel) external view returns (uint64);
```

Completed Squeek blocks a token that reached `tokenLevel` waits before merging again. Fixed at construction: positive and strictly increasing for Levels 2 to `MAXIMUM_LEVEL − 1`; 0 for Level 1, `MAXIMUM_LEVEL` and levels outside the collection.

#### `mergesOpen`

```solidity
function mergesOpen() external view returns (bool);
```

The merge gate; closed until the admin opens it.

#### Supply

```solidity
function totalIssued() external view returns (uint256);
function totalBurned() external view returns (uint16);
function totalSupply() external view returns (uint256);
```

Lifetime issuance (the highest ID issued), lifetime merge burns, and circulating supply `totalIssued − totalBurned`. Burns never decrement `totalIssued`.

#### Limits

```solidity
function MAX_SUPPLY() external view returns (uint16);
function SALE_ALLOCATION() external view returns (uint16);
function PROTOCOL_ALLOCATION() external view returns (uint16);
function TEAM_ALLOCATION() external view returns (uint16);
function PROTOCOL_RESERVE() external view returns (uint16);
function MAX_PREMINT_QUANTITY() external view returns (uint16);
function MAXIMUM_LEVEL() external view returns (uint8);
```

| Constant | Value | Meaning |
|---|---|---|
| `MAX_SUPPLY` | 9,999 | Lifetime issuance cap |
| `SALE_ALLOCATION` | 8,888 | IDs 1–8,888, issued to the launch |
| `PROTOCOL_ALLOCATION` | 1,000 | Protocol share of the reserve |
| `TEAM_ALLOCATION` | 111 | Team share, delivered from the reserve custody |
| `PROTOCOL_RESERVE` | 1,111 | IDs 8,889–9,999, issued to `protocolRecipient` |
| `MAX_PREMINT_QUANTITY` | 100 | IDs per `premint` call |
| `MAXIMUM_LEVEL` | Deployment parameter, 2–10 | Highest level; a token there never merges again |

#### Bindings and art

```solidity
function launch() external view returns (address);
function sqkCore() external view returns (address);
function governance() external view returns (address);
function guardian() external view returns (address);
function protocolRecipient() external view returns (address);
function royaltyBps() external view returns (uint96);
function contractURI() external view returns (string);
function revealAnnounced() external view returns (bool);
function paused() external view returns (bool);
function renderer() external view returns (address);
function art() external view returns (address);
function artCodehash() external view returns (bytes32);
function sceneHash() external view returns (bytes32);
function assetSetHash() external view returns (bytes32);
function collectionSeed() external view returns (bytes32);
```

`launch` is zero until configured and fixed after first issuance. `guardian` reads SqueekCore's current Guardian on every call, so a rotation applies from the next call. `paused` is the issuance pause. The renderer, page and seed identities are those [Verifying identities](dotgrid.md#verifying-identities) checks; `collectionSeed` is combined with the reveal's `artSeed` before rendering.

### Admin

#### `configureLaunch`

```solidity
function configureLaunch(address launch_) external;
```

Admin only (`governance()` returns the admin Timelock), while issuance is paused and before the first ID is issued: binds or replaces the launch. The launch must be a contract other than `protocolRecipient` whose `nft()`, `core()`, `governance()` and `protocolRecipient()` report this collection's graph. Reverts with `UnauthorizedGovernance`, `ExpectedPause`, `LaunchAlreadyConfigured`, `InvalidLaunch` or `LaunchReadFailed`.

#### `setMergesOpen`

```solidity
function setMergesOpen(bool open) external;
```

Admin only: opens or closes merges, independently of issuance, rewards and Staking. Reverts with `UnauthorizedGovernance`.

### Guardian

#### `pauseMint` and `unpauseMint`

```solidity
function pauseMint() external;
function unpauseMint() external;
```

SqueekCore's current Guardian only: stops or resumes `premint`; transfers and merges are unaffected. The contract starts paused, and `unpauseMint` requires a configured launch. Reverts with `UnauthorizedGuardian`, `EnforcedPause`, `ExpectedPause`, `LaunchNotConfigured`, or `InvalidSqkCore`/`InvalidGuardian` if SqueekCore's Guardian can't be read.

### Setup

The constructor validates the renderer and page validator runtime hashes, renderer ID, page root codehash, page hash and asset-set hash against generated constants. It also requires a nonzero collection seed and a nonempty collection URI; code at SqueekCore, its Guardian, the admin Timelock and the protocol recipient; `MAXIMUM_LEVEL` from 2 to 10; and exactly `MAXIMUM_LEVEL − 2` positive, strictly increasing cooldowns below `2^32`. It starts paused with no launch.

## Events

```solidity
event GenesisLaunchConfigured(address indexed launch, address indexed protocolRecipient);
event GenesisPreminted(uint256 firstTokenId, uint256 lastTokenId, uint256 totalIssued);
event RevealAnnounced(bytes32 artSeed);
event Merged(uint256 indexed survivor, uint256 indexed donor, uint8 level, uint64 nextMergeHeight);
event MergesOpenChanged(bool open);
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
event MetadataUpdate(uint256 _tokenId);
event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
event Paused(address account);
event Unpaused(address account);
```

| Event | Emitted when |
|---|---|
| `GenesisLaunchConfigured` | The admin binds or replaces the launch |
| `GenesisPreminted` | Once per `premint` batch, after its `Transfer` events; `totalIssued` is after the batch |
| `RevealAnnounced` | `announceReveal`, with the canonical `artSeed` |
| `Merged` | A merge; `level` and `nextMergeHeight` are the survivor's new values. A `Transfer` to the zero address records the donor burn |
| `MergesOpenChanged` | The admin opens or closes merges |
| `Transfer`, `Approval`, `ApprovalForAll` | Standard ERC-721 issuance, transfers, burns and approvals |
| `BatchMetadataUpdate` | `announceReveal`, for IDs 1–9,999 |
| `MetadataUpdate` | Declared by the inherited ERC-4906 interface; not emitted by a SqueekNFT action |
| `Paused`, `Unpaused` | The contract starts paused; then the Guardian pauses or resumes issuance |

## Errors

| Error | Cause | Fix |
|---|---|---|
| `UnauthorizedGovernance(caller)` | Admin action from another address | Admin only |
| `UnauthorizedGuardian(caller)` | `pauseMint` or `unpauseMint` from an address other than SqueekCore's current Guardian | Guardian only |
| `EnforcedPause`, `ExpectedPause` | `premint` while paused, or `configureLaunch`/`unpauseMint` while not paused | Check `paused()` |
| `LaunchAlreadyConfigured` | `configureLaunch` after first issuance | The launch is fixed |
| `LaunchNotConfigured` | `unpauseMint` with no launch | The admin configures the launch first |
| `InvalidLaunch(launchAddress)` | Launch has no code, equals `protocolRecipient`, or reports another graph | Use the launch deployed for this collection |
| `LaunchReadFailed` | A launch read failed or returned a short or malformed reply | Investigate the launch |
| `InvalidMintQuantity(supplied, maximum)` | `premint` of 0 or more than 100 | Use 1–100 |
| `SupplyExceeded(requested, remaining)` | `premint` past `MAX_SUPPLY` | Premint at most `MAX_SUPPLY − totalIssued` |
| `RevealUnavailable` | `announceReveal` before the launch reveals | Wait for `revealState().revealed` |
| `RevealAlreadyAnnounced` | Second `announceReveal` | Nothing to do |
| `MergeSameToken(tokenId)` | `survivor == donor` | Use two tokens |
| `MergeNotOwner(caller, tokenId)` | Caller does not own both tokens | Merge from the owner; deposited Squeeks merge through Staking |
| `MergeLevelMismatch(survivorLevel, donorLevel)` | Levels differ | Pair same-level tokens |
| `MergeAtMaximumLevel(tokenId)` | Tokens are at `MAXIMUM_LEVEL` | Cannot merge further |
| `MergesClosed` | `mergesOpen` is false | Wait for the admin to open merges |
| `MergeCooldown(tokenId, nextMergeHeight)` | A token's next merge height is above SqueekCore's completed height | Wait for that Squeek block height |
| `CoreReadFailed` | SqueekCore `state()` failed or was malformed | Investigate SqueekCore |
| `ArtCodehashMismatch(actual)`, `SceneHashMismatch(actual)`, `AssetSetMismatch(actual)`, `RendererCodehashMismatch(actual)`, `RendererIdMismatch(actual)`, `ValidatorCodehashMismatch(actual)` | Page or renderer identity differs from the pinned value | Do not trust the rendering; see [Verifying identities](dotgrid.md#verifying-identities) |
| `InvalidArt(artAddress)`, `InvalidRenderer(rendererAddress)`, `InvalidSqkCore(sqkCoreAddress)`, `InvalidGovernance(governanceAddress)`, `InvalidGuardian(guardianAddress)`, `InvalidProtocolRecipient(protocolRecipientAddress)`, `InvalidContractURI`, `ZeroCollectionSeed` | Invalid constructor arguments; `InvalidSqkCore` and `InvalidGuardian` also when SqueekCore's Guardian cannot be read later | Setup only, or investigate SqueekCore |
| `InvalidMaximumLevel(maximumLevel)`, `InvalidCooldownCount(supplied, expected)`, `InvalidCooldown(index, cooldownBlocks)` | Invalid level table | Setup only |
| `ERC721NonexistentToken(tokenId)`, `ERC721IncorrectOwner(sender, tokenId, owner)`, `ERC721InsufficientApproval(operator, tokenId)`, `ERC721InvalidApprover(approver)`, `ERC721InvalidOperator(operator)`, `ERC721InvalidOwner(owner)`, `ERC721InvalidReceiver(receiver)`, `ERC721InvalidSender(sender)` | Standard ERC-721 failures | Check ownership and approvals |
| `ERC2981InvalidDefaultRoyalty(numerator, denominator)`, `ERC2981InvalidDefaultRoyaltyReceiver(receiver)`, `ERC2981InvalidTokenRoyalty(tokenId, numerator, denominator)`, `ERC2981InvalidTokenRoyaltyReceiver(tokenId, receiver)` | Invalid royalty setup | Setup only |
| `ReentrancyGuardReentrantCall` | Re-entry into `premint` from a receiver callback | Do not premint from `onERC721Received` |

## Integrator patterns

- **Read levels from SqueekNFT.** Use `level(id)`, `nextMergeHeight(id)` and `cooldownBlocks(level)`; SqueekMining holds no per-Squeek state.
- **Check merge eligibility before sending.** Require `mergesOpen()`, equal `level` below `MAXIMUM_LEVEL`, and both `nextMergeHeight` values at or below SqueekCore `state().blockHeight`; heights are Squeek blocks, not Ethereum blocks.
- **Route deposited Squeeks through Staking.** `ownerOf` returns Staking for a deposited Squeek; merge it with `SqueekStaking.mergeDeposited`, not `merge`.
- **Read ownership live.** Read `ownerOf` when preparing any owner action; only the current owner can merge, whatever the approvals.
- **Gate rendering on reveal.** Before `revealState().revealed`, `tokenURI` is the same sealed placeholder for every ID; refresh on `BatchMetadataUpdate` or poll `revealState`.
- **Track issuance by events.** Index `GenesisPreminted` and `Transfer`; `totalIssued == MAX_SUPPLY` means the full inventory exists.
- **Index merges from `Merged`.** The donor's burn is a `Transfer` to the zero address in the same transaction; `totalSupply` falls and `totalIssued` does not.

## Reveal and metadata

`revealState()` decides the state live on every `tokenURI` call:

| State | Condition | `tokenURI` returns |
|---|---|---|
| Sealed | No launch configured, or the launch has not revealed | The same sealed JSON for every live ID: name `Squeek - Sealed`, description `Awaiting the canonical Genesis reveal.`, a plain placeholder SVG |
| Revealed | The launch's `revealState()` reports `revealed` with its `artSeed` | The renderer's metadata for the pinned Genesis page |

After reveal, the renderer seed is derived per collection rather than taken from the reveal:

```text
seed = keccak256(abi.encode(collectionSeed, artSeed))
tokenURI(id) = renderer.tokenURIForPinnedPage(art, artCodehash, seed, id)
```

The launch decides the reveal; on Sepolia the testnet minter reports a fixed test `artSeed`. `announceReveal` only emits refresh signals. To reproduce an image offchain, read `collectionSeed()` and `revealState()`, compute the seed above and call the [DotGrid renderer](dotgrid.md) with it.

## Usage example

Checks whether two Squeeks can merge now. Uses `setup.ts` and `verifyGraph()` from the [Quickstart](quickstart.md#verify-the-deployment), which takes the collection from `NFT_ADDRESS` and checks its `sqkCore()` is the verified SqueekCore proxy.

```ts
// merge-eligibility.ts
import { parseAbi } from "viem";
import { blockNumber, client, required } from "./setup";
import { verifyGraph } from "./verify";

const { core, nft } = await verifyGraph();
const nftAbi = parseAbi([
  "function mergesOpen() view returns (bool)",
  "function MAXIMUM_LEVEL() view returns (uint8)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function level(uint256 tokenId) view returns (uint8)",
  "function nextMergeHeight(uint256 tokenId) view returns (uint64)",
]);
const coreAbi = parseAbi([
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
]);
const survivor = BigInt(required("SURVIVOR_ID"));
const donor = BigInt(required("DONOR_ID"));
const read = { address: nft, abi: nftAbi, blockNumber } as const;
const [open, maximumLevel] = await Promise.all([
  client.readContract({ ...read, functionName: "mergesOpen" }),
  client.readContract({ ...read, functionName: "MAXIMUM_LEVEL" }),
]);
const { blockHeight } = await client.readContract({ address: core, abi: coreAbi, functionName: "state", blockNumber });
const token = async (id: bigint) => ({
  owner: await client.readContract({ ...read, functionName: "ownerOf", args: [id] }),
  level: await client.readContract({ ...read, functionName: "level", args: [id] }),
  nextMergeHeight: await client.readContract({ ...read, functionName: "nextMergeHeight", args: [id] }),
});
const [a, b] = await Promise.all([token(survivor), token(donor)]);
const eligible =
  open &&
  survivor !== donor &&
  a.owner === b.owner &&
  a.level === b.level &&
  a.level < maximumLevel &&
  a.nextMergeHeight <= blockHeight &&
  b.nextMergeHeight <= blockHeight;
console.log({ owner: a.owner, level: a.level, blockHeight, eligible });
```

If the owner is the Staking contract, the depositor merges through `SqueekStaking.mergeDeposited`.

## ABI

[`SqueekNFT.json`](https://docs.squeekchain.com/assets/abi/SqueekNFT.json) matches the Sepolia deployment. Call the contract at the address under [Deployments](overview.md#deployments); it has no proxy. Any ERC-721 ABI also works for ownership and transfers.

## Related pages

- [SqueekStaking](staking.md)
- [DotGrid renderer](dotgrid.md)
- [SqueekCore](core.md)
- [Index events](index-events.md)
