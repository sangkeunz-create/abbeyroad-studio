import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { BOOKING_RULES } from "@/lib/rules";
import { addMinutes, toKstDayRange } from "@/lib/datetime";
import { Resend } from "resend";

type Body = {
  roomId: string;
  date: string;
  startIsoUtc: string;
  durationHours?: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  headcount?: number;
  memo?: string;
};

function fmtKst(isoUtc: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoUtc));
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    roomId,
    date,
    startIsoUtc,
    durationHours,
    customerName,
    customerPhone,
    customerEmail,
    headcount = 1,
    memo,
  } = body;

  if (!roomId || !date || !startIsoUtc || !customerName || !customerPhone) {
    return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  const defaultHours = Math.max(2, Math.floor(BOOKING_RULES.minMinutes / 60));
  const dur = Number.isFinite(Number(durationHours)) ? Number(durationHours) : defaultHours;

  if (!Number.isFinite(dur) || dur < 2 || dur > 24) {
    return NextResponse.json({ ok: false, error: "durationHours must be between 2 and 24" }, { status: 400 });
  }

  const durationMinutes = dur * 60;
  if (durationMinutes < BOOKING_RULES.minMinutes) {
    return NextResponse.json(
      { ok: false, error: `Minimum is ${BOOKING_RULES.minMinutes / 60} hours` },
      { status: 400 }
    );
  }

  const start = new Date(startIsoUtc);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ ok: false, error: "startIsoUtc is not a valid ISO date" }, { status: 400 });
  }

  const { startUtc: dayStartUtc } = toKstDayRange(date);
  const businessStart = addMinutes(dayStartUtc, BOOKING_RULES.openHour * 60);
  const businessEnd = addMinutes(dayStartUtc, BOOKING_RULES.closeHour * 60);

  const end = addMinutes(start, durationMinutes);

  if (start < businessStart || end > businessEnd) {
    return NextResponse.json({ ok: false, error: "운영시간 밖의 예약입니다." }, { status: 400 });
  }

  // 룸 이름/가격 가져오기(알림용)
  const { data: roomRow } = await supabaseServer
    .from("rooms")
    .select("name,base_price_per_hour")
    .eq("id", roomId)
    .maybeSingle();

  const { data, error } = await supabaseServer
    .from("bookings")
    .insert({
      room_id: roomId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail ?? null,
      headcount,
      memo: memo ?? null,
      status: "CONFIRMED",
    })
    .select("id, room_id, start_at, end_at, status")
    .single();

  if (error) {
    const msg = error.message || "";
    const isOverlap =
      msg.toLowerCase().includes("overlap") ||
      msg.toLowerCase().includes("exclusion") ||
      msg.toLowerCase().includes("conflict") ||
      msg.toLowerCase().includes("bookings_no_overlap");

    return NextResponse.json(
      { ok: false, error: isOverlap ? "이미 예약된 시간입니다." : msg },
      { status: isOverlap ? 409 : 500 }
    );
  }

  // ✅ 예약 성공 후 알림 이메일 발송(실패해도 예약은 성공 처리)
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const alertEmail = process.env.ALERT_EMAIL;

    if (resendKey && alertEmail) {
      const resend = new Resend(resendKey);

      const roomName = roomRow?.name ?? "Unknown";
      const pricePerHour = Number(roomRow?.base_price_per_hour ?? 0);
      const total = pricePerHour * dur;

      await resend.emails.send({
        from: "Abbeyroad Studio <onboarding@resend.dev>",
        to: [alertEmail],
        subject: `[예약 알림] ${roomName}룸 ${fmtKst(start.toISOString())}`,
        text:
          `새 예약이 등록되었습니다.\n\n` +
          `룸: ${roomName}룸\n` +
          `시간: ${fmtKst(start.toISOString())} ~ ${fmtKst(end.toISOString())} (${dur}시간)\n` +
          `예약자: ${customerName}\n` +
          `전화: ${customerPhone}\n` +
          `인원: ${headcount}\n` +
          `금액(예상): ${total.toLocaleString("ko-KR")}원\n` +
          (memo ? `메모: ${memo}\n` : "") +
          `\n예약ID: ${data.id}\n`,
      });
    }
  } catch (e) {
    // noop
  }

  return NextResponse.json({ ok: true, booking: data });
}
