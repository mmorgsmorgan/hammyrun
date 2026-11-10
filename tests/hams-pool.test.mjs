import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  encodeDeployData,
  decodeFunctionData,
  keccak256,
} from "viem";
import { sepolia } from "viem/chains";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
const game = JSON.parse(
  fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
);
const pool = JSON.parse(
  fs.readFileSync("src/generated/HamsStakingPool.json", "utf8"),
);
const wad = parseEther;

test(
  "HAMS pool: funded rewards, withdrawable principal, exact approvals and verified registration",
  { timeout: 90000 },
  async (t) => {
    const rpc = "http://127.0.0.1:9548",
      base = "http://127.0.0.1:4314";
    const anvil = spawn(
      process.env.ANVIL_BIN || "/home/chief/.foundry/bin/anvil",
      ["--silent", "--port", "9548", "--chain-id", "11155111"],
      { stdio: "ignore" },
    );
    t.after(() => anvil.kill());
    const pc = createPublicClient({
      chain: sepolia,
      transport: http(rpc),
      cacheTime: 0,
      pollingInterval: 20,
    });
    let accounts;
    for (let i = 0; i < 40; i++) {
      try {
        accounts = await pc.request({ method: "eth_accounts" });
        break;
      } catch {
        await wait(100);
      }
    }
    assert.ok(accounts?.length);
    const [owner, alice, bob] = accounts;
    const wallet = (account) =>
      createWalletClient({ account, chain: sepolia, transport: http(rpc) });
    const ow = wallet(owner),
      aw = wallet(alice),
      bw = wallet(bob);
    const read = (address, artifact, name, args = []) =>
      pc.readContract({ address, abi: artifact.abi, functionName: name, args });
    async function send(w, address, artifact, name, args = []) {
      const { request } = await pc.simulateContract({
        address,
        abi: artifact.abi,
        functionName: name,
        args,
        account: w.account,
      });
      const hash = await w.writeContract(request);
      assert.equal(
        (await pc.waitForTransactionReceipt({ hash })).status,
        "success",
      );
      return hash;
    }
    async function deploy(token) {
      const artifact = token ? pool : game,
        args = token ? [token] : [];
      const data = encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      });
      await pc.call({ account: owner, data });
      const hash = await ow.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      return { address: receipt.contractAddress, hash };
    }
    const mine = () => pc.request({ method: "anvil_mine", params: ["0x3"] });
    const at = async (timestamp) => {
      await pc.request({
        method: "evm_setNextBlockTimestamp",
        params: [Number(timestamp)],
      });
    };
    const advance = async (seconds) => {
      await pc.request({ method: "evm_increaseTime", params: [seconds] });
      await pc.request({ method: "evm_mine" });
    };
    const token = await deploy();
    assert.equal(
      keccak256(game.runtime),
      "0x70e35febd28b079bd48b7b26e37c8583505028b704f8af8ee50688eb332bffb1",
      "Existing deployed HAMS bytecode must remain unchanged",
    );
    const tree = StandardMerkleTree.of(
      [[owner, "1000000"]],
      ["address", "uint256"],
    );
    await send(ow, token.address, game, "publishPoints", [tree.root]);
    await send(ow, token.address, game, "stakePoints", [
      1000000n,
      1000000n,
      tree.getProof(0),
    ]);
    await advance(601);
    await send(ow, token.address, game, "claim", [0n]);
    for (const account of [alice, bob])
      await send(ow, token.address, game, "transfer", [account, wad("1000")]);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hammy-pool-test-"));
    const server = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "4314",
        DATA_DIR: dataDir,
        ADMIN_ADDRESS: owner,
        RPC_URL: rpc,
        REWARD_CONTRACT: "",
      },
      stdio: "ignore",
    });
    t.after(() => server.kill());
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await wait(100);
    }
    let cookie = "";
    async function api(route, body, status = 200) {
      const r = await fetch(base + "/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await r.json();
      assert.equal(r.status, status, JSON.stringify(json));
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      return json;
    }
    async function login(w) {
      const ch = await api("/auth/challenge", { address: w.account.address });
      await api("/auth/verify", {
        id: ch.id,
        signature: await w.signMessage({ message: ch.message }),
      });
    }
    await api("/hams-pool", undefined, 401);
    await login(aw);
    assert.equal((await api("/hams-pool")).canDeploy, false);
    await api("/admin/hams-pool/deploy", {}, 403);
    await api("/admin/hams-pool/register", { hash: token.hash }, 403);
    await login(ow);
    await mine();
    await api("/admin/register", { hash: token.hash });
    assert.equal((await api("/hams-pool")).canDeploy, true);
    const deployment = await api("/admin/hams-pool/deploy", {});
    assert.equal(
      deployment.data,
      encodeDeployData({
        abi: pool.abi,
        bytecode: pool.bytecode,
        args: [token.address],
      }),
    );
    const deployed = await deploy(token.address),
      address = deployed.address;
    await mine();
    await api("/admin/hams-pool/register", { hash: token.hash }, 400);
    await api("/admin/hams-pool/register", { hash: deployed.hash });
    await api("/admin/hams-pool/register", { hash: deployed.hash }); // Idempotent recovery.
    await api("/admin/hams-pool/deploy", {}, 400);
    assert.equal(
      (await api("/config")).hamsPool.toLowerCase(),
      address.toLowerCase(),
    );
    const pr = (name, args = []) => read(address, pool, name, args);
    async function solvent() {
      assert.ok(
        (await read(token.address, game, "balanceOf", [address])) >=
          (await pr("totalStaked")) +
            (await pr("totalRewardsFunded")) -
            (await pr("totalRewardsPaid")),
      );
    }
    const fund = await api("/hams-pool/prepare", {
      action: "fundRewards",
      amount: "120",
      duration: "120",
    });
    assert.equal(fund.action, "approve");
    const approvalArgs = decodeFunctionData({
      abi: game.abi,
      data: fund.data,
    }).args;
    assert.equal(approvalArgs[0].toLowerCase(), address.toLowerCase());
    assert.equal(approvalArgs[1], wad("120"));
    await send(ow, token.address, game, "approve", [address, wad("120")]);
    assert.equal(
      (
        await api("/hams-pool/prepare", {
          action: "fundRewards",
          amount: "120",
          duration: "120",
        })
      ).action,
      "fundRewards",
    );
    for (const [amount, duration] of [
      ["0", "120"],
      ["1", "59"],
      ["1", "2592001"],
      ["1.0000000000000000001", "120"],
    ])
      await api(
        "/hams-pool/prepare",
        { action: "fundRewards", amount, duration },
        400,
      );
    await send(ow, address, pool, "fundRewards", [wad("120"), 120n]);
    await advance(500);
    assert.equal(await pr("remainingRewards"), wad("120"));
    assert.equal(await pr("remainingSeconds"), 120n);
    await assert.rejects(
      pc.simulateContract({
        account: alice,
        address,
        abi: pool.abi,
        functionName: "fundRewards",
        args: [1n, 120n],
      }),
    );
    await assert.rejects(
      pc.simulateContract({
        account: alice,
        address,
        abi: pool.abi,
        functionName: "stake",
        args: [0n],
      }),
    );
    await send(aw, token.address, game, "approve", [address, wad("100")]);
    await send(bw, token.address, game, "approve", [address, wad("100")]);
    await login(aw);
    assert.equal(
      (await api("/hams-pool/prepare", { action: "stake", amount: "100" }))
        .action,
      "stake",
    );
    await api(
      "/hams-pool/prepare",
      { action: "fundRewards", amount: "1", duration: "120" },
      400,
    );
    await api("/hams-pool/prepare", { action: "withdraw", amount: "1" }, 400);
    await api("/hams-pool/prepare", { action: "claim" }, 400);
    await send(aw, address, pool, "stake", [wad("100")]);
    const start = (await pc.getBlock()).timestamp;
    await at(start + 30n);
    await send(bw, address, pool, "stake", [wad("100")]);
    assert.equal(await pr("earned", [alice]), wad("30"));
    await at(start + 60n);
    await send(aw, address, pool, "withdraw", [wad("100")]);
    assert.equal(await pr("balanceOf", [alice]), 0n);
    assert.equal(await pr("earned", [alice]), wad("45"));
    assert.equal(await pr("earned", [bob]), wad("15"));
    await solvent();
    await at(start + 120n);
    await send(bw, address, pool, "withdraw", [wad("100")]);
    assert.equal(await pr("earned", [bob]), wad("75"));
    assert.equal(await pr("remainingRewards"), 0n);
    assert.equal(await pr("totalStaked"), 0n);
    await send(aw, address, pool, "claim");
    await send(bw, address, pool, "claim");
    assert.equal(await pr("totalRewardsPaid"), wad("120"));
    assert.equal(
      await read(token.address, game, "balanceOf", [alice]),
      wad("1045"),
    );
    assert.equal(
      await read(token.address, game, "balanceOf", [bob]),
      wad("1075"),
    );
    await assert.rejects(
      pc.simulateContract({
        account: alice,
        address,
        abi: pool.abi,
        functionName: "claim",
      }),
    );
    await solvent();
    await mine();
    const snapshot = await api("/hams-pool");
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.canFund, false);
    assert.equal(snapshot.earned, "0");

    await t.test(
      "top-ups preserve unvested rewards and an empty pool pauses mid-stream",
      async () => {
        await send(ow, token.address, game, "approve", [address, wad("180")]);
        await send(ow, address, pool, "fundRewards", [wad("120"), 120n]);
        await send(aw, token.address, game, "approve", [address, wad("100")]);
        await send(aw, address, pool, "stake", [wad("100")]);
        const begin = (await pc.getBlock()).timestamp;
        await at(begin + 30n);
        await send(ow, address, pool, "fundRewards", [wad("60"), 120n]);
        assert.equal(await pr("rewardBudget"), wad("150"));
        assert.equal(await pr("earned", [alice]), wad("30"));
        await at(begin + 90n);
        await send(aw, address, pool, "withdraw", [wad("100")]);
        assert.equal(await pr("earned", [alice]), wad("105"));
        assert.equal(await pr("remainingRewards"), wad("75"));
        await advance(1000);
        assert.equal(await pr("remainingRewards"), wad("75"));
        assert.equal(await pr("remainingSeconds"), 60n);
        await send(aw, token.address, game, "approve", [address, wad("100")]);
        await send(aw, address, pool, "stake", [wad("100")]);
        await advance(60);
        await send(aw, address, pool, "withdraw", [wad("100")]);
        assert.equal(await pr("earned", [alice]), wad("180"));
        await send(aw, address, pool, "claim");
        assert.equal(await pr("totalRewardsPaid"), wad("300"));
        await solvent();
      },
    );
    await t.test(
      "registration rejects replacement, a different token and altered runtime",
      async () => {
        await login(ow);
        const replacement = await deploy(token.address);
        await mine();
        await api("/admin/hams-pool/register", { hash: replacement.hash }, 400);
        const wrong = await deploy(address);
        await mine();
        assert.match(
          (await api("/admin/hams-pool/register", { hash: wrong.hash }, 400))
            .error,
          /different token/,
        );
        await pc.request({
          method: "anvil_setCode",
          params: [address, "0x00"],
        });
        await mine();
        assert.match(
          (await api("/hams-pool", undefined, 400)).error,
          /code does not match/,
        );
        await api("/hams-pool/prepare", { action: "stake", amount: "1" }, 400);
      },
    );
  },
);
