// verify.ts
import { getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import { blockNumber, client, required } from "./setup";

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const abi = parseAbi([
  "function implementationCodeAddress() view returns (address)",
  "function implementationStorageLayoutDigest() view returns (bytes32)",
  "function owner() view returns (address)",
  "function deploymentIdentity() view returns (address implementation, address admin)",
  "function sqkCore() view returns (address)",
  "function governance() view returns (address)",
  "function core() view returns (address)",
  "function mining() view returns (address)",
  "function token() view returns (address)",
  "function genesis() view returns (address)",
  "function miningBindingAuthority() view returns (address)",
  "function cap() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function totalPreminted() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function bindings() view returns ((address core, address token, address staking, address governance, bytes32 streamId, uint64 genesisTimestamp, uint64 minimumTimelockDelay, uint64 maxWorkPerRound, uint32 initialWorkPerThousandBlocks, uint128 premint))",
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
  "function rewardState() view returns ((uint256 funded, uint256 paid, uint256 compounded, uint256 rewardIndex, uint256 remaining, uint128 totalNftPower, uint128 totalSqkPower, uint256 streamRate, uint64 lastAccruedAt, uint64 streamEndsAt))",
]);
const at = (address: Address) => ({ address, abi, blockNumber }) as const;
const slotAddress = (word: Hex | undefined) => getAddress(`0x${(word ?? "0x").slice(-40)}`);
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function fail(message: string): never {
  throw new Error(`Contracts are not connected as one graph: ${message}`);
}

// Reads NAME_ADDRESS and EXPECTED_NAME_{IMPLEMENTATION,RUNTIME_HASH,PROXY_ADMIN,LAYOUT_DIGEST}.
async function verifyProxy(name: string, guarded: boolean): Promise<Address> {
  const proxy = getAddress(required(`${name}_ADDRESS`));
  const implementation = slotAddress(
    await client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT, blockNumber }),
  );
  const admin = slotAddress(await client.getStorageAt({ address: proxy, slot: ADMIN_SLOT, blockNumber }));
  const code = await client.getCode({ address: implementation, blockNumber });
  const [adminOwner, reported, layout] = await Promise.all([
    client.readContract({ ...at(admin), functionName: "owner" }),
    client.readContract({ ...at(proxy), functionName: "implementationCodeAddress" }),
    client.readContract({ ...at(proxy), functionName: "implementationStorageLayoutDigest" }),
  ]);
  if (
    !same(implementation, required(`EXPECTED_${name}_IMPLEMENTATION`)) ||
    !same(reported, implementation) ||
    !code || !same(keccak256(code), required(`EXPECTED_${name}_RUNTIME_HASH`)) ||
    !same(admin, required(`EXPECTED_${name}_PROXY_ADMIN`)) ||
    !same(layout, required(`EXPECTED_${name}_LAYOUT_DIGEST`)) ||
    !same(adminOwner, required("EXPECTED_TIMELOCK"))
  ) throw new Error(`${name}: deployment does not match the approved record`);
  if (guarded) {
    const [identityImplementation, identityAdmin] = await client.readContract({ ...at(proxy), functionName: "deploymentIdentity" });
    if (!same(identityImplementation, implementation) || !same(identityAdmin, admin)) {
      throw new Error(`${name}: deploymentIdentity() differs from the proxy slots`);
    }
  }
  return proxy;
}

export async function verifyGraph() {
  const timelock = getAddress(required("EXPECTED_TIMELOCK"));
  const core = await verifyProxy("CORE", false);
  const mining = await verifyProxy("MINING", true);
  const staking = await verifyProxy("STAKING", true);
  const token = getAddress(required("SQK_ADDRESS"));
  const nft = getAddress(required("NFT_ADDRESS"));

  const [nftCore, nftGovernance, authority, tokenMining, cap, supply, minted, preminted, burned] = await Promise.all([
    client.readContract({ ...at(nft), functionName: "sqkCore" }),
    client.readContract({ ...at(nft), functionName: "governance" }),
    client.readContract({ ...at(token), functionName: "miningBindingAuthority" }),
    client.readContract({ ...at(token), functionName: "mining" }),
    client.readContract({ ...at(token), functionName: "cap" }),
    client.readContract({ ...at(token), functionName: "totalSupply" }),
    client.readContract({ ...at(token), functionName: "totalMinted" }),
    client.readContract({ ...at(token), functionName: "totalPreminted" }),
    client.readContract({ ...at(token), functionName: "totalBurned" }),
  ]);
  if (!same(nftCore, core) || !same(nftGovernance, timelock)) fail("SqueekNFT bindings");
  if (!same(authority, timelock) || !same(tokenMining, mining)) fail("SqueekToken bindings");
  if (minted !== supply + burned || minted > cap) fail("SqueekToken supply totals");

  const [bindings, state] = await Promise.all([
    client.readContract({ ...at(mining), functionName: "bindings" }),
    client.readContract({ ...at(mining), functionName: "state" }),
  ]);
  if (!same(bindings.core, core) || !same(bindings.token, token) || !same(bindings.staking, staking) ||
    !same(bindings.governance, timelock) || bindings.premint !== preminted) fail("SqueekMining bindings");
  if (!state.bootstrapped || !state.active) fail("SqueekMining is not bootstrapped and active");
  if (minted !== preminted + state.minted) fail("SqueekToken.totalMinted() is not premint plus Mining issuance");

  const [stakingMining, stakingToken, stakingCore, stakingGovernance, genesis, rewards] = await Promise.all([
    client.readContract({ ...at(staking), functionName: "mining" }),
    client.readContract({ ...at(staking), functionName: "token" }),
    client.readContract({ ...at(staking), functionName: "core" }),
    client.readContract({ ...at(staking), functionName: "governance" }),
    client.readContract({ ...at(staking), functionName: "genesis" }),
    client.readContract({ ...at(staking), functionName: "rewardState" }),
  ]);
  if (!same(stakingMining, mining) || !same(stakingToken, token) || !same(stakingCore, core) ||
    !same(stakingGovernance, timelock) || !same(genesis, nft)) fail("SqueekStaking bindings");
  if (rewards.funded !== state.minted) fail("SqueekStaking funding differs from SqueekMining issuance");
  return { core, nft, token, mining, staking };
}
