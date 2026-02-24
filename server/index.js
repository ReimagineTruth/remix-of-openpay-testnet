import "dotenv/config";
import express from "express";
import cors from "cors";
import PiNetwork from "pi-backend";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const {
  PI_API_KEY,
  PI_WALLET_PRIVATE_SEED,
  PI_NETWORK,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const upsertA2U = async (record) => {
  if (!supabase) return;
  await supabase.from("pi_a2u_payouts").upsert(record, { onConflict: "payment_id" });
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/a2u-withdraw", async (req, res) => {
  try {
    if (!PI_API_KEY || !PI_WALLET_PRIVATE_SEED) {
      return res.status(500).json({ error: "PI_API_KEY or PI_WALLET_PRIVATE_SEED missing" });
    }

    const { uid, amount, memo } = req.body || {};
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });

    const pi = PI_NETWORK
      ? new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED, { network: PI_NETWORK })
      : new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

    // 1) Clear incomplete payment if any
    const incomplete = await pi.getIncompleteServerPayments();
    if (incomplete && incomplete.length > 0) {
      const old = incomplete[0];
      const oldTxid = old?.transaction?.txid;
      if (oldTxid) {
        await pi.completePayment(old.identifier, oldTxid);
      } else {
        await pi.cancelPayment(old.identifier);
      }
    }

    // 2) Create payment
    const paymentId = await pi.createPayment({
      amount: Number(amount),
      memo: String(memo || "A2U payout"),
      metadata: { feature: "a2u_withdraw", requested_at: new Date().toISOString() },
      uid,
    });

    await upsertA2U({
      payment_id: paymentId,
      pi_uid: uid,
      amount: Number(amount),
      memo: String(memo || "A2U payout"),
      status: "created",
    });

    // 3) Wait a bit for Pi server to register
    await sleep(1000);

    // 4) Submit to blockchain
    const txid = await pi.submitPayment(paymentId);

    await upsertA2U({
      payment_id: paymentId,
      txid,
      status: "submitted",
    });

    // 5) Complete payment
    const payment = await pi.completePayment(paymentId, txid);

    await upsertA2U({
      payment_id: paymentId,
      txid,
      status: "completed",
    });

    return res.json({ success: true, paymentId, txid, payment });
  } catch (error) {
    const status = error?.response?.status || 500;
    const data = error?.response?.data || null;
    return res.status(status).json({
      error: error?.message || "A2U withdrawal failed",
      data,
    });
  }
});

const port = Number(process.env.A2U_SERVER_PORT || 8788);
app.listen(port, () => {
  console.log(`A2U server running on http://localhost:${port}`);
});
