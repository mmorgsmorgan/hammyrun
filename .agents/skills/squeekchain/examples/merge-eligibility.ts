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
