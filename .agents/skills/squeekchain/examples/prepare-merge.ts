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
