import { useCallback, useEffect, useMemo, useState  } from "react";
import { BrowserProvider, Contract, formatEther, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { defaultDeployment, mockUsdAbi, vaultAbi } from "./contracts";
import localDeployment from "./generated/deployment.json";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

type Status = "idle" | "pending" | "success" | "error";

interface StatusState {
  currentStatus: Status;
  message: string;
}

export default function App() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("10");
  const [secret, setSecret] = useState("demo-secret");
  const [deadlineMinutes, setDeadlineMinutes] = useState("30");
  const [transferId, setTransferId] = useState("1");
  const [claimSecret, setClaimSecret] = useState("demo-secret");
  const [balance, setBalance] = useState("0");
  const [status, setStatus] = useState<StatusState>({
    currentStatus: "idle",
    message: "Connect a wallet to start the local transfer test.",
  });

  type BusyAction = "connect" | "faucet" | "createTransfer" | "claim" | "refund" | null;
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const isBusy = busyAction !== null;

  const deployment = useMemo(() => localDeployment, []);
  const hasDeployment = deployment.tokenAddress !== defaultDeployment.tokenAddress && deployment.vaultAddress !== defaultDeployment.vaultAddress;

  async function getSigner() {
    if (!window.ethereum) throw new Error("No injected wallet found. Please install MetaMask or a similar EVM wallet.");
    const provider = new BrowserProvider(window.ethereum);
    return provider.getSigner();
  }

  async function connectWallet() {
    setBusyAction("connect");
    try {
      if (!window.ethereum) throw new Error("MetaMask or another injected wallet is required.");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const signer = await getSigner();
      const provider = signer.provider;
      const network = await provider.getNetwork();
      const address = await signer.getAddress();
      setAccount(address);
      setChainId(Number(network.chainId));

      if (Number(network.chainId) !== 31337) {
        setStatus({
          currentStatus: "error",
          message: `Wrong network (chain ${network.chainId}). Please switch to the local Hardhat network (chain 31337).`,
        });
      } else {
        setStatus({
          currentStatus: "success",
          message: "Wallet connected to Hardhat local network.",
        });
      }

      await refreshBalance(address);
    } catch (error) {
      setStatus({ currentStatus: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  const refreshBalance = useCallback(
    async (address = account) => {
      if (!address || !hasDeployment) return;
      const signer = await getSigner();
      const token = new Contract(deployment.tokenAddress, mockUsdAbi, signer);
      const rawBalance = await token.balanceOf(address);
      setBalance(formatEther(rawBalance));
    },
    [account, hasDeployment, deployment.tokenAddress]
  );

  async function claimFaucet() {
    await runAction("faucet", async () => {
      const signer = await getSigner();

      const token = new Contract(deployment.tokenAddress, mockUsdAbi, signer);
      setStatus({ currentStatus: "pending", message: "Submitting faucet transaction..." });

      const tx = await token.faucet();
      setStatus({ currentStatus: "pending", message: "Waiting for confirmation..." });

      await tx.wait();
      await refreshBalance();
      setStatus({ currentStatus: "success", message: "Faucet claim confirmed. 1,000 mUSD added to your wallet." });
    });
  }

  async function createProtectedTransfer() {
    await runAction("createTransfer", async () => {
      if (!recipient) throw new Error("Recipient address is required.");

      const signer = await getSigner();
      const token = new Contract(deployment.tokenAddress, mockUsdAbi, signer);
      const vault = new Contract(deployment.vaultAddress, vaultAbi, signer);
      const parsedAmount = parseEther(amount || "0");
      const secretHash = keccak256(toUtf8Bytes(secret));
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineMinutes || "0") * 60;

      setStatus({ currentStatus: "pending", message: "Approving token spend..." });
      const approveTx = await token.approve(deployment.vaultAddress, parsedAmount);
      await approveTx.wait();

      setStatus({ currentStatus: "pending", message: "Creating protected transfer..." });
      const transferTx = await vault.createTransfer(recipient, deployment.tokenAddress, parsedAmount, secretHash, deadline);

      await transferTx.wait();
      await refreshBalance();

      setStatus({
        currentStatus: "success",
        message: `Protected transfer created. The Claim / Refund panel has been pre-filled.`,
      });
    });
  }

  async function claimTransfer() {
    await runAction("claim", async () => {
      const signer = await getSigner();
      const vault = new Contract(deployment.vaultAddress, vaultAbi, signer);
      setStatus({ currentStatus: "pending", message: "Submitting claim transaction..." });

      const tx = await vault.claimTransfer(BigInt(transferId), claimSecret);
      setStatus({ currentStatus: "pending", message: "Waiting for confirmation..." });

      await tx.wait();
      await refreshBalance();
      setStatus({ currentStatus: "success", message: `Transfer #${transferId} claimed successfully. Tokens sent to your wallet.` });
    });
  }

  async function refundTransfer() {
    await runAction("refund", async () => {
      const signer = await getSigner();
      const vault = new Contract(deployment.vaultAddress, vaultAbi, signer);
      setStatus({ currentStatus: "pending", message: "Submitting refund transaction..." });

      const tx = await vault.refundTransfer(BigInt(transferId));
      setStatus({ currentStatus: "pending", message: "Waiting for confirmation..." });

      await tx.wait();
      await refreshBalance();
      setStatus({ currentStatus: "success", message: `Transfer #${transferId} refunded. Tokens returned to your wallet.` });
    });
  }

  async function runAction(action: BusyAction, callback: () => Promise<void>) {
    setBusyAction(action);
    try {
      if (!hasDeployment) throw new Error("Deploy contracts first with `npm run deploy:local`; then restart the frontend.");
      await callback();
    } catch (error) {
      setStatus({ currentStatus: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount("");
        setBalance("0");
        setChainId(null);
        setStatus({ currentStatus: "idle", message: "Wallet disconnected." });
      } else {
        setAccount(accounts[0]);
        void refreshBalance(accounts[0]);
      }
    };

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!accounts || !Array.isArray(accounts)) return;
      handleAccountsChanged(accounts);
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshBalance]);

  const isWrongNetwork = chainId !== null && chainId !== 31337;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dbeafe,_transparent_42%),linear-gradient(135deg,_#f8fafc,_#e0f2fe)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-soft backdrop-blur md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <section className="space-y-5">
              <span className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Candidate Web3 Task</span>
              <h1 className="max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Secure virtual token transfers with Solidity and React.
              </h1>
              <p className="prose prose-2xl max-w-2xl text-lg leading-8 text-slate-600">
                Connect an EVM wallet, claim local mUSD, create a protected transfer, then claim or refund it through the vault contract.
              </p>

              {isWrongNetwork && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
                  Wrong network detected (chain {chainId}). Please switch MetaMask to the Hardhat local network (chain 31337).
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={connectWallet}
                  disabled={isBusy}
                  className="rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyAction === "connect" ? "Connecting..." : account ? `Connected: ${shortenAddress(account)}` : "Connect wallet"}
                </button>
                <button
                  onClick={() => refreshBalance()}
                  disabled={!account || isBusy}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-bold text-slate-800 transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refresh balance
                </button>
              </div>
            </section>

            <aside className="rounded-3xl bg-slate-950 p-5 text-white shadow-2xl">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <InfoCard label="Wallet" value={account ? shortenAddress(account) : "Not connected"} />
                <InfoCard label="Chain" value={chainId ? String(chainId) : "Unknown"} />
                <InfoCard label="Chain" value={chainId ? `${chainId}${chainId === 31337 ? " (Hardhat)" : " Wrong network"}` : "Unknown"} />
                <InfoCard label="mUSD balance" value={Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} />
              </div>
            </aside>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-3">
          <Panel title="1. Faucet" description="Mint 1,000 local virtual mUSD to the connected wallet. One claim per hour per address.">
            <button onClick={claimFaucet} disabled={!account || isBusy || isWrongNetwork} className="primary-button w-full">{busyAction === "faucet" ? "Processing..." : "Claim 1,000 mUSD"}</button>
          </Panel>

          <Panel title="2. Create transfer" description="Lock mUSD for a recipient. They must supply the matching secret before the expiry to claim the tokens.">
            <Input label="Recipient address" value={recipient} onChange={setRecipient} placeholder="0x..." />
            <Input label="Amount (mUSD)" value={amount} onChange={setAmount} placeholder="10" />
            <Input label="Secret" value={secret} onChange={setSecret} placeholder="shared secret" />
            <Input label="Expiry in minutes" value={deadlineMinutes} onChange={setDeadlineMinutes} placeholder="30" />
            <button onClick={createProtectedTransfer} disabled={!account || isBusy || isWrongNetwork} className="primary-button w-full">{busyAction === "createTransfer" ? "Processing..." : "Create protected transfer"}</button>
          </Panel>

          <Panel title="3. Claim or refund" description="Claim a transfer with the secret before expiry, or refund it after the deadline as the original sender.">
            <Input label="Transfer ID" value={transferId} onChange={setTransferId} placeholder="1" />
            <Input label="Claim secret" value={claimSecret} onChange={setClaimSecret} placeholder="shared secret" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <button onClick={claimTransfer} disabled={!account || isBusy || isWrongNetwork} className="primary-button">{busyAction === "claim" ? "Claiming..." : "Claim"}</button>
              <button onClick={refundTransfer} disabled={!account || isBusy || isWrongNetwork} className="secondary-button">{busyAction === "refund" ? "Refunding..." : "Refund"}</button>
            </div>
          </Panel>
        </section>

        <StatusBar status={status} busyAction={busyAction} />

        <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-soft backdrop-blur md:p-8">
          <h2 className="text-2xl font-black text-slate-950">Candidate challenge</h2>
          <p className="mt-2 max-w-none text-base leading-7 text-slate-600">
            Complete the Solidity TODOs, improve the wallet flow where needed, keep the UI responsive, and submit your GitHub URL with a frontend screenshot.
          </p>
        </section>
      </div>
    </main>
  );
}


function StatusBar({ status, busyAction }: { status: StatusState; busyAction: string | null }) {
  const borderColor = {
    idle: "border-slate-200",
    pending: "border-blue-300",
    success: "border-emerald-300",
    error: "border-red-300",
  }[status.currentStatus];

  const bgColor = {
    idle: "bg-white",
    pending: "bg-blue-50",
    success: "bg-emerald-50",
    error: "bg-red-50",
  }[status.currentStatus];

  const textColor = {
    idle: "text-slate-800",
    pending: "text-blue-800",
    success: "text-emerald-800",
    error: "text-red-800",
  }[status.currentStatus];

  const icon = {
    idle: "😴",
    pending: "⌛",
    success: "✅",
    error: "❌",
  }[status.currentStatus];

  return (
    <section className={`rounded-[2rem] border ${borderColor} ${bgColor} p-5 shadow-sm transition-colors duration-300`}>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Status</p>
      <p className={`mt-2 flex items-start gap-2 break-words text-base font-medium ${textColor}`}>
        <span className={`mt-0.5 inline-block ${busyAction ? "animate-spin" : ""}`}>{icon}</span>
        {status.message}
      </p>
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <p className="text-sm text-slate-300">{label}</p>
      <p className="mt-1 break-all text-xl font-black">{value}</p>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <article className="flex min-h-[320px] flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-soft backdrop-blur md:p-6">
      <div>
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </article>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}
