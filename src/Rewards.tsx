import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Coins,
  Leaf,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sprout,
  Wallet,
  ExternalLink,
  Check,
  LoaderCircle,
} from "lucide-react";
import { encodeFunctionData, type Address } from "viem";
import { api, fmt, publicClient, type Transaction } from "./lib";
import artifact from "./generated/HammyRewards.json";
export type Props = {
  account: string | null;
  config: any;
  me: any;
  connect: () => void;
  notify: (s: string) => void;
  review: (t: Transaction) => void;
  refresh: () => void;
};
export function Rewards({
  account,
  config,
  me,
  connect,
  notify,
  review,
  refresh,
}: Props) {
  const [data, setData] = useState<any>(null),
    [amount, setAmount] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const load = async () => {
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      const latest = await api("/rewards");
      setData(latest);
      return latest;
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setData(null);
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [account, config.rewardContract]);
  async function prepare(action: "stakePoints" | "claim", id?: number) {
    if (!account) return connect();
    setBusy(true);
    try {
      const latest = await api("/rewards");
      setData(latest);
      if (!latest.active)
        throw new Error(
          "HAMS rewards are unavailable. Refresh your balances and try again.",
        );
      const address = latest.address as Address;
      let args: any[], description: string;
      if (action === "stakePoints") {
        if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n)
          throw new Error("Enter a positive whole number of points.");
        if (!latest.proof)
          throw new Error(
            "Your verified points are waiting for the administrator’s next onchain publication.",
          );
        args = [
          BigInt(amount),
          BigInt(latest.proof.cumulativePoints),
          latest.proof.proof,
        ];
        description = `Lock ${amount} game points for 10 minutes, then exchange them for ${fmt(BigInt(amount) * 10n ** 16n)} HAMS. These points are spent when staked. HAMS is a separate testnet game token.`;
      } else {
        args = [BigInt(id!)];
        const p = latest.positions.find((p: any) => p.id === id);
        description = `Claim ${fmt(BigInt(p.points) * 10n ** 16n)} HAMS to your connected wallet.`;
      }
      await publicClient.simulateContract({
        address,
        abi: artifact.abi,
        functionName: action,
        args,
        account: account as Address,
      });
      review({
        title: action === "claim" ? "Claim HAMS" : "Stake game points",
        description,
        to: address,
        data: encodeFunctionData({
          abi: artifact.abi,
          functionName: action,
          args,
        }),
        onConfirmed: async () => {
          await load();
          refresh();
        },
        recheck: async () => {
          await api("/rewards");
        },
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const publishedAvailable = data?.proof
    ? BigInt(data.proof.cumulativePoints) - BigInt(data.used || 0)
    : 0n;
  const available = publishedAvailable > 0n ? publishedAvailable : 0n;
  const unpublished = data?.active
    ? Math.max(0, (me?.coins || 0) - Number(data.proof?.cumulativePoints || 0))
    : 0;
  const needsPublication = unpublished > 0 && available === 0n;
  async function publishPoints() {
    if (!account || !data?.canPublish) return;
    setBusy(true);
    try {
      await preparePointsPublication(account, config, review, async () => {
        const latest = await load();
        if (latest?.proof) {
          const ready =
            BigInt(latest.proof.cumulativePoints) - BigInt(latest.used || 0);
          if (ready > 0n) setAmount(ready.toString());
        }
        refresh();
        notify("Points published. You can now review your point stake.");
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">A LITTLE PATIENCE PAYS OFF</span>
          <h1>Your seeds. Your rewards.</h1>
          <p>Turn your garden adventures into HAMS on Sepolia.</p>
        </div>
        <a
          className="pill yellow"
          href={`https://eth-sepolia.blockscout.com/address/${config.rewardContract}`}
          target="_blank"
          rel="noreferrer"
        >
          <Coins size={14} /> HAMS on Sepolia <ArrowUpRight size={13} />
        </a>
      </div>
      <div className="reward-summary">
        <div>
          <span className="square-icon green">
            <Leaf size={20} />
          </span>
          <small>Collected points</small>
          <strong>{me?.coins || 0}</strong>
        </div>
        <div>
          <span className="square-icon yellow">
            <Sprout size={20} />
          </span>
          <small>Ready to stake</small>
          <strong>{available.toString()}</strong>
        </div>
        <div>
          <span className="square-icon purple">
            <Coins size={20} />
          </span>
          <small>Wallet balance</small>
          <strong>
            {loading ? "…" : fmt(data?.balance)} <em>HAMS</em>
          </strong>
        </div>
      </div>
      {error && (
        <div className="notice error">
          {error}{" "}
          <button className="text-button" onClick={load}>
            Try again <RefreshCw size={14} />
          </button>
        </div>
      )}
      <div className="two-column">
        <section className="panel">
          <div className="section-heading">
            <h2>Plant your points</h2>
            <Sprout size={22} />
          </div>
          <p>
            Stake points from your verified runs. After 10 minutes, claim 1 HAMS
            for every 100 points.
          </p>
          {(!account || loading) && (
            <div className="notice">
              {loading ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Wallet size={16} />
              )}
              <div>
                <strong>
                  {loading
                    ? "Checking your rewards"
                    : "Your rewards are linked to your wallet"}
                </strong>
                <p>
                  {loading
                    ? "Reading your HAMS balance and points from Sepolia."
                    : "Connect to see your HAMS balance, published points and active stakes."}
                </p>
              </div>
            </div>
          )}
          {unpublished > 0 && !loading && (
            <div className="notice">
              <Leaf size={16} />
              <div>
                <strong>{unpublished} points awaiting publication</strong>
                <p>
                  {data.canPublish
                    ? "You’re the administrator. Publish the latest game scores with your wallet, then stake your points."
                    : "The game administrator must publish these scores before you can stake them. Your points are saved."}
                </p>
                {data.canPublish && available > 0n && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={publishPoints}
                  >
                    Publish new points
                  </button>
                )}
                {!data.canPublish && (
                  <button className="text-button" onClick={load}>
                    Check for published points <RefreshCw size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
          <label className="input-label" htmlFor="points">
            Points to stake <span>{available.toString()} available</span>
          </label>
          <div className="amount-input">
            <input
              id="points"
              inputMode="numeric"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button onClick={() => setAmount(available.toString())}>MAX</button>
            <span>points</span>
          </div>
          <div className="detail-row">
            <span>Lock period</span>
            <strong>10 minutes</strong>
          </div>
          <div className="detail-row">
            <span>You’ll receive</span>
            <strong>
              {/^\d+$/.test(amount) ? fmt(BigInt(amount) * 10n ** 16n) : "0"}{" "}
              HAMS
            </strong>
          </div>
          <button
            className="button primary wide"
            disabled={
              !!account &&
              (!data?.active ||
                busy ||
                (available === 0n && !(needsPublication && data?.canPublish)))
            }
            onClick={() =>
              !account
                ? connect()
                : needsPublication && data?.canPublish
                  ? publishPoints()
                  : prepare("stakePoints")
            }
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <LockKeyhole size={16} />
            )}{" "}
            {!account
              ? "Connect wallet"
              : needsPublication && data?.canPublish
                ? "Publish points to enable staking"
                : "Review point stake"}
          </button>
          <p className="fine-print">
            Points are exchanged for rewards after the lock. HAMS has no
            monetary value and cannot be staked as $SQK.
          </p>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Your little seed bank</h2>
            <button
              className="icon-button"
              aria-label="Refresh rewards"
              onClick={load}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {!data?.positions?.length ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Sprout size={36} />
              </span>
              <h3>Good things take a little time</h3>
              <p>
                Your point stakes will grow here.
                <br />
                Start with a run in the garden.
              </p>
            </div>
          ) : (
            <div className="positions">
              {data.positions.map((p: any) => {
                const remaining = Math.max(0, Number(p.unlockAt) * 1000 - now);
                return (
                  <div className="position" key={p.id}>
                    <span className="square-icon green">
                      <Sprout size={18} />
                    </span>
                    <div>
                      <strong>{p.points} points</strong>
                      <small>
                        {p.claimed
                          ? "Claimed"
                          : remaining
                            ? `${Math.ceil(remaining / 60000)} min until claim`
                            : "Ready to claim"}{" "}
                        · {fmt(BigInt(p.points) * 10n ** 16n)} HAMS
                      </small>
                    </div>
                    <button
                      className="button small"
                      disabled={busy || p.claimed || remaining > 0}
                      onClick={() => prepare("claim", p.id)}
                    >
                      {p.claimed ? <Check size={15} /> : "Claim"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <div className="note-line">
        <ShieldCheck size={17} />
        <span>
          Scores are checked by the game server and published by the
          administrator. Only published points can be staked.
        </span>
      </div>
      {account &&
        config.admin &&
        account.toLowerCase() === config.admin.toLowerCase() && (
          <PointsPublisher
            account={account}
            config={config}
            me={me}
            connect={connect}
            notify={notify}
            review={review}
            refresh={() => {
              void load();
              refresh();
            }}
            publication={data?.publication}
          />
        )}
    </>
  );
}
export function Squeek({ account, connect, notify, review }: Props) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [amount, setAmount] = useState(""),
    [action, setAction] = useState("stake");
  const load = async () => {
    if (!account) return;
    setLoading(true);
    setError("");
    try {
      setData(await api("/squeek"));
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [account]);
  async function prepare(a: string) {
    if (!account) return connect();
    setBusy(true);
    try {
      const tx = await api("/squeek/prepare", { action: a, amount });
      let description = `${tx.action === "approve" ? "Approve exactly" : a === "stake" ? "Stake" : a === "unstake" ? "Unstake" : "Claim"} ${fmt(tx.details.amount ?? tx.details.payout)} SQK.`;
      if (tx.details.approval)
        description += " After approval confirms, review the stake separately.";
      if (a === "unstake")
        description += ` This permanently burns ${fmt(tx.details.burnedFee)} SQK as the maximum exit fee. You receive ${fmt(tx.details.net)} SQK. The quote expires in 5 minutes.`;
      if (a === "claimAndStake")
        description = "Compound your claimable SQK into a new stake.";
      review({
        title:
          tx.action === "approve"
            ? "Approve SQK"
            : a === "unstake"
              ? "Review exit fee"
              : a === "stake"
                ? "Stake SQK"
                : "Claim SQK rewards",
        description,
        to: tx.to,
        data: tx.data,
        details: {
          "Verified block": tx.blockNumber,
          ...(tx.details.recipient ? { Recipient: tx.details.recipient } : {}),
        },
        recheck: async () => {
          const fresh = await api("/squeek/prepare", { action: a, amount });
          if (fresh.to !== tx.to || (a !== "unstake" && fresh.data !== tx.data))
            throw new Error(
              "State changed. Close this review and prepare the action again.",
            );
          if (
            a === "unstake" &&
            BigInt(fresh.details.burnedFee) > BigInt(tx.details.burnedFee)
          )
            throw new Error(
              "The exit fee increased. Close and review a new quote.",
            );
        },
        onConfirmed: load,
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">POWERED BY A REAL LITTLE HAMSTER</span>
          <h1>A home for your $SQK.</h1>
          <p>Stake existing SQK and claim rewards from Squeekchain.</p>
        </div>
        <a
          className="button secondary"
          href="https://docs.squeekchain.com/rewards/staking/"
          target="_blank"
          rel="noreferrer"
        >
          Read the docs <ArrowUpRight size={16} />
        </a>
      </div>
      <div className="notice purple-notice">
        <ShieldCheck size={21} />
        <div>
          <strong>Two tokens. Two different adventures.</strong>
          <p>
            HAMS comes from this game. SQK comes from Squeekchain’s physical
            hamster wheel. This screen uses the official Squeekchain contracts
            on Sepolia.
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error">
          <div>
            <strong>Live SQK data is unavailable</strong>
            <p>{error}</p>
            <button className="text-button" onClick={load}>
              Check again <RefreshCw size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="reward-summary">
        <div>
          <small>SQK in your wallet</small>
          <strong>{loading ? "…" : fmt(data?.balance)}</strong>
        </div>
        <div>
          <small>Your staked SQK</small>
          <strong>{loading ? "…" : fmt(data?.principal)}</strong>
        </div>
        <div>
          <small>Claimable rewards</small>
          <strong>{loading ? "…" : fmt(data?.claimable)}</strong>
        </div>
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="segmented">
            <button
              className={action === "stake" ? "active" : ""}
              onClick={() => setAction("stake")}
            >
              Stake SQK
            </button>
            <button
              className={action === "unstake" ? "active" : ""}
              onClick={() => setAction("unstake")}
            >
              Unstake
            </button>
          </div>
          <label className="input-label" htmlFor="sqk-amount">
            Amount <span>Sepolia SQK</span>
          </label>
          <div className="amount-input">
            <input
              id="sqk-amount"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span>SQK</span>
          </div>
          <p>
            {action === "stake"
              ? "Stake SQK you already hold to add reward power. New principal matures at the next 10-minute Squeekchain round."
              : "Only mature principal can be unstaked. You will see the dynamic exit fee and receive a bounded quote before signing."}
          </p>
          <button
            className="button primary wide"
            disabled={busy || (!!account && !data)}
            onClick={() => prepare(action)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Wallet size={16} />
            )}{" "}
            {account
              ? "Review " + (action === "stake" ? "stake" : "unstake")
              : "Connect wallet"}
          </button>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Pick up your rewards</h2>
            <Coins size={22} />
          </div>
          <p>
            Rewards accrue to your staking account. Claim to your configured
            recipient or compound into your stake.
          </p>
          <div className="claim-value">
            {fmt(data?.claimable)} <span>SQK</span>
          </div>
          <div className="button-row">
            <button
              className="button primary"
              disabled={
                busy || (!!account && (!data || BigInt(data.claimable) === 0n))
              }
              onClick={() => prepare("claim")}
            >
              Review claim
            </button>
            <button
              className="button secondary"
              disabled={
                busy || (!!account && (!data || BigInt(data.claimable) === 0n))
              }
              onClick={() => prepare("claimAndStake")}
            >
              Claim & stake
            </button>
          </div>
        </section>
      </div>
      {data && (
        <div className="note-line">
          <ShieldCheck size={17} />
          <span>
            Deployment verified at Sepolia block {data.blockNumber}. Snapshot is
            12 confirmations behind.
          </span>
          <button className="text-button" onClick={load}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}
async function preparePointsPublication(
  account: string,
  config: Props["config"],
  review: Props["review"],
  onConfirmed: () => void | Promise<void>,
) {
  const snap = await api("/admin/snapshot");
  const address = config.rewardContract as Address;
  const owner = (await publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName: "owner",
  })) as string;
  if (owner.toLowerCase() !== account.toLowerCase())
    throw new Error("Connect the contract owner wallet to publish points.");
  await publicClient.simulateContract({
    address,
    abi: artifact.abi,
    functionName: "publishPoints",
    args: [snap.root],
    account: account as Address,
  });
  review({
    title: "Publish verified game points",
    description: `Publish ${snap.newPoints} new points for ${snap.changedPlayers} players. Previously published totals carry forward without creating extra points. This makes new points available to stake; it does not stake or spend them.`,
    to: address,
    data: encodeFunctionData({
      abi: artifact.abi,
      functionName: "publishPoints",
      args: [snap.root],
    }),
    details: { "Points root": snap.root },
    recheck: async () => {
      const latest = await api("/admin/snapshot");
      if (latest.previousRoot !== snap.previousRoot)
        throw new Error(
          "A newer publication was confirmed. Review an updated points publication.",
        );
    },
    onConfirmed: async () => {
      await onConfirmed();
    },
  });
  return snap;
}
function PointsPublisher({
  account,
  config,
  notify,
  review,
  refresh,
  publication,
}: Props & { publication?: any }) {
  const [snapshot, setSnapshot] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const isAdmin =
    !!account &&
    !!config.admin &&
    account.toLowerCase() === config.admin.toLowerCase();
  async function prepareRoot() {
    if (!account) return;
    setBusy(true);
    try {
      const snap = await preparePointsPublication(
        account,
        config,
        review,
        async () => {
          refresh();
          notify("Verified points published.");
        },
      );
      setSnapshot(snap);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!isAdmin) return null;
  return (
    <section className="panel points-publisher" aria-label="Point publication">
      <div className="section-heading">
        <h2>Publish new points</h2>
        <span className="pill">Owner only</span>
      </div>
      <p>
        Make players’ latest verified points available to stake. Review the
        totals, then publish with your wallet.
      </p>
      <button
        className="button secondary"
        disabled={
          busy ||
          !config.rewardContract ||
          !publication ||
          !!publication.error ||
          publication.newPoints === "0"
        }
        onClick={prepareRoot}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Leaf size={16} />
        )}{" "}
        {publication?.newPoints === "0"
          ? "All points published"
          : "Review points publication"}
      </button>
      {publication?.error && (
        <p className="notice error">{publication.error}</p>
      )}
      {publication && !publication.error && (
        <p className="fine-print">
          {publication.newPoints} new points awaiting publication across{" "}
          {publication.changedPlayers} players.
        </p>
      )}
      {snapshot && (
        <p className="fine-print">
          {snapshot.changedPlayers} players · {snapshot.newPoints} new points
        </p>
      )}
    </section>
  );
}
