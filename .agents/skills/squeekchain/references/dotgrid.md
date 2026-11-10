> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# DotGrid renderer

> The DotGrid renderer and validator function by function: how Squeek images and metadata are rendered and verified onchain, with errors, limits and ABIs.

Web version: https://docs.squeekchain.com/developers/dotgrid/

## TL;DR

- Turns a DotGrid page, a seed and a token ID into SVG and JSON metadata. After the collection's reveal, SqueekNFT `tokenURI` supplies `keccak256(abi.encode(collectionSeed, artSeed))` as the seed.
- Rendering is deterministic and read-only: ownership, level and rewards never change an image.
- Verify the renderer, validator and page identities before using rendered output.

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

The renderer derives each token's traits and image from a DotGrid page, the collection seed and the token ID. The page is a 44-byte header and ten ordered sections, stored as contract code in a page root and its chunks. The page validator checks a page's full structure. Neither holds state or emits events.

The Sepolia SqueekNFT runs both; their addresses and runtime hashes are under [Deployments](overview.md#deployments). Confirm them onchain from SqueekNFT's `renderer()` and the renderer's `pageValidator()` at the block you verify.

## Functions

### Views

#### `tokenURI`

```solidity
function tokenURI(address page, bytes32 seed, uint256 tokenId) external view returns (string);
```

Reads and fully validates `page`, then returns base64 JSON metadata with an embedded SVG for `tokenId`.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `page` | `address` | — | Page root address |
| `seed` | `bytes32` | — | Nonzero seed; for Squeeks after reveal, `keccak256(abi.encode(collectionSeed, artSeed))` from SqueekNFT `collectionSeed()` and `revealState()` |
| `tokenId` | `uint256` | token ID | `1..2^192−1`; the renderer does not check that the NFT exists |

Reverts with `DotGridInvalid(code)` for any page or input failure.

#### `tokenURIForPinnedPage`

```solidity
function tokenURIForPinnedPage(address page, bytes32 codehash, bytes32 seed, uint256 tokenId) external view returns (string);
```

Returns the same metadata as `tokenURI`, but skips full validation when the page root's runtime hash equals `codehash`; SqueekNFT uses it after validating the page at construction. A codehash establishes no trust on its own, so validate that exact root first. Reverts with `DotGridInvalid(132)` on a mismatch.

#### `renderSVG`

```solidity
function renderSVG(address page, bytes32 seed, uint256 tokenId) external view returns (string);
function renderSVGForPinnedPage(address page, bytes32 codehash, bytes32 seed, uint256 tokenId) external view returns (string);
```

The SVG alone, strict or pinned.

#### `traitWord`

```solidity
function traitWord(address page, bytes32 seed, uint256 tokenId) external view returns (uint256);
function resolvedFieldHash(address page, bytes32 seed, uint256 tokenId) external view returns (bytes32);
```

The packed deterministic trait choices, and a commitment to the resolved emitter field. Both also appear in the metadata.

#### `validatePage`

```solidity
function validatePage(address page) external view returns (bytes32 pageHash, bytes32 assetSetHash);
```

Strict read plus full validation. Returns the logical page hash and the asset-set hash, which SqueekNFT stores as `sceneHash()` and `assetSetHash()`.

#### Identity

```solidity
function rendererId() external pure returns (bytes32);
function rendererVersion() external pure returns (string);
function pageValidator() external view returns (address);
```

`rendererId()` is `keccak256("sqk.dotgrid-renderer.v1")` and `rendererVersion()` is `sqk.dotgrid-renderer.v1`. `pageValidator()` is the validator the renderer created; its code is not covered by the renderer's runtime hash, so pin it separately.

#### `validate`

```solidity
function validate(bytes page) external pure returns (Layout layout);
```

On the page validator: validates raw logical page bytes and returns the section directory. Most integrators call the renderer's `validatePage` instead.

### Metadata fields

| Field | Meaning |
|---|---|
| `name`, `description` | Page-defined text with a token-specific title |
| `image` | `data:image/svg+xml;base64,` embedded SVG |
| `attributes` | Deterministically selected trait names and values |
| `properties.renderer`, `rendererId` | Renderer version and identity |
| `properties.pageHash`, `assetSetHash` | Logical page and renderer-bound asset identity |
| `properties.traitWord`, `resolvedFieldHash` | Derivation and resolved-field evidence |
| `properties.emitters` | Active emitter count in the resolved result |

The asset-set hash binds page and renderer: `keccak256(ASSET_SET_DOMAIN || RENDERER_ID || pageHash)`, with domain `keccak256("sqk.dotgrid-asset-set.v1")`. It differs from the root codehash and the page hash.

## Events

The renderer and validator emit no events. SqueekNFT's `BatchMetadataUpdate`, emitted by `announceReveal`, announces when readers should refresh metadata.

## Errors

| Error | Cause | Fix |
|---|---|---|
| `DotGridInvalid(code)` | A page, input or budget check failed; `code` identifies which | See the code families below |

| Code | Meaning |
|---|---|
| 1–5 | Page size, magic, format, header or directory |
| 10–14 | Strings, categories, options or section trailing bytes |
| 20–26 | Derivation counts, seeds, tags, weights or trait capacity |
| 30–31 | Palettes |
| 40–44 | Glyph count, flags, path length or characters, trailing bytes |
| 50–53 | Optics, passes or opacity |
| 60–64 | Emitter field records, positions, reserved bits or glyph references |
| 70–73 | Arrays, bit width or padding |
| 80–86 | Sets, kinds, padding, ordinals or duplicates |
| 90–97 | Lookup tables, tables, update modes or arguments, trailing bytes |
| 100–107 | Program order, length, opcodes, references, arguments, key terms or ranges |
| 110–112 | Resolve-cost, SVG or URI budget |
| 120–121 | Segment structure or creation; chunk hash mismatch |
| 130 | Token ID outside `1..2^192−1` |
| 131 | Zero collection seed |
| 132 | Pinned root codehash mismatch |

Not every integer in a range is assigned. Token input checks run before any page read.

## Integrator patterns

- **Render through SqueekNFT.** Call `SqueekNFT.tokenURI(id)`: it checks the NFT exists, returns sealed placeholder metadata until the canonical reveal, and then renders the pinned page with the derived seed. A direct renderer call accepts any ID without checking issuance or ownership. See [Reveal and metadata](nft.md#reveal-and-metadata).
- **Verify identities once, then cache.** Rendering is deterministic for a given page, seed and ID; re-verify only after `BatchMetadataUpdate`. Before reveal there is no rendering seed.
- **Compare keccak256, not file digests.** Code and page hashes are keccak256; do not compare them with SHA-256 digests or a hosted raster image.
- **Expect RPC limits.** Rendering can exceed an RPC's `eth_call` gas or response limits even within DotGrid's own resolve-cost budget.
- **Isolate SVG output.** Display the SVG as an image, never as inline markup.

## Verifying identities

Read every value at one Ethereum block and compare it with the deployment record. A matching hash confirms that the onchain bytes match that record.

1. Read SqueekNFT `renderer()`, `art()`, `artCodehash()`, `sceneHash()`, `assetSetHash()` and `collectionSeed()`. `art` is the page root address.
2. Compare `keccak256` of the renderer's runtime code with the expected hash, and `rendererId()` with `keccak256("sqk.dotgrid-renderer.v1")`.
3. Read the renderer's `pageValidator()` and compare its runtime hash separately.
4. Compare the root's runtime hash with `artCodehash()`; the root commits to its chunk hashes.
5. Call the renderer's `validatePage(art)` and require it to return `sceneHash()` and `assetSetHash()`.
6. Require a nonzero collection seed and SqueekNFT `revealState()` to report `revealed`, then render an existing ID through SqueekNFT. Its seed is `keccak256(abi.encode(collectionSeed, artSeed))`.

| Identity | What it proves |
|---|---|
| Renderer runtime hash | Exact rendering code |
| Validator runtime hash | Exact page-validation code |
| Root codehash | Root code, including its chunk hashes |
| Page hash (`sceneHash`) | Logical page bytes |
| Asset-set hash | Renderer identity and page together |
| Collection seed, reveal `artSeed` and token ID | The inputs that reproduce the same traits and image |

## Limits

| Resource | Maximum or requirement |
|---|---|
| Token ID | `1..2^192−1` |
| Seed | Nonzero `bytes32` |
| Page format | Magic `0x44475047`, format 1 |
| Logical page / chunks | 49,152 bytes / 3 chunks |
| Runtime | 24,576 bytes per contract |
| Canvas / coordinates | 4,096 pixels / 64 units per pixel |
| Emitters | 2,048 |
| Trait categories / options | 16 / 64 |
| Palettes / glyphs / glyph path | 64 / 64 / 1,024 bytes |
| Optics / passes | 16 / 4 |
| Arrays / sets / lookup tables / tables | 8 / 64 / 64 / 1,024 |
| Resolve cost | 6,000,000 under the format's cost accounting |
| SVG / JSON / URI output | 131,072 / 196,608 / 262,144 bytes |

The Genesis DotGrid page holds 25,800 logical bytes in one chunk.

## Usage example

Check the renderer, validator and page identities that SqueekNFT pinned.

```ts
// verify-art.ts
import { getAddress, keccak256, parseAbi, toBytes } from "viem";
import { blockNumber, client, required } from "./setup";

const nft = getAddress(required("NFT_ADDRESS"));
const nftAbi = parseAbi([
  "function renderer() view returns (address)",
  "function art() view returns (address)",
  "function artCodehash() view returns (bytes32)",
  "function sceneHash() view returns (bytes32)",
  "function assetSetHash() view returns (bytes32)",
  "function collectionSeed() view returns (bytes32)",
]);
const rendererAbi = parseAbi([
  "function rendererId() pure returns (bytes32)",
  "function pageValidator() view returns (address)",
  "function validatePage(address page) view returns (bytes32 pageHash, bytes32 assetSetHash)",
]);
const read = { address: nft, abi: nftAbi, blockNumber } as const;
const [renderer, art, artCodehash, sceneHash, assetSetHash, seed] = await Promise.all([
  client.readContract({ ...read, functionName: "renderer" }),
  client.readContract({ ...read, functionName: "art" }),
  client.readContract({ ...read, functionName: "artCodehash" }),
  client.readContract({ ...read, functionName: "sceneHash" }),
  client.readContract({ ...read, functionName: "assetSetHash" }),
  client.readContract({ ...read, functionName: "collectionSeed" }),
]);
const rendered = { address: renderer, abi: rendererAbi, blockNumber } as const;
const [rendererId, validator, [pageHash, assetSet]] = await Promise.all([
  client.readContract({ ...rendered, functionName: "rendererId" }),
  client.readContract({ ...rendered, functionName: "pageValidator" }),
  client.readContract({ ...rendered, functionName: "validatePage", args: [art] }),
]);
const codeHash = async (address: `0x${string}`) => keccak256((await client.getCode({ address, blockNumber })) ?? "0x");
const checks = {
  rendererId: rendererId === keccak256(toBytes("sqk.dotgrid-renderer.v1")),
  rootCode: (await codeHash(art)) === artCodehash,
  pageHash: pageHash === sceneHash,
  assetSet: assetSet === assetSetHash,
  seed: BigInt(seed) !== 0n,
};
if (Object.values(checks).includes(false)) throw new Error(`Art identity mismatch: ${JSON.stringify(checks)}`);
console.log({ renderer, rendererCode: await codeHash(renderer), validator, validatorCode: await codeHash(validator), art, pageHash });
```

Compare the printed code hashes with the runtime hashes under [Deployments](overview.md#deployments). SqueekNFT's constructor required the renderer and validator runtime hashes to match its generated constants, so a mismatch means you're reading a different collection. To decode a Squeek's metadata, see the [SqueekNFT usage example](nft.md#usage-example).

## ABI

[`DotGridRenderer.json`](https://docs.squeekchain.com/assets/abi/DotGridRenderer.json) and [`DotGridPageValidator.json`](https://docs.squeekchain.com/assets/abi/DotGridPageValidator.json) match the Sepolia deployment. Call the renderer at the address SqueekNFT's `renderer()` returns, and the validator at the renderer's `pageValidator()`.

## Related pages

- [SqueekNFT](nft.md)
- [Getting a Squeek](https://docs.squeekchain.com/squeeks/minting.md)
