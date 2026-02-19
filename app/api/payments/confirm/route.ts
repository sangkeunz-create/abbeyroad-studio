export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import crypto from "crypto";

type Body = { paymentKey: string; orderId: string; amount: number };

// ---------- utils ----------
function normalizeKoreanPhone(raw?: string | null) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.startsWith("82")) return digits; // already international
  if (digits.startsWith("0")) return "82" + digits.slice(1);
  // e.g. "1094..." 같은 형태면 82 붙이기
  if (digits.length >= 9) return "82" + digits;
  return "";
}

function fmtKstDate(isoUtc: string) {
  // YYYY-MM-DD
  const d = new Date(isoUtc);
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = k.getUTCFullYear();
  const mm = String(k.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(k.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtKstTime(isoUtc: string) {
  // HH:mm
  const d = new Date(isoUtc);
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(k.getUTCHours()).padStart(2, "0");
  const mi = String(k.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

/**
 * SOLAPI 전송: 내용 byte 길이에 따라 SMS/LMS 자동 선택
 * - SMS: <= 90 bytes (UTF-8 기준, 한글이면 훨씬 빨리 넘어감)
 * - LMS: 90 bytes 초과
 */
async function sendSolapi(toRaw: string, text: string, subject?: string) {
  const API_KEY = process.env.SOLAPI_API_KEY;
  const API_SECRET = process.env.SOLAPI_API_SECRET;
  const FROM = process.env.SMS_FROM;

  if (!API_KEY || !API_SECRET) throw new Error("Missing SOLAPI_API_KEY/SOLAPI_API_SECRET");
  if (!FROM) throw new Error("Missing SMS_FROM");

  const to = normalizeKoreanPhone(toRaw);
  if (!to) throw new Error("Missing/invalid phone number");

  const byteLen = Buffer.byteLength(text, "utf8");
  const msgType = byteLen <= 90 ? "SMS" : "LMS";

  const url = "https://api.solapi.com/messages/v4/send";
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", API_SECRET).update(date + salt).digest("hex");

  const payload =
    msgType === "SMS"
      ? { message: { to, from: FROM, text, type: "SMS" as const } }
      : {
          message: {
            to,
            from: FROM,
            text,
            type: "LMS" as const,
            subject: subject ?? "Abbeyroad Studio",
          },
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
    console.error("[SOLAPI] send failed", { status: resp.status, json, to, msgType, byteLen });
    throw new Error(json?.errorMessage ?? json?.message ?? "SOLAPI send failed");
  }

  console.log("[SOLAPI] send ok", { to, msgType, byteLen, json });
  return json;
}

async function sendAdminSms(text: string) {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) throw new Error("Missing ADMIN_PHONE");
  return sendSolapi(adminPhone, text, "Abbeyroad Studio 예약");
}

async function sendCustomerSms(customerPhone: string, text: string) {
  return sendSolapi(customerPhone, text, "Abbeyroad Studio 예약확정");
}

// ---------- handler ----------
export async function POST(req: Request) {
  const { paymentKey, orderId, amount } = (await req.json()) as Body;

  if (!paymentKey || !orderId || !Number.isFinite(Number(amount))) {
    return NextResponse.json(
      { ok: false, error: "Missing paymentKey/orderId/amount" },
      { status: 400 }
    );
  }

  // 1) 우리 DB 예약 조회 + 상태/금액 검증
  const { data: booking, error: bErr } = await supabaseServer
    .from("bookings")
    // room_name 없음 → room_id join으로 name 가져오기
    .select("id, status, amount, start_at, end_at, customer_name, customer_phone, room_id, rooms:room_id(name)")
    .eq("order_id", orderId)
    .single();

  if (bErr || !booking) {
    return NextResponse.json({ ok: false, error: bErr?.message ?? "Booking not found" }, { status: 500 });
  }

  if (booking.status !== "PENDING") {
    return NextResponse.json({ ok: false, error: "Not in PENDING state" }, { status: 400 });
  }

  if (Number(booking.amount) !== Number(amount)) {
    return NextResponse.json({ ok: false, error: "Amount mismatch" }, { status: 400 });
  }

  // 2) 토스 결제 승인(서버에서 secretKey로 confirm)
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ ok: false, error: "Missing TOSS_SECRET_KEY" }, { status: 500 });
  }

  const auth = Buffer.from(`${secretKey}:`).toString("base64");

  const resp = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const tossJson = await resp.json();

  if (!resp.ok) {
    // 실패면 예약 취소 처리
    await supabaseServer.from("bookings").update({ status: "CANCELED" }).eq("id", booking.id);

    return NextResponse.json(
      { ok: false, error: tossJson?.message ?? "Toss confirm failed", detail: tossJson },
      { status: 400 }
    );
  }

  // 3) 성공이면 예약 확정
  const { error: uErr } = await supabaseServer
    .from("bookings")
    .update({
      status: "CONFIRMED",
      payment_key: paymentKey,
      paid_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  if (uErr) {
    return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
  }

  // 4) 문자(운영자 + 고객) — 실패해도 예약 확정은 유지
  const roomName =
    // supabase join 결과는 객체로 들어오는 형태가 일반적
    (booking as any)?.rooms?.name ?? "(룸정보없음)";

  const startIso = booking.start_at as string | null;
  const endIso = booking.end_at as string | null;

  const dateStr = startIso ? fmtKstDate(startIso) : "(날짜없음)";
  const startTime = startIso ? fmtKstTime(startIso) : "??:??";
  const endTime = endIso ? fmtKstTime(endIso) : "??:??";
  const timeRange = `${startTime}~${endTime}`;

  const priceStr = `${Number(amount).toLocaleString("ko-KR")}원`;

  // ✅ 고객 문자: 예약번호(booking.id) 넣지 않음 / 날짜 1번 + 시간만 표시
  const customerText =
    `[Abbeyroad Studio] 예약 확정\n` +
    `${roomName}룸 / ${dateStr} ${timeRange}\n` +
    `결제: ${priceStr}\n` +
    `문의: 010-9420-2518`;

  // ✅ 운영자 문자(원하면 문구 더 줄여도 됨)
  const adminText =
    `[Abbeyroad Studio] 예약확정\n` +
    `룸: ${roomName}\n` +
    `일시: ${dateStr} ${timeRange}\n` +
    `금액: ${priceStr}\n` +
    `예약자: ${booking.customer_name ?? "-"} / ${booking.customer_phone ?? "-"}`;

  // 운영자
  try {
    await sendAdminSms(adminText);
  } catch (e) {
    console.error("[SMS] admin send failed", e);
  }

  // 고객
  try {
    const customerPhone = booking.customer_phone as string | null;
    if (customerPhone) {
      await sendCustomerSms(customerPhone, customerText);
    } else {
      console.error("[SMS] customer phone missing");
    }
  } catch (e) {
    console.error("[SMS] customer send failed", e);
  }

  return NextResponse.json({ ok: true });
}
