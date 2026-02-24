import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as StellarSdk from "https://esm.sh/@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const parseJson = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
};

const callPiApi = async (
  endpoint: string,
  method: "GET" | "POST",
  apiKey: string,
  body?: Record<string, unknown>,
) => {
  const res = await fetch(`https://api.minepi.com/v2${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = parseJson(await res.text());
  if (!res.ok) {
    throw new Error(
      (data.error as string) || `Pi API failed (${res.status})`,
    );
  }
  return data;
};

// ---------- Stellar A2U transaction builder ----------

type PaymentInfo = {
  amount: number;
  identifier: string;
  from_address: string;
  to_address: string;
  network: string;
};

const HORIZON_URLS: Record<string, string> = {
  "Pi Network": "https://api.mainnet.minepi.com",
  "Pi Testnet": "https://api.testnet.minepi.com",
};

const buildAndSubmitA2U = async (
  payment: PaymentInfo,
  walletPrivateSeed: string,
) => {
  const keypair = StellarSdk.Keypair.fromSecret(walletPrivateSeed);

  if (payment.from_address !== keypair.publicKey()) {
    throw new Error(
      "Wallet private seed does not match the payment from_address. " +
        `Expected public key for from_address ${payment.from_address}, ` +
        `but seed resolves to ${keypair.publicKey()}.`,
    );
  }

  const horizonUrl = HORIZON_URLS[payment.network] || HORIZON_URLS["Pi Testnet"];
  const horizon = new StellarSdk.Horizon.Server(horizonUrl);

  const myAccount = await horizon.loadAccount(keypair.publicKey());
  const baseFee = await horizon.fetchBaseFee();

  const tx = new StellarSdk.TransactionBuilder(myAccount, {
    fee: baseFee.toString(),
    networkPassphrase: payment.network,
    timebounds: await horizon.fetchTimebounds(180),
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: payment.to_address,
        asset: StellarSdk.Asset.native(),
        amount: payment.amount.toString(),
      }),
    )
    .addMemo(StellarSdk.Memo.text(payment.identifier))
    .build();

  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);

  // The Horizon response has `id` as the txid
  const txid = (result as unknown as { id?: string }).id;
  if (!txid) throw new Error("Horizon did not return a transaction id");
  return txid;
};

// ---------- Main handler ----------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, paymentId, txid, accessToken, adId, payment } = await req.json();
    if (!action || typeof action !== "string") {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    // ── auth_verify: no Supabase session required ──
    if (action === "auth_verify") {
      if (!accessToken || typeof accessToken !== "string") {
        return jsonResponse({ error: "Missing accessToken" }, 400);
      }

      const piResponse = await fetch("https://api.minepi.com/v2/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = parseJson(await piResponse.text());
      if (!piResponse.ok) {
        console.error("Pi auth_verify failed", piResponse.status, data);
        return jsonResponse({ error: "Pi auth verification failed", status: piResponse.status, data }, 400);
      }

      const uid = typeof data.uid === "string" ? data.uid : null;
      const username = typeof data.username === "string" ? data.username : null;
      if (!uid) return jsonResponse({ error: "Pi auth response missing uid" }, 400);

      return jsonResponse({ success: true, data: { uid, username } });
    }

    // ── All other actions need a valid Supabase session ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Missing auth token" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("PI_API_KEY");
    if (!apiKey) return jsonResponse({ error: "PI_API_KEY is not configured" }, 500);

    // ── ad_verify ──
    if (action === "ad_verify") {
      if (!adId || typeof adId !== "string") return jsonResponse({ error: "Missing adId" }, 400);
      const data = await callPiApi(`/ads_network/status/${adId}`, "GET", apiKey);
      const rewarded = (data.mediator_ack_status as string) === "granted";
      return jsonResponse({ success: true, rewarded, data });
    }

    // ── a2u_config_status ──
    if (action === "a2u_config_status") {
      return jsonResponse({
        success: true,
        data: {
          hasApiKey: Boolean(apiKey),
          hasValidationKey: Boolean(Deno.env.get("PI_VALIDATION_KEY")),
          hasWalletPrivateSeed: Boolean(Deno.env.get("PI_WALLET_PRIVATE_SEED")),
          hasWalletPublicAddress: Boolean(Deno.env.get("PI_WALLET_PUBLIC_ADDRESS")),
        },
      });
    }

    // ── a2u_create: create an A2U payment ──
    if (action === "a2u_create") {
      if (!payment || typeof payment !== "object") {
        return jsonResponse({ error: "Missing payment payload" }, 400);
      }

      const body = payment as Record<string, unknown>;
      const amount = Number(body.amount);
      const uid = typeof body.uid === "string" ? body.uid.trim() : "";
      const memo = typeof body.memo === "string" ? body.memo.trim() : "";

      if (!Number.isFinite(amount) || amount <= 0) return jsonResponse({ error: "Invalid payment.amount" }, 400);
      if (!uid) return jsonResponse({ error: "Missing payment.uid" }, 400);
      if (!memo) return jsonResponse({ error: "Missing payment.memo" }, 400);

      const data = await callPiApi("/payments", "POST", apiKey, { payment: body });
      return jsonResponse({ success: true, data });
    }

    // ── a2u_submit: build Stellar tx & submit to blockchain ──
    if (action === "a2u_submit") {
      if (!paymentId || typeof paymentId !== "string") {
        return jsonResponse({ error: "Missing paymentId" }, 400);
      }

      const walletSeed = Deno.env.get("PI_WALLET_PRIVATE_SEED");
      if (!walletSeed) return jsonResponse({ error: "PI_WALLET_PRIVATE_SEED not configured" }, 500);

      // Fetch the payment to get addresses and network
      const paymentData = await callPiApi(`/payments/${paymentId}`, "GET", apiKey) as unknown as PaymentInfo;

      const submitTxid = await buildAndSubmitA2U(paymentData, walletSeed);

      return jsonResponse({ success: true, txid: submitTxid, paymentId });
    }

    // ── a2u_incomplete ──
    if (action === "a2u_incomplete") {
      const data = await callPiApi("/payments/incomplete_server_payments", "GET", apiKey);
      return jsonResponse({ success: true, data });
    }

    // ── Generic payment actions (approve, complete, cancel, get) ──
    if (!paymentId || typeof paymentId !== "string") {
      return jsonResponse({ error: "Missing paymentId" }, 400);
    }

    const endpointBase = `/payments/${paymentId}`;
    let endpoint = endpointBase;
    let method: "GET" | "POST" = "POST";
    let body: Record<string, unknown> | undefined;

    if (action === "approve" || action === "payment_approve" || action === "a2u_approve") {
      endpoint = `${endpointBase}/approve`;
    } else if (action === "complete" || action === "payment_complete" || action === "a2u_complete") {
      endpoint = `${endpointBase}/complete`;
      if (txid && typeof txid === "string") body = { txid };
    } else if (action === "cancel" || action === "payment_cancel" || action === "a2u_cancel") {
      endpoint = `${endpointBase}/cancel`;
    } else if (action === "get" || action === "payment_get" || action === "a2u_get") {
      endpoint = endpointBase;
      method = "GET";
    } else {
      return jsonResponse({ error: "Invalid action" }, 400);
    }

    const data = await callPiApi(endpoint, method, apiKey, body);
    return jsonResponse({ success: true, data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("pi-platform error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
