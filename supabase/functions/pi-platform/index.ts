import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PiNetwork from "https://esm.sh/pi-backend@0.1.3";

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
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const safeUpsertA2UPayout = async (
  supabase: any,
  record: Record<string, unknown>,
) => {
  try {
    const payload = { ...record, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from("pi_a2u_payouts")
      .upsert(payload, { onConflict: "payment_id" });
    if (error) {
      console.warn("pi_a2u_payouts upsert error:", error.message);
    }
  } catch (err: any) {
    console.warn("pi_a2u_payouts upsert failed:", err?.message || String(err));
  }
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
      if (!piResponse.ok || !data) {
        console.error("Pi auth_verify failed", piResponse.status, data);
        return jsonResponse({ error: "Pi auth verification failed", status: piResponse.status, data }, 400);
      }

      const uid = typeof (data as any).uid === "string" ? (data as any).uid : null;
      const username = typeof (data as any).username === "string" ? (data as any).username : null;
      const walletAddress = typeof (data as any).wallet_address === "string" ? (data as any).wallet_address : null;
      if (!uid) return jsonResponse({ error: "Pi auth response missing uid" }, 400);

      return jsonResponse({ success: true, data: { uid, username, wallet_address: walletAddress } });
    }

    // ── All other actions need a valid Supabase session ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Missing auth token" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const apiKey = Deno.env.get("PI_API_KEY");
    const walletPrivateSeed = Deno.env.get("PI_WALLET_PRIVATE_SEED");
    if (!apiKey || !walletPrivateSeed) {
      return jsonResponse({ error: "PI_API_KEY or PI_WALLET_PRIVATE_SEED is not configured" }, 500);
    }

    // Initialize Pi Network following the exact official documentation setup
    const pi = new PiNetwork(apiKey, walletPrivateSeed);

    // ── ad_verify ──
    if (action === "ad_verify") {
      if (!adId || typeof adId !== "string") return jsonResponse({ error: "Missing adId" }, 400);
      const res = await fetch(`https://api.minepi.com/v2/ads_network/status/${adId}`, {
        headers: { Authorization: `Key ${apiKey}` }
      });
      const data = await res.json();
      const rewarded = data?.mediator_ack_status === "granted";
      return jsonResponse({ success: true, rewarded, data });
    }

    // ── a2u_config_status ──
    if (action === "a2u_config_status") {
      return jsonResponse({
        success: true,
        data: {
          hasApiKey: Boolean(apiKey),
          hasValidationKey: Boolean(Deno.env.get("PI_VALIDATION_KEY")),
          hasWalletPrivateSeed: Boolean(walletPrivateSeed),
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

      // Handle incomplete payments
      const incomplete = await pi.getIncompleteServerPayments();
      if (incomplete && incomplete.length > 0) {
        for (const old of incomplete) {
          try {
            if (old.transaction?.txid) {
              await pi.completePayment(old.identifier, old.transaction.txid);
            } else {
              await pi.cancelPayment(old.identifier);
            }
          } catch (e) {
            console.error(`Failed cleanup for ${old.identifier}`, e);
          }
        }
      }

      // Create payment
      const createdPaymentId = await pi.createPayment({
        amount,
        memo,
        metadata: body.metadata || { feature: "a2u_withdraw" },
        uid
      });

      if (createdPaymentId) {
        await safeUpsertA2UPayout(supabase, {
          payment_id: createdPaymentId,
          pi_uid: uid,
          amount,
          memo,
          status: "created",
          created_by: user.id,
        });
      }

      return jsonResponse({ success: true, paymentId: createdPaymentId });
    }

    // ── a2u_submit: build Stellar tx & submit to blockchain ──
    if (action === "a2u_submit") {
      if (!paymentId || typeof paymentId !== "string") {
        return jsonResponse({ error: "Missing paymentId" }, 400);
      }

      const submitTxid = await pi.submitPayment(paymentId);
      
      await safeUpsertA2UPayout(supabase, {
        payment_id: paymentId,
        txid: submitTxid,
        status: "submitted",
        updated_by: user.id,
      });

      return jsonResponse({ success: true, txid: submitTxid });
    }

    // ── a2u_complete: complete payment ──
    if (action === "a2u_complete") {
      if (!paymentId || typeof paymentId !== "string") return jsonResponse({ error: "Missing paymentId" }, 400);
      if (!txid || typeof txid !== "string") return jsonResponse({ error: "Missing txid" }, 400);

      const completed = await pi.completePayment(paymentId, txid);

      await safeUpsertA2UPayout(supabase, {
        payment_id: paymentId,
        txid,
        status: "completed",
        updated_by: user.id,
      });

      return jsonResponse({ success: true, payment: completed });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("pi-platform error:", message);
    return jsonResponse({
      error: message,
      details: (error as any)?.data || (error as any)?.response?.data || null
    }, 500);
  }
});
