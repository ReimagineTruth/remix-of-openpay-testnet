import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import PiNetwork from 'pi-backend';

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

    const { uid, amount, memo, metadata } = req.body || {};
    if (!uid) return res.status(400).json({ error: "Missing uid" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (!memo) return res.status(400).json({ error: "Missing memo" });

    // Validate amount for testnet
    if (Number(amount) > 1) {
      return res.status(400).json({ error: "Testnet payments cannot exceed 1 Pi" });
    }

    // Initialize Pi Network following the exact official documentation setup
    const pi = new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

    // Step 0: Clear incomplete payment if any (following Pi Network best practices)
    const incomplete = await pi.getIncompleteServerPayments();
    if (incomplete && incomplete.length > 0) {
      for (const oldPayment of incomplete) {
        try {
          const oldTxid = oldPayment?.transaction?.txid;
          if (oldTxid) {
            await pi.completePayment(oldPayment.identifier, oldTxid);
          } else {
            await pi.cancelPayment(oldPayment.identifier);
          }
        } catch (cleanupError) {
          console.error(`Failed to cleanup payment ${oldPayment.identifier}:`, cleanupError);
        }
      }
    }

    // Step 1: Create payment (A2U flow)
    const paymentData = {
      amount: Number(amount),
      memo: String(memo),
      metadata: metadata || { feature: "a2u_withdraw" },
      uid,
    };

    const paymentId = await pi.createPayment(paymentData);

    // Store initial payment record
    await upsertA2U({
      payment_id: paymentId,
      pi_uid: uid,
      amount: Number(amount),
      memo: String(memo),
      status: "created",
    });

    // Step 2: Submit to blockchain
    const txid = await pi.submitPayment(paymentId);

    // Update with transaction ID
    await upsertA2U({
      payment_id: paymentId,
      txid,
      status: "submitted",
    });

    // Step 3: Complete payment
    const payment = await pi.completePayment(paymentId, txid);

    // Update with completion status
    await upsertA2U({
      payment_id: paymentId,
      txid,
      status: "completed",
    });

    return res.json({ success: true, paymentId, txid, payment });
  } catch (error) {
    console.error('A2U withdrawal error:', error);
    return res.status(500).json({
      error: error?.message || "A2U withdrawal failed",
      details: error?.response?.data || null
    });
  }
});

// Additional endpoint to get payment status
app.get("/api/a2u-payment/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    if (!PI_API_KEY || !PI_WALLET_PRIVATE_SEED) {
      return res.status(500).json({ error: "PI_API_KEY or PI_WALLET_PRIVATE_SEED missing" });
    }

    const pi = PI_NETWORK
      ? new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED, { network: PI_NETWORK })
      : new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

    const payment = await pi.getPayment(paymentId);
    return res.json({ success: true, payment });
  } catch (error) {
    console.error('Get payment error:', error);
    const status = error?.response?.status || 500;
    return res.status(status).json({
      error: error?.message || "Failed to get payment",
    });
  }
});

// Endpoint to get incomplete payments (for debugging/admin)
app.get("/api/a2u-incomplete", async (req, res) => {
  try {
    if (!PI_API_KEY || !PI_WALLET_PRIVATE_SEED) {
      return res.status(500).json({ error: "PI_API_KEY or PI_WALLET_PRIVATE_SEED missing" });
    }

    const pi = PI_NETWORK
      ? new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED, { network: PI_NETWORK })
      : new PiNetwork(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

    const incompletePayments = await pi.getIncompleteServerPayments();
    return res.json({ success: true, incompletePayments });
  } catch (error) {
    console.error('Get incomplete payments error:', error);
    const status = error?.response?.status || 500;
    return res.status(status).json({
      error: error?.message || "Failed to get incomplete payments",
    });
  }
});

const port = Number(process.env.A2U_SERVER_PORT || 8788);
app.listen(port, () => {
  console.log(`A2U server running on http://localhost:${port}`);
});
