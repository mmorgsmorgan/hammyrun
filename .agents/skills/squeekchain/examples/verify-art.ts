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
