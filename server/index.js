import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import piBackend from 'pi-backend';
const PiNetworkSDK = piBackend.default;

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

app.post("/api/withdraw", async (req, res) => {
    const logs = [];
    
    const log = (message) => {
      logs.push(message);
      console.log(message);
    };

    try {
      log("Starting A2U payment process...");
      
      if (!PI_API_KEY || !PI_WALLET_PRIVATE_SEED) {
        log("ERROR: PI_API_KEY or PI_WALLET_PRIVATE_SEED missing");
        return res.status(500).json({ error: "PI_API_KEY or PI_WALLET_PRIVATE_SEED missing", logs });
      }

      const { uid, amount, memo, metadata } = req.body || {};
      if (!uid) {
        log("ERROR: Missing uid");
        return res.status(400).json({ error: "Missing uid", logs });
      }
      if (!amount || Number(amount) <= 0) {
        log("ERROR: Invalid amount");
        return res.status(400).json({ error: "Invalid amount", logs });
      }
      if (!memo) {
        log("ERROR: Missing memo");
        return res.status(400).json({ error: "Missing memo", logs });
      }

      // Validate amount for testnet
      if (Number(amount) > 1) {
        log("ERROR: Testnet payments cannot exceed 1 Pi");
        return res.status(400).json({ error: "Testnet payments cannot exceed 1 Pi", logs });
      }

      log(`Initializing Pi Network SDK for user: ${uid}`);
      // Initialize Pi Network following the exact official documentation setup
      const pi = new PiNetworkSDK(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

      // Step 0: Clear incomplete payment if any (following Pi Network best practices)
      log("Checking for incomplete payments...");
      const incomplete = await pi.getIncompleteServerPayments();
      if (incomplete && incomplete.length > 0) {
        log(`Found ${incomplete.length} incomplete payments, cleaning up...`);
        for (const oldPayment of incomplete) {
          try {
            const oldTxid = oldPayment?.transaction?.txid;
            if (oldTxid) {
              await pi.completePayment(oldPayment.identifier, oldTxid);
              log(`Completed payment ${oldPayment.identifier}`);
            } else {
              await pi.cancelPayment(oldPayment.identifier);
              log(`Cancelled payment ${oldPayment.identifier}`);
            }
          } catch (cleanupError) {
            log(`Failed to cleanup payment ${oldPayment.identifier}: ${cleanupError.message}`);
          }
        }
      } else {
        log("No incomplete payments found");
      }

      // Step 1: Create payment (A2U flow)
      log("Step 1/3: Creating payment...");
      const paymentData = {
        amount: Number(amount),
        memo: String(memo),
        metadata: metadata || { feature: "a2u_withdraw" },
        uid,
      };

      const paymentId = await pi.createPayment(paymentData);
      log(`Payment created with ID: ${paymentId}`);

      // Store initial payment record
      await upsertA2U({
        payment_id: paymentId,
        pi_uid: uid,
        amount: Number(amount),
        memo: String(memo),
        status: "created",
      });
      log("Payment record stored in database");

      // Step 2: Submit to blockchain
      log("Step 2/3: Submitting to blockchain...");
      const txid = await pi.submitPayment(paymentId);
      log(`Transaction submitted with TXID: ${txid}`);

      // Update with transaction ID
      await upsertA2U({
        payment_id: paymentId,
        txid,
        status: "submitted",
      });
      log("Transaction record updated in database");

      // Step 3: Complete payment
      log("Step 3/3: Completing payment...");
      const payment = await pi.completePayment(paymentId, txid);
      log("Payment completed successfully");

      // Update with completion status
      await upsertA2U({
        payment_id: paymentId,
        txid,
        status: "completed",
      });
      log("Payment status updated in database");

      return res.json({ 
        success: true, 
        logs,
        payment: {
          paymentId,
          txid,
          ...payment
        }
      });
  } catch (error) {
    const errorMessage = error?.message || "A2U withdrawal failed";
    logs.push(`ERROR: ${errorMessage}`);
    console.error('A2U withdrawal error:', error);
    return res.status(500).json({
      error: errorMessage,
      details: error?.response?.data || null,
      logs
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
      ? new PiNetworkSDK(PI_API_KEY, PI_WALLET_PRIVATE_SEED, { network: PI_NETWORK })
      : new PiNetworkSDK(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

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
      ? new PiNetworkSDK(PI_API_KEY, PI_WALLET_PRIVATE_SEED, { network: PI_NETWORK })
      : new PiNetworkSDK(PI_API_KEY, PI_WALLET_PRIVATE_SEED);

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
