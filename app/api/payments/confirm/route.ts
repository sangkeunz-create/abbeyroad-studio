import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = { paymentKey: string; orderId: string; amount: number };

export async function POST(req: Request) {
  const { paymentKey, orderId, amount } = (await req.json()) as Body;

  if (!paymentKey || !orderId || !Number.isFinite(Number(amount))) {
    return NextResponse.json({ ok: false, error: "Missing paymentKey/orderId/amount" }, { status: 400 });
  }

  // 1) 우리 DB의 PENDING 예약 찾기 + 금액 검증
  const { data: booking, error: bErr } = await supabaseServer
    .from("bookings")
    .select("id, status, amount")
    .eq("order_id", orderId)
    .single();

  if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
  if (booking.status !== "PENDING") return NextResponse.json({ ok: false, error: "Not in PENDING state" }, { status: 400 });
  if (Number(booking.amount) !== Number(amount)) {
    return NextResponse.json({ ok: false, error: "Amount mismatch" }, { status: 400 });
  }

  // 2) 토스 결제 승인(서버에서 secretKey로 confirm)
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ ok: false, error: "Missing TOSS_SECRET_KEY" }, { status: 500 });

  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  const resp = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const json = await resp.json();

  if (!resp.ok) {
    // 실패면 예약 취소 처리
    await supabaseServer.from("bookings").update({ status: "CANCELED" }).eq("id", booking.id);
    return NextResponse.json({ ok: false, error: json?.message ?? "Toss confirm failed", detail: json }, { status: 400 });
  }

  // 3) 성공이면 예약 확정
  const { error: uErr } = await supabaseServer
    .from("bookings")
    .update({ status: "CONFIRMED", payment_key: paymentKey, paid_at: new Date().toISOString() })
    .eq("id", booking.id);

  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
