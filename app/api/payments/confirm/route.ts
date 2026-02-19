export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { sendAdminSms } from "@/lib/sms";
import crypto from "crypto";

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

// 010-1234-5678 / 010 1234 5678 / +82... -> digits만 남기고 010... 우선 정리
function normalizeKoreanPhone(input: string) {
  const digits = (input || "").replace(/\D/g, "");
  if (!digits) return "";
  // +82 10xxxx -> 8210xxxx 또는 8210... 형태면 0으로 시작하게 변환
  if (digits.startsWith("82")) {
    const rest = digits.slice(2);
    if (rest.startsWith("10")) return "0" + rest; // 010...
    return rest; // 혹시 다른 케이스
  }
  return digits; // 보통 010XXXXXXXX
}

async function sendSms(toRaw: string, text: string) {
  const API_KEY = process.env.SOLAPI_API_KEY;
  const API_SECRET = process.env.SOLAPI_API_SECRET;
  const FROM = process.env.SMS_FROM;

  if (!API_KEY || !API_SECRET) throw new Error("Missing SOLAPI_API_KEY/SOLAPI_API_SECRET");
  if (!FROM) throw new Error("Missing SMS_FROM");

  const to = normalizeKoreanPhone(toRaw);
  if (!to) throw new Error("Missing/invalid customer phone");

  const url = "https://api.solapi.com/messages/v4/send";
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", API_SECRET).update(date + salt).digest("hex");

  const payload = {
    message: { to, from: FROM, text, type: "SMS" as const },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await resp.json();

  if (!resp.ok) {
    console.error("[SOLAPI] send failed", { status: resp.status, json });
    throw new Error(json?.errorMessage ?? json?.message ?? "SOLAPI send failed");
  }

  console.log("[SOLAPI] send ok", json);
  return json;
}

export async function POST(req: Request) {
  const { paymentKey, orderId, amount } = (await req.json()) as Body;

  if (!paymentKey || !orderId || !Number.isFinite(Number(amount))) {
    return NextResponse.json({ ok: false, error: "Missing paymentKey/orderId/amount" }, { status: 400 });
  }

  // 1) 예약 찾기 + 검증
  const { data: booking, error: bErr } = await supabaseServer
    .from("bookings")
    .select("id, status, amount, start_at, end_at, room_id, customer_phone, customer_name, rooms:room_id(name)")
    .eq("order_id", orderId)
    .single();

  if (bErr || !booking) {
    console.error("[CONFIRM] booking fetch error", bErr);
    return NextResponse.json({ ok: false, error: bErr?.message ?? "Booking not found" }, { status: 500 });
  }

  if (booking.status !== "PENDING") {
    return NextResponse.json({ ok: false, error: "Not in PENDING state" }, { status: 400 });
  }

  if (Number(booking.amount) !== Number(amount)) {
    return NextResponse.json({ ok: false, error: "Amount mismatch" }, { status: 400 });
  }

  const roomName = (booking as any)?.rooms?.name ?? "(룸정보없음)";

  // 2) 토스 confirm
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ ok: false, error: "Missing TOSS_SECRET_KEY" }, { status: 500 });

  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  const resp = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const json = await resp.json();

  if (!resp.ok) {
    await supabaseServer.from("bookings").update({ status: "CANCELED" }).eq("id", booking.id);
    return NextResponse.json({ ok: false, error: json?.message ?? "Toss confirm failed", detail: json }, { status: 400 });
  }

  // 3) 예약 확정
  const { error: uErr } = await supabaseServer
    .from("bookings")
    .update({ status: "CONFIRMED", payment_key: paymentKey, paid_at: new Date().toISOString() })
    .eq("id", booking.id);

  if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

  const start = booking.start_at ? fmtKst(booking.start_at) : "(시작없음)";
  const end = booking.end_at ? fmtKst(booking.end_at) : "(종료없음)";

  // 4) 운영자 SMS
  try {
    await sendAdminSms(
      `[Abbeyroad Studio] 예약 확정\n` +
        `룸: ${roomName}\n` +
        `시간: ${start} ~ ${end}\n` +
        `금액: ${Number(amount).toLocaleString()}원\n` +
        `예약ID: ${booking.id}\n` +
        `※ 24:00 마감 / 심야 유선문의`
    );
  } catch (e) {
    console.error("[SMS] admin send failed", e);
  }

  // 5) 고객 SMS (여기서 실패 원인을 로그로 확실히 남김)
  try {
    const toRaw = (booking.customer_phone ?? "").trim();
    if (!toRaw) {
      console.warn("[SMS] customer_phone empty; skip", { bookingId: booking.id, orderId });
    } else {
      await sendSms(
        toRaw,
        `[Abbeyroad Studio] 예약이 확정되었습니다.\n` +
          `룸: ${roomName}\n` +
          `시간: ${start} ~ ${end}\n` +
          `금액: ${Number(amount).toLocaleString()}원\n` +
          `주문번호: ${orderId}\n` +
          `※ 24:00 마감 / 심야 유선문의`
      );
    }
  } catch (e) {
    console.error("[SMS] customer send failed", e);
  }

  return NextResponse.json({ ok: true });
}
