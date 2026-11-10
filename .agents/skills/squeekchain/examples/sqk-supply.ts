// sqk-supply.ts
import { formatUnits, getAddress, parseAbi } from "viem";
import { blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { token, mining } = await verifyGraph();
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function cap() view returns (uint256)",
  "function totalPreminted() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function mining() view returns (address)",
]);
const miningAbi = parseAbi([
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
]);
const read = { address: token, abi: tokenAbi, blockNumber } as const;
const [supply, cap, preminted, burned, minted, boundMining, state] = await Promise.all([
  client.readContract({ ...read, functionName: "totalSupply" }),
  client.readContract({ ...read, functionName: "cap" }),
  client.readContract({ ...read, functionName: "totalPreminted" }),
  client.readContract({ ...read, functionName: "totalBurned" }),
  client.readContract({ ...read, functionName: "totalMinted" }),
  client.readContract({ ...read, functionName: "mining" }),
  client.readContract({ address: mining, abi: miningAbi, functionName: "state", blockNumber }),
]);
if (getAddress(boundMining) !== mining) throw new Error("SqueekToken is not bound to this SqueekMining");
if (minted !== supply + burned) throw new Error("Lifetime issuance differs from supply plus burns");
if (minted !== preminted + state.minted) throw new Error("Issuance differs from premint plus SqueekMining");
console.log({
  liveSupplySQK: formatUnits(supply, 18),
  burnedSQK: formatUnits(burned, 18),
  remainingCapacitySQK: formatUnits(cap - minted, 18),
});
