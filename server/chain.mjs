import fs from "node:fs";
import {
  createPublicClient,
  http,
  fallback,
  keccak256,
  parseAbi,
  encodeFunctionData,
  parseUnits,
  zeroAddress,
} from "viem";
import { sepolia } from "viem/chains";
export const record = JSON.parse(
  fs.readFileSync(".agents/skills/squeekchain/references/sepolia.json", "utf8"),
);
export const ABIS = Object.fromEntries(
  [
    "SqueekCore",
    "SqueekToken",
    "SqueekNFT",
    "SqueekMining",
    "SqueekStaking",
  ].map((n) => [
    n,
    JSON.parse(
      fs.readFileSync(
        `.agents/skills/squeekchain/references/abi/${n}.json`,
        "utf8",
      ),
    ),
  ]),
);
export const client = createPublicClient({
  chain: sepolia,
  cacheTime: 0,
  transport: process.env.RPC_URL
    ? http(process.env.RPC_URL, { timeout: 15000, batch: true })
    : fallback([
        http("https://ethereum-sepolia-rpc.publicnode.com", {
          timeout: 12000,
          batch: true,
          retryCount: 0,
        }),
        http("https://sepolia.drpc.org", {
          timeout: 12000,
          batch: true,
          retryCount: 0,
        }),
      ]),
});
export const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const extra = parseAbi([
  "function owner() view returns (address)",
  "function implementationCodeAddress() view returns (address)",
  "function implementationStorageLayoutDigest() view returns (bytes32)",
  "function deploymentIdentity() view returns (address implementation,address admin)",
]);
export const addr = (n) => record.contracts[n].address;
export const read = (n, functionName, args = [], blockNumber) =>
  client.readContract({
    address: addr(n),
    abi: ABIS[n],
    functionName,
    args,
    blockNumber,
  });
let docsCheck = 0;
export async function verifyGraph(blockNumber) {
  if (Date.now() - docsCheck > 60000) {
    const response = await fetch(
      "https://docs.squeekchain.com/assets/deployments/sepolia.json",
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok)
      throw new Error("Squeekchain deployment documentation is unavailable.");
    const live = await response.json();
    if (JSON.stringify(live) !== JSON.stringify(record))
      throw new Error(
        "Squeekchain deployment record changed. Update the integration before transacting.",
      );
    docsCheck = Date.now();
  }
  if ((await client.getChainId()) !== record.chainId)
    throw new Error("Sepolia chain mismatch.");
  const block = await client.getBlock({ blockNumber });
  const timelock = record.operational.governanceTimelock.address;
  await Promise.all(
    ["SqueekCore", "SqueekMining", "SqueekStaking"].map(async (n) => {
      const c = record.contracts[n];
      const [iw, aw] = await Promise.all([
        client.getStorageAt({
          address: c.address,
          slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
          blockNumber,
        }),
        client.getStorageAt({
          address: c.address,
          slot: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
          blockNumber,
        }),
      ]);
      const implementation = "0x" + iw?.slice(-40),
        admin = "0x" + aw?.slice(-40);
      if (!same(implementation, c.implementation) || !same(admin, c.proxyAdmin))
        throw new Error(n + ": proxy identity mismatch.");
      const at = { abi: extra, blockNumber };
      const [code, owner, reported, layout] = await Promise.all([
        client.getCode({ address: implementation, blockNumber }),
        client.readContract({ ...at, address: admin, functionName: "owner" }),
        client.readContract({
          ...at,
          address: c.address,
          functionName: "implementationCodeAddress",
        }),
        client.readContract({
          ...at,
          address: c.address,
          functionName: "implementationStorageLayoutDigest",
        }),
      ]);
      if (
        !code ||
        !same(keccak256(code), c.implementationRuntimeHash) ||
        !same(owner, timelock) ||
        !same(reported, implementation) ||
        !same(layout, c.storageLayoutDigest)
      )
        throw new Error(
          n + ": deployment identity does not match published record.",
        );
      if (n !== "SqueekCore") {
        const [i, a] = await client.readContract({
          ...at,
          address: c.address,
          functionName: "deploymentIdentity",
        });
        if (!same(i, implementation) || !same(a, admin))
          throw new Error(n + ": guarded identity mismatch.");
      }
    }),
  );
  await Promise.all(
    ["SqueekToken", "SqueekNFT"].map(async (n) => {
      const code = await client.getCode({ address: addr(n), blockNumber });
      if (!code || !same(keccak256(code), record.contracts[n].runtimeHash))
        throw new Error(n + ": runtime mismatch.");
    }),
  );
  const r = (n, f, args = []) => read(n, f, args, blockNumber);
  const [
    nftCore,
    nftGov,
    auth,
    mining,
    cap,
    supply,
    minted,
    preminted,
    burned,
    b,
    state,
    sm,
    st,
    sc,
    sg,
    genesis,
    rewards,
  ] = await Promise.all([
    r("SqueekNFT", "sqkCore"),
    r("SqueekNFT", "governance"),
    r("SqueekToken", "miningBindingAuthority"),
    r("SqueekToken", "mining"),
    r("SqueekToken", "cap"),
    r("SqueekToken", "totalSupply"),
    r("SqueekToken", "totalMinted"),
    r("SqueekToken", "totalPreminted"),
    r("SqueekToken", "totalBurned"),
    r("SqueekMining", "bindings"),
    r("SqueekMining", "state"),
    r("SqueekStaking", "mining"),
    r("SqueekStaking", "token"),
    r("SqueekStaking", "core"),
    r("SqueekStaking", "governance"),
    r("SqueekStaking", "genesis"),
    r("SqueekStaking", "rewardState"),
  ]);
  const checks = [
    [nftCore, addr("SqueekCore")],
    [nftGov, timelock],
    [auth, timelock],
    [mining, addr("SqueekMining")],
    [b.core, addr("SqueekCore")],
    [b.token, addr("SqueekToken")],
    [b.staking, addr("SqueekStaking")],
    [b.governance, timelock],
    [sm, addr("SqueekMining")],
    [st, addr("SqueekToken")],
    [sc, addr("SqueekCore")],
    [sg, timelock],
    [genesis, addr("SqueekNFT")],
  ];
  if (
    checks.some(([a, b]) => !same(a, b)) ||
    b.premint !== preminted ||
    minted !== supply + burned ||
    minted > cap ||
    minted !== preminted + state.minted ||
    rewards.funded !== state.minted ||
    !state.bootstrapped ||
    !state.active
  )
    throw new Error(
      "Squeekchain graph bindings or supply reconciliation failed.",
    );
  await assertBlock(block);
  return block;
}
export async function assertBlock(block) {
  if (
    (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
  )
    throw new Error(
      "Chain reorganized during reads. Refresh before continuing.",
    );
}
export async function squeekSnapshot(account) {
  const blockNumber = (await client.getBlockNumber()) - 12n,
    block = await verifyGraph(blockNumber);
  const [balance, stake, claimable, power, recipient, core] = await Promise.all(
    [
      read("SqueekToken", "balanceOf", [account], blockNumber),
      read("SqueekStaking", "stakeOf", [account], blockNumber),
      read("SqueekStaking", "claimable", [account], blockNumber),
      read("SqueekStaking", "accountPower", [account], blockNumber),
      read("SqueekStaking", "claimRecipient", [account], blockNumber),
      read("SqueekCore", "state", [], blockNumber),
    ],
  );
  await assertBlock(block);
  return {
    verified: true,
    blockNumber,
    blockHash: block.hash,
    balance,
    principal: stake[0],
    freshPrincipal: stake[1],
    claimable,
    power,
    recipient,
    height: core.cumulativeBlockUnits / 1000000000n,
  };
}
export async function prepareSqueek(account, action, amountText) {
  const blockNumber = await client.getBlockNumber(),
    block = await verifyGraph(blockNumber);
  let n = "SqueekStaking",
    functionName = action,
    args = [],
    details = {};
  const staking = addr(n);
  if (["stake", "unstake"].includes(action)) {
    if (
      typeof amountText !== "string" ||
      !/^\d+(\.\d{1,18})?$/.test(amountText)
    )
      throw new Error("Enter a positive SQK amount with at most 18 decimals.");
    const amount = parseUnits(amountText, 18);
    if (amount <= 0n) throw new Error("Amount must be positive.");
    if (action === "stake") {
      const [balance, allowance, paused] = await Promise.all([
        read("SqueekToken", "balanceOf", [account], blockNumber),
        read("SqueekToken", "allowance", [account, staking], blockNumber),
        read(n, "paused", [], blockNumber),
      ]);
      if (paused) throw new Error("Squeekchain staking intake is paused.");
      if (balance < amount)
        throw new Error("Your wallet does not hold that much SQK.");
      if (allowance < amount) {
        n = "SqueekToken";
        functionName = "approve";
        args = [staking, amount];
        details = {
          approval: true,
          amount,
          spender: staking,
          message: "Approve exactly this SQK amount, then return to stake.",
        };
      } else {
        args = [amount];
        details = { amount };
      }
    } else {
      const [fee, net] = await read(
        n,
        "quoteUnstake",
        [account, amount],
        blockNumber,
      );
      args = [amount, fee, block.timestamp + 300n];
      details = { amount, burnedFee: fee, net, deadline: args[2] };
    }
  } else if (action === "claim" || action === "claimAndStake") {
    const recipient = await read(n, "claimRecipient", [account], blockNumber);
    if (!same(recipient, account) && !same(recipient, zeroAddress))
      throw new Error(
        `Only the configured claim recipient ${recipient} may claim these rewards.`,
      );
    const payout = await read(n, "claimable", [account], blockNumber);
    if (payout === 0n)
      throw new Error("No SQK rewards are currently claimable.");
    args = action === "claim" ? [account] : [];
    details = { payout, recipient: account };
  } else throw new Error("Unsupported Squeekchain action.");
  const simulation = await client.simulateContract({
    address: addr(n),
    abi: ABIS[n],
    functionName,
    args,
    account,
    blockNumber,
  });
  await assertBlock(block);
  return {
    to: addr(n),
    data: encodeFunctionData({ abi: ABIS[n], functionName, args }),
    value: "0x0",
    chainId: record.chainId,
    from: account,
    action: functionName,
    details,
    result: simulation.result ?? null,
    blockNumber,
    blockHash: block.hash,
    preparedAt: Date.now(),
  };
}
