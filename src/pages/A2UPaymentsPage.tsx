import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, HandCoins, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import { getAppCookie, setAppCookie } from "@/lib/userPreferences";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import BottomNav from "@/components/BottomNav";
import A2UPaymentStatus from "@/components/pi-network/a2u-payment-status";

type PiPaymentData = {
  identifier?: string;
  amount?: number;
  memo?: string;
  transaction?: {
    txid?: string;
    _link?: string;
  } | null;
  status?: {
    developer_approved?: boolean;
    transaction_verified?: boolean;
    developer_completed?: boolean;
    cancelled?: boolean;
    user_cancelled?: boolean;
  };
  network?: string;
  created_at?: string;
  user_uid?: string;
};

const A2UPaymentsPage = () => {
  const navigate = useNavigate();
  const fixedPayoutAmount = 0.01;
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receiverUid, setReceiverUid] = useState("");
  const [receiverUsername, setReceiverUsername] = useState("");
  const memo = "OpenPay Testnet payout";
  const [paymentId, setPaymentId] = useState("");
  const [txid, setTxid] = useState("");
  const [explorerLink, setExplorerLink] = useState("");
  const [paymentData, setPaymentData] = useState<PiPaymentData | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [piSdkReady, setPiSdkReady] = useState(false);
  const [authRefreshing, setAuthRefreshing] = useState(false);

  const callPiPlatform = async (body: Record<string, unknown>, fallbackError: string) => {
    const { data, error } = await supabase.functions.invoke("pi-platform", { body });
    if (error) throw new Error(await getFunctionErrorMessage(error, fallbackError));
    const payload = data as Record<string, unknown> | null;
    if (!payload?.success) throw new Error(String(payload?.error || fallbackError));
    return payload;
  };

  useEffect(() => {
    setPiSdkReady(typeof window !== "undefined" && !!window.Pi);
    const boot = async () => {
      try {
        const [{ data: userResult }] = await Promise.all([
          supabase.auth.getUser(),
        ]);

        const piUid = String(userResult.user?.user_metadata?.pi_uid || "").trim();
        const piUsername = String(userResult.user?.user_metadata?.pi_username || "").trim();
        const cachedUid = getAppCookie("openpay_pi_uid");
        const cachedUsername = getAppCookie("openpay_pi_username");

        const resolvedUid = piUid || cachedUid || "";
        const resolvedUsername = piUsername || cachedUsername || "";

        if (resolvedUid) setReceiverUid(resolvedUid);
        if (resolvedUsername) setReceiverUsername(resolvedUsername);

        setConfigReady(true);
      } catch {
        setConfigReady(false);
      }
    };
    void boot();
  }, []);

  const verifyPiAccessToken = async (accessToken: string) => {
    const { data, error } = await supabase.functions.invoke("pi-platform", {
      body: { action: "auth_verify", accessToken },
    });
    if (error) throw new Error(await getFunctionErrorMessage(error, "Pi auth verification failed"));
    const payload = data as { success?: boolean; data?: { uid?: string; username?: string }; error?: string } | null;
    if (!payload?.success || !payload.data?.uid) throw new Error(payload?.error || "Pi auth verification failed");
    return { uid: String(payload.data.uid), username: String(payload.data.username || "") };
  };

  const refreshPiAuth = async () => {
    if (!window.Pi) {
      toast.error("Pi SDK not available. Open in Pi Browser.");
      return;
    }
    setAuthRefreshing(true);
    try {
      window.Pi.init({ version: "2.0", sandbox: String(import.meta.env.VITE_PI_SANDBOX || "false").toLowerCase() === "true" });
      const auth = await window.Pi.authenticate(["username", "payments"]);
      const verified = await verifyPiAccessToken(auth.accessToken);
      const username = verified.username || auth.user.username;
      await supabase.auth.updateUser({
        data: {
          pi_uid: verified.uid,
          pi_username: username,
          pi_connected_at: new Date().toISOString(),
        },
      });
      setAppCookie("openpay_pi_uid", verified.uid);
      setAppCookie("openpay_pi_username", username);
      setAppCookie("openpay_pi_connected_at", new Date().toISOString());
      setReceiverUid(verified.uid);
      setReceiverUsername(username);
      toast.success(`Linked as @${username}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pi auth failed");
    } finally {
      setAuthRefreshing(false);
    }
  };

  const handleRequestPayout = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Please sign in before requesting a payout.");
      return;
    }

    if (!piSdkReady) {
      toast.error("Pi SDK not available. Open this in Pi Browser.");
      return;
    }

    // Always refresh Pi auth before A2U, like Top Up.
    await refreshPiAuth();

    if (!receiverUid.trim()) {
      toast.error("Missing Pi UID. Authenticate with Pi first.");
      return;
    }
    if (!configReady) {
      toast.error("A2U server config is incomplete");
      return;
    }

    setLoading(true);
    setPaymentId("");
    setTxid("");
    setExplorerLink("");
    setPaymentData(null);

    try {
      const payoutMemo = memo.trim() || "OpenPay Testnet payout";

      // Step 1: Create A2U payment
      toast.info("Step 1/3: Creating payment...");
      const createResult = await callPiPlatform(
        {
          action: "a2u_create",
          payment: {
            uid: receiverUid.trim(),
            amount: fixedPayoutAmount,
            memo: payoutMemo,
            metadata: {
              feature: "a2u_withdraw",
              requested_at: new Date().toISOString(),
              app: "OpenPay",
            },
          },
        },
        "Failed to create A2U payment",
      );

      const createdPaymentId = String(createResult.paymentId || "").trim();
      if (!createdPaymentId) throw new Error("No payment ID returned from create step");
      setPaymentId(createdPaymentId);

      // Step 2: Submit payment to blockchain
      toast.info("Step 2/3: Submitting to blockchain...");
      const submitResult = await callPiPlatform(
        { action: "a2u_submit", paymentId: createdPaymentId },
        "Failed to submit A2U payment",
      );

      const submittedTxid = String(submitResult.txid || "").trim();
      if (!submittedTxid) throw new Error("No txid returned from submit step");
      setTxid(submittedTxid);

      // Step 3: Complete payment
      toast.info("Step 3/3: Completing payment...");
      const completeResult = await callPiPlatform(
        { action: "a2u_complete", paymentId: createdPaymentId, txid: submittedTxid },
        "Failed to complete A2U payment",
      );

      const finalPayment = (completeResult.payment || {}) as PiPaymentData;
      const finalLink = String(finalPayment.transaction?._link || "").trim();

      setExplorerLink(finalLink);
      setPaymentData(finalPayment);
      toast.success("Payout completed successfully!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payout request failed");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = () => {
    if (!paymentData?.status) return null;

    const { status } = paymentData;
    
    if (status.cancelled || status.user_cancelled) {
      return <Badge variant="destructive">Cancelled</Badge>;
    }
    
    if (status.developer_completed && status.transaction_verified) {
      return <Badge variant="default" className="bg-green-500">Completed</Badge>;
    }
    
    if (status.developer_completed && !status.transaction_verified) {
      return <Badge variant="secondary">Pending Verification</Badge>;
    }
    
    if (status.developer_approved) {
      return <Badge variant="outline">In Progress</Badge>;
    }
    
    return <Badge variant="outline">Created</Badge>;
  };

  return (
    <div className="min-h-screen bg-background px-4 pb-24 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => navigate("/menu")}
          className="paypal-surface flex h-10 w-10 items-center justify-center rounded-full"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-paypal-dark">A2U Request Payout</h1>
          <p className="text-xs text-muted-foreground">Testnet app-to-user payout modal</p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/30 bg-gradient-to-br from-paypal-blue to-[#0073e6] p-5 text-white shadow-xl shadow-[#004bba]/20">
        <div className="flex items-center gap-2">
          <HandCoins className="h-4 w-4" />
          <p className="text-sm font-semibold uppercase tracking-wide">Testnet Payout</p>
        </div>
        <p className="mt-2 text-sm text-white/90">
          Open the modal and request a payout using your Pi UID. This runs create, approve, and complete via A2U API.
        </p>
        <Button
          type="button"
          className="mt-4 h-12 w-full rounded-2xl bg-white text-lg font-bold text-paypal-blue hover:bg-white/90"
          onClick={() => setShowPayoutModal(true)}
        >
          Request Testnet Payout
        </Button>
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full rounded-2xl border-white/60 bg-white/10 font-semibold text-white hover:bg-white/20"
          onClick={() => navigate("/topup")}
        >
          Request Top Up
        </Button>
      </div>

      {paymentData && paymentId && (
        <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-paypal-dark">Latest Payment</h3>
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowStatusModal(true)}
              >
                View Details
              </Button>
            </div>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-medium">{paymentData.amount || fixedPayoutAmount} Pi</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Network:</span>
              <span className="font-medium">{paymentData.network || "Testnet"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment ID:</span>
              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                {paymentId.slice(0, 8)}...{paymentId.slice(-8)}
              </span>
            </div>
            {txid && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Transaction:</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                    {txid.slice(0, 8)}...{txid.slice(-8)}
                  </span>
                  {explorerLink && (
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                    >
                      <a
                        href={explorerLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav active="menu" />

      <Dialog open={showPayoutModal} onOpenChange={setShowPayoutModal}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[32px] border-0 bg-[#f5f5f7] p-6 sm:max-w-[520px]">
          <DialogTitle className="text-3xl font-bold text-paypal-dark sm:text-5xl">Testnet Payouts</DialogTitle>
          <DialogDescription className="pt-1 text-base text-slate-500">
            Click the button below to receive a 0.01 Pi app-to-user payout to your testnet Pi wallet. You must be
            authenticated in Pi Browser to continue.
          </DialogDescription>

          {receiverUid ? (
            <p className="text-xs text-slate-500">
              Connected as {receiverUsername ? `@${receiverUsername}` : "Pi user"} ({receiverUid})
            </p>
          ) : (
            <p className="text-xs text-destructive">
              Pi account not linked. Authenticate with Pi Browser to continue.
            </p>
          )}

          <Button
            type="button"
            className="h-12 w-full rounded-2xl bg-paypal-blue text-xl font-bold text-white hover:bg-[#004dc5] sm:h-14 sm:text-3xl"
            disabled={loading || !configReady || !receiverUid}
            onClick={handleRequestPayout}
          >
            {loading ? "Submitting..." : "Receive your 0.01 Testnet Pi"}
          </Button>

          {!receiverUid && (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-2xl border-paypal-blue/25 bg-white text-base font-semibold text-paypal-blue hover:bg-slate-100"
              onClick={piSdkReady ? refreshPiAuth : () => {
                setShowPayoutModal(false);
                navigate("/auth");
              }}
              disabled={authRefreshing}
            >
              {authRefreshing ? "Linking Pi..." : "Authenticate with Pi"}
            </Button>
          )}

          {(paymentId || txid) && (
            <div className="space-y-2 text-sm text-slate-500">
              <p className="break-all">Payout submitted - tx: {txid || "Pending txid from Pi API"}</p>
              <p className="break-all">Payment ID: {paymentId || "-"}</p>
              {explorerLink && (
                <a
                  href={explorerLink}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-paypal-blue underline underline-offset-2"
                >
                  {explorerLink}
                </a>
              )}
            </div>
          )}

          {!configReady && (
            <p className="text-sm text-destructive">
              A2U server config missing. Set Pi secrets in Supabase function environment and redeploy `pi-platform`.
            </p>
          )}

          {!piSdkReady && (
            <p className="text-sm text-slate-500">
              Pi SDK not detected. Open this page in Pi Browser to authenticate.
            </p>
          )}

          <p className="text-sm text-slate-600">
            This is for OpenPay developer payouts testing (A2U). Only 0.01 pi per click is allowed.
          </p>

          <Button
            type="button"
            className="h-14 w-full rounded-2xl bg-paypal-blue text-3xl font-bold text-white hover:bg-[#004dc5]"
            onClick={() => setShowPayoutModal(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-2xl border-paypal-blue/25 bg-white text-base font-semibold text-paypal-blue hover:bg-slate-100"
            onClick={() => {
              setShowPayoutModal(false);
              navigate("/topup");
            }}
          >
            Go to Top Up
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showStatusModal} onOpenChange={setShowStatusModal}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[32px] border-0 bg-[#f5f5f7] p-6 sm:max-w-[520px]">
          <DialogTitle className="text-2xl font-bold text-paypal-dark">Payment Status</DialogTitle>
          {paymentId && (
            <A2UPaymentStatus 
              paymentId={paymentId} 
              onClose={() => setShowStatusModal(false)} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default A2UPaymentsPage;
