export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendAdminSms } from "@/lib/sms";

type Body = { paymentKey: string; orderId: string; amount: number };

function fmtKst(iso: string) {
  const d = new Date(iso);
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = k.getUTCFullYear();
  const mm = String(k.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(k.getUTCDate()).padStart(2, "0");
  const hh = String(k.getUTCHours()).padStart(2, "0");
  const mi = String(k.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export async function POST(req: Request) {
  const { paymentKey, orderId, amount } = (await req.json()) as Body;

  if (!paymentKey || !orderId || !Number.isFinite(Number(amount))) {
    return NextResponse.json(
      { ok: false, error: "Missing paymentKey/orderId/amount" },
      { status: 400 }
    );
  }

  // 1) 우리 DB의 PENDING 예약 찾기 + 금액 검증
  const { data: booking, error: bErr } = await supabaseServer
    .from("bookings")
    // ✅ 문자에 필요한 정보까지 같이 가져오기 (컬럼명은 네 DB에 맞게 조정)
    .select("id, status, amount, room_id, start_at, end_at, customer_phone, rooms(name)")

    .eq("order_id", orderId)
    .single();

  if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
  if (booking.status !== "PENDING")
    return NextResponse.json({ ok: false, error: "Not in PENDING state" }, { status: 400 });

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
    return NextResponse.json(
      { ok: false, error: json?.message ?? "Toss confirm failed", detail: json },
      { status: 400 }
    );
  }

  // 3) 성공이면 예약 확정
  const { error: uErr } = await supabaseServer
    .from("bookings")
    .update({ status: "CONFIRMED", payment_key: paymentKey, paid_at: new Date().toISOString() })
    .eq("id", booking.id);

  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

  // ✅ 4) 확정된 직후 운영자 SMS 발송 (실패해도 예약확정은 유지)
  try {
    const roomName = booking.rooms?.name ?? "(룸정보없음)";

    const start = booking.start_at ? fmtKst(booking.start_at) : "(시작없음)";
    const end = booking.end_at ? fmtKst(booking.end_at) : "(종료없음)";

    await sendAdminSms(
      `[Abbeyroad Studio] 예약 확정\n` +
        `룸: ${roomName}\n` +
        `시간: ${start} ~ ${end}\n` +
        `금액: ${Number(amount).toLocaleString()}원\n` +
        `예약ID: ${booking.id}\n` +
        `※ 24:00 마감 / 심야 유선문의`
    );
  } catch (e) {
    console.error("[SMS] send failed", e);
  }

  return NextResponse.json({ ok: true });
}
