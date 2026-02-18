import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { BOOKING_RULES } from "@/lib/rules";
import { addMinutes, toKstDayRange } from "@/lib/datetime";

type Body = {
  roomId: string;
  date: string;        // YYYY-MM-DD (KST)
  startIsoUtc: string; // UTC ISO
  durationHours: number;
  customerName: string;
  customerPhone: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  const { roomId, date, startIsoUtc, durationHours, customerName, customerPhone } = body;

  if (!roomId || !date || !startIsoUtc || !customerName || !customerPhone) {
    return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  const dur = Number(durationHours);
  if (!Number.isFinite(dur) || dur < 2 || dur > 24) {
    return NextResponse.json({ ok: false, error: "durationHours must be between 2 and 24" }, { status: 400 });
  }
  if (dur * 60 < BOOKING_RULES.minMinutes) {
    return NextResponse.json({ ok: false, error: `Minimum is ${BOOKING_RULES.minMinutes / 60} hours` }, { status: 400 });
  }

  const start = new Date(startIsoUtc);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ ok: false, error: "startIsoUtc is not valid" }, { status: 400 });
  }
  const end = addMinutes(start, dur * 60);

  // 운영시간 체크(24:00 마감 유지)
  const { startUtc: dayStartUtc } = toKstDayRange(date);
  const businessStart = addMinutes(dayStartUtc, BOOKING_RULES.openHour * 60);
  const businessEnd = addMinutes(dayStartUtc, BOOKING_RULES.closeHour * 60);
  if (start < businessStart || end > businessEnd) {
    return NextResponse.json({ ok: false, error: "운영시간 밖의 예약입니다." }, { status: 400 });
  }

  // 금액은 서버에서 계산 (클라이언트 조작 방지)
  const { data: room, error: roomErr } = await supabaseServer
    .from("rooms")
    .select("name, base_price_per_hour")
    .eq("id", roomId)
    .single();

  if (roomErr) return NextResponse.json({ ok: false, error: roomErr.message }, { status: 500 });

  const pricePerHour = Number(room.base_price_per_hour ?? 0);
  const amount = pricePerHour * dur;

  const orderId = crypto.randomUUID();

  const { data: booking, error: insErr } = await supabaseServer
    .from("bookings")
    .insert({
      room_id: roomId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      customer_name: customerName,
      customer_phone: customerPhone,
      status: "PENDING",
      order_id: orderId,
      amount,
    })
    .select("id, order_id, amount")
    .single();

  if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  return NextResponse.json({
    ok: true,
    orderId,
    amount,
    orderName: `Abbeyroad Studio ${room.name}룸 ${date}`,
    successUrl: `${baseUrl}/pay/success`,
    failUrl: `${baseUrl}/pay/fail`,
    bookingId: booking.id,
  });
}
