> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# Quickstart

> Verify the Squeekchain contracts deployed on Sepolia at one Ethereum block, then read SqueekCore's settled work in TypeScript.

Web version: https://docs.squeekchain.com/developers/quickstart/

## TL;DR

- `setup.ts` connects at one Ethereum block, `verify.ts` checks the Sepolia deployment's identities and bindings, and `read-core.ts` reads SqueekCore.
- Every other example on this site imports `setup.ts`, so start here.
- Everything is read-only; nothing is signed or sent.

## Before you start

You need three inputs:

| Input | Where it comes from |
|---|---|
| RPC endpoint with historical state | Your node or provider; it must serve reads at a past block |
| Chain ID and Ethereum block | Your confirmation policy; read everything at this one block |
| Addresses and identities | The `sepolia-env.sh` block under [Environment file](overview.md#environment-file): contract addresses, plus each proxy's implementation address, runtime hash, layout digest and proxy admin |

They describe release `core-sepolia-20261103` on the Sepolia testnet, for testing only; the published ABIs are the ABIs of these contracts.

The examples are TypeScript ES modules using viem 2, and each imports this shared setup:

```ts
// setup.ts
import { createPublicClient, http } from "viem";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Supply ${name}`);
  return value;
};
export const client = createPublicClient({ transport: http(required("RPC_URL")) });
if (BigInt(await client.getChainId()) !== BigInt(required("EXPECTED_CHAIN_ID"))) {
  throw new Error("Chain mismatch");
}
export const blockNumber = BigInt(required("ETHEREUM_BLOCK"));
export const block = await client.getBlock({ blockNumber });
```

Load the values with `set -a; . ./sepolia-env.sh; set +a`, then set `RPC_URL` to a Sepolia endpoint that serves historical state and `ETHEREUM_BLOCK` to a confirmed block. Run each file with `bun <file>` or `npx tsx <file>`.

## Steps

### Verify the deployment

At the selected block, `verifyGraph()` checks the chain, the SqueekCore, SqueekMining and SqueekStaking proxy identities and their ProxyAdmins, the bindings listed below, and the supply totals, then returns the contract addresses. Every other contract-reading example calls it first.

1. Read each proxy's EIP-1967 implementation and admin slots, and compare the implementation address, the keccak256 of its runtime code, the proxy admin and the storage-layout digest with `sepolia-env.sh`.
2. Check that each proxy admin is owned by the [admin Timelock](admin.md).
3. SqueekMining and SqueekStaking answer `deploymentIdentity()` from the proxy itself; check that it names the same implementation and admin as the slots.
4. Check these bindings: SqueekNFT `sqkCore()` and `governance()` (the admin Timelock); SqueekToken `miningBindingAuthority()` and `mining()`; SqueekMining `bindings()` `core`, `token`, `staking` and `governance`, with `premint == totalPreminted()`; and SqueekStaking `mining()`, `token()`, `core()`, `governance()` and `genesis()`. Also require SqueekMining `state()` to have `bootstrapped` and `active` both true, so Mining has started.
5. Reconcile supply: require `totalMinted() == totalSupply() + totalBurned()`, `totalMinted() <= cap()` and `totalMinted() == totalPreminted() + SqueekMining.state().minted`, and require `SqueekStaking.rewardState().funded == SqueekMining.state().minted`. Stop on any mismatch.

```ts
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
```

The snippet checks only the chain, the three proxies' implementation addresses, runtime hashes, storage layouts and ProxyAdmins, the bindings listed above, Mining's start and the supply totals. Other bindings, launch values and operational settings need separate checks, and a match doesn't authorize writes.

### Read SqueekCore state

1. Read `configuration()` and `state()` at the selected block.
2. Check that `blockHeight` and `blockProgress` equal `cumulativeBlockUnits` divided by and modulo `blockUnitsPerBlock`.
3. For history, read `roundPage` and advance your cursor to the returned `certifiedThroughRound`, not the requested end.
4. Use `blockInfo(b)` for the completion round and work threshold of completed block `b`.

```ts
// read-core.ts
import { parseAbi } from "viem";
import { block, blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { core } = await verifyGraph();
const abi = parseAbi([
  "function configuration() view returns ((bytes32 streamId, uint64 genesisTimestamp, uint64 roundDuration, uint64 maxWorkPerRound, uint16 maxRoundsPerBatch, address guardian, address reporter, uint32 initialWorkPerThousandBlocks, uint64 targetBlocksPerActiveRound, uint64 difficultySmoothingRounds, uint96 blockUnitsPerBlock))",
  "function state() view returns ((uint64 settledThroughRound, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint64 blockHeight, uint96 blockProgress, uint32 workPerThousandBlocks, uint256 authorizationNonce, bool paused))",
  "function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns ((uint64 certifiedThroughRound, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, (uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, (uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))",
]);
const read = { address: core, abi, blockNumber } as const;
const config = await client.readContract({ ...read, functionName: "configuration" });
const state = await client.readContract({ ...read, functionName: "state" });
const units = config.blockUnitsPerBlock;
if (state.blockHeight !== state.cumulativeBlockUnits / units || state.blockProgress !== state.cumulativeBlockUnits % units) {
  throw new Error("Inconsistent block units");
}
const frontier = state.settledThroughRound;
const point = await client.readContract({ ...read, functionName: "roundPage", args: [frontier, frontier, 0n] });
if (
  point.certifiedThroughRound !== frontier ||
  point.end.cumulativeBlockUnits !== state.cumulativeBlockUnits ||
  point.end.workPerThousandBlocks !== state.workPerThousandBlocks
) throw new Error("Inconsistent frontier endpoint");
const currentRound = block.timestamp < config.genesisTimestamp
  ? 0n
  : (block.timestamp - config.genesisTimestamp) / config.roundDuration + 1n;
console.log({ blockNumber, blockHash: block.hash, currentRound, frontier, height: state.blockHeight, state });
```

## Expected result

`read-core.ts` prints the Ethereum block and hash, the current round by wall clock, the certified frontier (`settledThroughRound`), the completed Squeek block height, and the full `state()` tuple. Field meanings are in [SqueekCore views](core.md#views).

The frontier can trail the current round because closed rounds are verified and settled in batches.

`verifyGraph()` returns the addresses it checked: `core`, `nft`, `token`, `mining` and `staking`.

## Common failures

| Failure | Cause | Fix |
|---|---|---|
| `Chain mismatch` | `RPC_URL` points at another network | Use a Sepolia endpoint |
| `deployment does not match the approved record` | Wrong address, an upgrade since the record, or a stale `sepolia-env.sh` | Compare with [Deployments](overview.md#deployments); stop if the record is current |
| `deploymentIdentity() differs from the proxy slots` | The proxy is not the guarded SqueekMining or SqueekStaking proxy | Use the proxy addresses from [Deployments](overview.md#deployments) |
| `Contracts are not connected as one graph: …` | A binding names another contract, the supply totals do not reconcile, or addresses come from different deployments | Use one deployment's addresses; stop if they still differ |
| Historical read fails | The endpoint does not serve state at `ETHEREUM_BLOCK` | Use an archive-capable endpoint or a recent block |
| Wrong tuple fields or decode error | An ABI fragment that differs from the published ABI, for example `workPerBlock`, `currentWork` or `currentRound()`, which SqueekCore doesn't have | Copy fragments from the published ABIs, for example the [SqueekCore ABI](core.md#abi) |
| Block count is off | Dividing physical work by difficulty | Use `cumulativeBlockUnits / blockUnitsPerBlock` |
| `roundPage` reverts | Round is past the certified frontier | Read at most `settledThroughRound` |
| Precision loss | Converting `uint64` or wider values to `number` | Keep `bigint`; viem returns `number` only for `uint48` and narrower |

## Verify the result

Record the chain ID, proxy and implementation identities, the ABI you decoded with, and the Ethereum block number and hash with every result. Fetch the block again after your reads; a changed hash means a reorganization happened mid-read.

Next: read issuance with the [SqueekMining usage example](mining.md#usage-example), read an account with the [SqueekStaking usage example](staking.md#usage-example), or prepare owner transactions in [Build owner actions](owner-actions.md).

## Related pages

- [Developers](overview.md)
- [SqueekCore](core.md)
- [SqueekMining](mining.md)
- [SqueekStaking](staking.md)
- [Build owner actions](owner-actions.md)
