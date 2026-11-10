import { useEffect, useState } from "react";
import {
  Coins,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { formatUnits, type Hex } from "viem";
import { api, fmt } from "./lib";
import { Squeek, type Props } from "./Rewards";

export function Pools(props: Props) {
  const [pool, setPool] = useState("hams");
  return (
    <>
      <div
        className="segmented pool-selector"
        aria-label="Choose a staking pool"
      >
        <button
          className={pool === "hams" ? "active" : ""}
          aria-pressed={pool === "hams"}
          onClick={() => setPool("hams")}
        >
          HAMS pool
        </button>
        <button
          className={pool === "sqk" ? "active" : ""}
          aria-pressed={pool === "sqk"}
          onClick={() => setPool("sqk")}
        >
          SQK · Squeekchain
        </button>
      </div>
      {pool === "hams" ? <HamsPool {...props} /> : <Squeek {...props} />}
    </>
  );
}

function HamsPool({
  account,
  config,
  connect,
  notify,
  review,
  refresh,
}: Props) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState("stake"),
    [amount, setAmount] = useState("");
  const [funding, setFunding] = useState(""),
    [duration, setDuration] = useState("86400");
  const storageKey = `hammy-pool-deployment:${account?.toLowerCase()}`;
  const [deploymentHash, setDeploymentHash] = useState(
    () => sessionStorage.getItem(storageKey) || "",
  );
  async function load() {
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      setData(await api("/hams-pool"));
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [account, config.hamsPool]);
  function saveHash(hash: string) {
    setDeploymentHash(hash);
    if (hash) sessionStorage.setItem(storageKey, hash);
    else sessionStorage.removeItem(storageKey);
  }
  async function link(hash: string) {
    await api("/admin/hams-pool/register", { hash });
    saveHash("");
    await load();
    refresh();
    notify(
      "HAMS pool linked. Fund its reward stream to begin distributing rewards.",
    );
  }
  async function register() {
    setBusy(true);
    try {
      await link(deploymentHash.trim());
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deploy() {
    setBusy(true);
    try {
      const tx = await api("/admin/hams-pool/deploy", {});
      review({
        title: "Deploy the HAMS staking pool",
        description:
          "Create a pool for existing HAMS on Sepolia. Your wallet will own it. Rewards come from HAMS you fund separately; deployment starts with no reward budget. Stakers can withdraw their principal at any time without an exit fee.",
        data: tx.data,
        details: { "HAMS token": tx.token, "Verified block": tx.blockNumber },
        recheck: async () => {
          const fresh = await api("/admin/hams-pool/deploy", {});
          if (fresh.data !== tx.data)
            throw new Error("Deployment changed. Close and review it again.");
        },
        onSubmitted: (hash: Hex) => saveHash(hash),
        onConfirmed: async (hash: Hex) => {
          await link(hash);
        },
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare(selected: string) {
    if (!account) return connect();
    setBusy(true);
    const body = {
      action: selected,
      amount: selected === "fundRewards" ? funding : amount,
      duration,
    };
    try {
      const tx = await api("/hams-pool/prepare", body);
      const approval = tx.action === "approve";
      const verb =
        selected === "fundRewards"
          ? "Fund"
          : selected === "withdraw"
            ? "Withdraw"
            : selected === "claim"
              ? "Claim"
              : "Stake";
      let description = `${approval ? "Approve exactly" : verb} ${formatUnits(BigInt(tx.details.amount ?? tx.details.payout), 18)} HAMS.`;
      if (approval)
        description += ` This permits the HAMS pool to transfer that amount. Once confirmed, review ${selected === "fundRewards" ? "funding" : "staking"} again to complete it.`;
      else if (selected === "fundRewards")
        description += ` Stream these tokens plus any undistributed rewards over ${Number(duration) / 60} minutes of active staking. Funding is committed to stakers and cannot be withdrawn by the owner.`;
      else if (selected === "stake")
        description +=
          " Your principal can be withdrawn at any time. Rewards depend on the funded stream and your share of the pool.";
      else if (selected === "withdraw")
        description +=
          " No exit fee or lock applies. Accrued rewards remain available to claim separately.";
      review({
        title: approval
          ? "Approve HAMS"
          : `${verb} HAMS${selected === "fundRewards" ? " rewards" : ""}`,
        description,
        to: tx.to,
        data: tx.data,
        details: {
          "Verified block": tx.blockNumber,
          ...(tx.details.spender
            ? { "Approved spender": tx.details.spender }
            : {}),
        },
        recheck: async () => {
          const fresh = await api("/hams-pool/prepare", body);
          if (fresh.to !== tx.to || fresh.data !== tx.data)
            throw new Error(
              "Pool state changed. Close this review and prepare the action again.",
            );
        },
        onConfirmed: async () => {
          await load();
          refresh();
        },
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || loading;
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">A HOME FOR YOUR HARVEST</span>
          <h1>Put your HAMS to work.</h1>
          <p>
            Stake HAMS you already hold and share the pool’s funded rewards.
          </p>
        </div>
        <span className="pill yellow">
          <Coins size={14} /> Sepolia HAMS
        </span>
      </div>
      {!account && (
        <section className="panel">
          <h2>Your wallet, your pool position</h2>
          <p>Connect to view your HAMS balance, stake and rewards.</p>
          <button className="button primary" onClick={connect}>
            <Wallet size={16} /> Connect wallet
          </button>
        </section>
      )}
      {loading && (
        <p className="note-line" role="status">
          <LoaderCircle className="spin" size={17} /> Checking the HAMS pool…
        </p>
      )}
      {error && (
        <div className="notice error">
          <div>
            <strong>HAMS pool data is unavailable</strong>
            <p>{error}</p>
            <button className="text-button" onClick={load}>
              Try again <RefreshCw size={14} />
            </button>
          </div>
        </div>
      )}
      {account && data && !data.active && (
        <section className="panel">
          <div className="section-heading">
            <h2>The HAMS pool is not live yet</h2>
            <Coins size={22} />
          </div>
          <p>
            The game administrator needs to deploy this pool and fund its HAMS
            reward stream. You can keep earning and claiming HAMS in My rewards.
          </p>
          {data.canDeploy && (
            <>
              <div className="notice">
                <ShieldCheck size={18} />
                <div>
                  <strong>Administrator setup</strong>
                  <p>
                    Review the pool deployment in your wallet. After
                    confirmation, it will be linked here. Funding is a separate
                    transaction using HAMS you already own.
                  </p>
                </div>
              </div>
              <button
                className="button primary"
                disabled={disabled || !!deploymentHash}
                onClick={deploy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Wallet size={16} />
                )}{" "}
                Review pool deployment
              </button>
              <details className="pool-recovery" open={!!deploymentHash}>
                <summary>Already deployed this pool?</summary>
                <label className="input-label" htmlFor="pool-hash">
                  Deployment transaction hash
                </label>
                <div className="amount-input">
                  <input
                    id="pool-hash"
                    value={deploymentHash}
                    placeholder="0x…"
                    onChange={(e) => saveHash(e.target.value)}
                  />
                </div>
                <button
                  className="button secondary"
                  disabled={
                    disabled ||
                    !/^0x[\da-fA-F]{64}$/.test(deploymentHash.trim())
                  }
                  onClick={register}
                >
                  Link deployed pool
                </button>
                <p className="fine-print">
                  Wait for three confirmations. Linking checks your existing
                  deployment and does not send a transaction.
                </p>
              </details>
            </>
          )}
        </section>
      )}
      {account && data?.active && (
        <>
          <div className="reward-summary">
            <div>
              <small>HAMS in your wallet</small>
              <strong>{fmt(data.balance)}</strong>
            </div>
            <div>
              <small>Your staked HAMS</small>
              <strong>{fmt(data.staked)}</strong>
            </div>
            <div>
              <small>Claimable HAMS</small>
              <strong>{fmt(data.earned)}</strong>
            </div>
          </div>
          <div className="notice">
            <ShieldCheck size={18} />
            <div>
              <strong>
                {BigInt(data.remainingRewards) === 0n
                  ? "No active reward stream"
                  : BigInt(data.totalStaked) === 0n
                    ? "Rewards are paused until someone stakes"
                    : "Funded rewards are streaming"}
              </strong>
              <p>
                {fmt(data.remainingRewards)} HAMS left to distribute over{" "}
                {Math.ceil(Number(data.remainingSeconds) / 60)} minutes of
                active staking.{" "}
                {BigInt(data.remainingRewards) === 0n
                  ? "New rewards require administrator funding."
                  : "Your share depends on your stake relative to the whole pool."}
              </p>
            </div>
          </div>
          <div className="two-column">
            <section className="panel">
              <div className="segmented">
                <button
                  className={action === "stake" ? "active" : ""}
                  onClick={() => setAction("stake")}
                >
                  Stake HAMS
                </button>
                <button
                  className={action === "withdraw" ? "active" : ""}
                  onClick={() => setAction("withdraw")}
                >
                  Withdraw
                </button>
              </div>
              <label className="input-label" htmlFor="hams-amount">
                Amount{" "}
                <span>
                  {fmt(action === "stake" ? data.balance : data.staked)}{" "}
                  available
                </span>
              </label>
              <div className="amount-input">
                <input
                  id="hams-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  onClick={() =>
                    setAmount(
                      formatUnits(
                        BigInt(action === "stake" ? data.balance : data.staked),
                        18,
                      ),
                    )
                  }
                >
                  MAX
                </button>
                <span>HAMS</span>
              </div>
              <p>
                {action === "stake"
                  ? "Stake claimed HAMS to earn a share of funded rewards. You can withdraw your principal at any time."
                  : "Withdraw any part of your stake without a lock or exit fee. Your earned rewards stay claimable."}
              </p>
              <button
                className="button primary wide"
                disabled={disabled}
                onClick={() => prepare(action)}
              >
                <Wallet size={16} /> Review {action}
              </button>
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>Your pool rewards</h2>
                <button
                  className="icon-button"
                  aria-label="Refresh HAMS pool"
                  onClick={load}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              <p>Claim earned HAMS directly to your wallet.</p>
              <div className="claim-value">
                {fmt(data.earned)} <span>HAMS</span>
              </div>
              <button
                className="button primary"
                disabled={disabled || BigInt(data.earned) === 0n}
                onClick={() => prepare("claim")}
              >
                Review HAMS claim
              </button>
              <div className="detail-row">
                <span>Total pool stake</span>
                <strong>{fmt(data.totalStaked)} HAMS</strong>
              </div>
            </section>
          </div>
          {data.canFund && (
            <section className="panel pool-funding">
              <div className="section-heading">
                <h2>Fund the HAMS rewards</h2>
                <span className="pill">Pool owner</span>
              </div>
              <p>
                Commit existing HAMS to the reward stream. Any undistributed
                rewards carry into the new duration. Funding cannot be reclaimed
                by the owner.
              </p>
              <label className="input-label" htmlFor="hams-funding">
                Reward budget <span>{fmt(data.balance)} HAMS in wallet</span>
              </label>
              <div className="amount-input">
                <input
                  id="hams-funding"
                  inputMode="decimal"
                  value={funding}
                  onChange={(e) => setFunding(e.target.value)}
                  placeholder="0.0"
                />
                <span>HAMS</span>
              </div>
              <label className="input-label" htmlFor="hams-duration">
                Stream duration
              </label>
              <select
                id="hams-duration"
                className="pool-duration"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              >
                <option value="600">10 minutes</option>
                <option value="3600">1 hour</option>
                <option value="86400">1 day</option>
                <option value="604800">7 days</option>
                <option value="2592000">30 days</option>
              </select>
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() => prepare("fundRewards")}
              >
                Review reward funding
              </button>
            </section>
          )}
          <div className="note-line">
            <ShieldCheck size={17} />
            <span>HAMS pool verified at Sepolia block {data.blockNumber}.</span>
            <a
              href={`https://eth-sepolia.blockscout.com/address/${data.address}`}
              target="_blank"
              rel="noreferrer"
            >
              View pool
            </a>
          </div>
        </>
      )}
    </>
  );
}
