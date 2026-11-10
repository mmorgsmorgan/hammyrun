import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";

const rpc = "http://127.0.0.1:9549",
  base = "http://127.0.0.1:4315";
const anvil = spawn(
  process.env.ANVIL_BIN || "/home/chief/.foundry/bin/anvil",
  ["--silent", "--port", "9549", "--chain-id", "11155111"],
  { stdio: "ignore" },
);
let browser, server;
try {
  const pc = createPublicClient({
    chain: sepolia,
    transport: http(rpc),
    cacheTime: 0,
    pollingInterval: 30,
  });
  let accounts;
  for (let i = 0; i < 50; i++) {
    try {
      accounts = await pc.request({ method: "eth_accounts" });
      break;
    } catch {
      await wait(100);
    }
  }
  assert.ok(accounts?.length);
  const [owner, other] = accounts;
  const wc = createWalletClient({
    account: owner,
    chain: sepolia,
    transport: http(rpc),
  });
  const artifact = JSON.parse(
    fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
  );
  await pc.call({ account: owner, data: artifact.bytecode });
  const deployHash = await wc.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  });
  const receipt = await pc.waitForTransactionReceipt({ hash: deployHash });
  await pc.request({ method: "anvil_mine", params: ["0x3"] });
  process.env.DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "hammy-ui-pools-"),
  );
  const { db } = await import("../server/store.mjs");
  db.prepare("INSERT INTO players(address,coins) VALUES(?,?)").run(
    owner.toLowerCase(),
    291,
  );
  db.close();
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "4315",
      ADMIN_ADDRESS: owner,
      RPC_URL: rpc,
      REWARD_CONTRACT: receipt.contractAddress,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await wait(100);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_BIN ||
      "/home/chief/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Every wallet request and frontend RPC call stays on the disposable local chain.
  await context.route(
    "https://ethereum-sepolia-rpc.publicnode.com/**",
    async (route) => {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: route.request().postData(),
      });
      await route.fulfill({
        status: r.status,
        contentType: "application/json",
        body: await r.text(),
      });
    },
  );
  let selected = owner;
  await page.exposeFunction("walletRequest", async ({ method, params }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [selected];
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: params || [],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    if (method === "eth_sendTransaction")
      await pc.request({ method: "anvil_mine", params: ["0x3"] });
    return j.result;
  });
  await page.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: (r) => window.walletRequest(r),
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.goto(base);
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name, exact: true });
  async function connect() {
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "MetaMask", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 20000 });
  }
  async function confirm(button, heading) {
    await button.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("heading", { name: heading, exact: true })
      .waitFor({ timeout: 20000 });
    await dialog
      .getByRole("button", { name: "Confirm in wallet", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden", timeout: 30000 });
  }
  async function uiIdle() {
    await page.waitForFunction(() => !document.querySelector(".spin"));
  }
  async function poolRefresh() {
    await page
      .getByRole("button", { name: "Refresh HAMS pool", exact: true })
      .click();
    await uiIdle();
  }
  await connect();
  await nav("My rewards").click();
  await page
    .getByRole("button", {
      name: "Publish points to enable staking",
      exact: true,
    })
    .waitFor();
  await uiIdle();
  await confirm(
    page.getByRole("button", {
      name: "Publish points to enable staking",
      exact: true,
    }),
    "Publish verified game points",
  );
  await page
    .getByRole("button", { name: "All points published", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "All points published", exact: true })
      .isDisabled(),
    true,
  );
  await confirm(
    page.getByRole("button", { name: "Review point stake", exact: true }),
    "Stake game points",
  );
  await uiIdle();
  assert.equal(
    await page
      .getByRole("button", { name: "Review point stake", exact: true })
      .isDisabled(),
    true,
  );
  await pc.request({ method: "evm_increaseTime", params: [601] });
  await pc.request({ method: "anvil_mine", params: ["0x3"] });
  await page.clock.setSystemTime(
    Number((await pc.getBlock()).timestamp) * 1000,
  );
  await page
    .getByRole("button", { name: "Refresh rewards", exact: true })
    .click();
  await uiIdle();
  await confirm(
    page.getByRole("button", { name: "Claim", exact: true }),
    "Claim HAMS",
  );
  console.log(
    "Owner publication, duplicate protection, point lock and HAMS claim passed.",
  );
  await nav("Staking pools").click();
  await page
    .getByRole("button", { name: "Review pool deployment", exact: true })
    .waitFor();
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/pool-owner-setup.png",
    fullPage: true,
  });
  await confirm(
    page.getByRole("button", { name: "Review pool deployment", exact: true }),
    "Deploy the HAMS staking pool",
  );
  await page
    .getByRole("heading", { name: "Fund the HAMS rewards", exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByLabel("Reward budget", { exact: false }).fill("1");
  await page.getByLabel("Stream duration", { exact: true }).selectOption("600");
  await confirm(
    page.getByRole("button", { name: "Review reward funding", exact: true }),
    "Approve HAMS",
  );
  await uiIdle();
  await confirm(
    page.getByRole("button", { name: "Review reward funding", exact: true }),
    "Fund HAMS rewards",
  );
  await uiIdle();
  await page.locator("#hams-amount").fill("1");
  await confirm(
    page.getByRole("button", { name: "Review stake", exact: true }),
    "Approve HAMS",
  );
  await uiIdle();
  await confirm(
    page.getByRole("button", { name: "Review stake", exact: true }),
    "Stake HAMS",
  );
  await uiIdle();
  await pc.request({ method: "evm_increaseTime", params: [60] });
  await pc.request({ method: "anvil_mine", params: ["0x3"] });
  await poolRefresh();
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await confirm(
    page.getByRole("button", { name: "Review withdraw", exact: true }),
    "Withdraw HAMS",
  );
  await uiIdle();
  await confirm(
    page.getByRole("button", { name: "Review HAMS claim", exact: true }),
    "Claim HAMS",
  );
  await uiIdle();
  console.log(
    "Pool deployment, automatic linking, exact approvals, funding, stake, withdrawal and claim passed.",
  );
  await page.screenshot({
    path: "test-results/pool-owner-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Pool overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/pool-owner-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  selected = other;
  await connect();
  await uiIdle();
  assert.equal(
    await page
      .getByRole("heading", { name: "Fund the HAMS rewards", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Review pool deployment", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "test-results/pool-player-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Owner isolation and pool layouts passed at 320, 390, 768 and 1440 pixels. No browser errors. All transactions used disposable Anvil accounts.",
  );
} finally {
  await browser?.close();
  server?.kill();
  anvil.kill();
}
