import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { BOOKING_RULES } from "@/lib/rules";
import { makeSlotsForBusinessHours, toKstDayRange } from "@/lib/datetime";

type BookingRow = { room_id: string; start_at: string; end_at: string; status: string };
type RoomRow = { id: string; name: string; is_active: boolean; base_price_per_hour: number };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // YYYY-MM-DD
  if (!date) {
    return NextResponse.json({ ok: false, error: "Missing ?date=YYYY-MM-DD" }, { status: 400 });
  }

  const { startUtc, endUtc } = toKstDayRange(date);
  const { slots: slotStartsUtc, businessStartUtc, businessEndUtc } = makeSlotsForBusinessHours(date);

  const { data: rooms, error: roomsErr } = await supabaseServer
    .from("rooms")
    .select("id,name,is_active,base_price_per_hour")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (roomsErr) return NextResponse.json({ ok: false, error: roomsErr.message }, { status: 500 });

  const { data: bookings, error: bookErr } = await supabaseServer
    .from("bookings")
    .select("room_id,start_at,end_at,status")
    .eq("status", "CONFIRMED")
    .gte("start_at", startUtc.toISOString())
    .lt("start_at", endUtc.toISOString());

  if (bookErr) return NextResponse.json({ ok: false, error: bookErr.message }, { status: 500 });

  const slotsIso = slotStartsUtc.map((d) => d.toISOString());

  const result: Record<
    string,
    {
      roomId: string;
      pricePerHour: number;
      slots: string[];
      booked: { start_at: string; end_at: string }[];
    }
  > = {};

  for (const room of rooms as RoomRow[]) {
    const roomBookings = (bookings as BookingRow[])
      .filter((b) => b.room_id === room.id)
      .map((b) => ({ start_at: b.start_at, end_at: b.end_at }));

    result[room.name] = {
      roomId: room.id,
      pricePerHour: room.base_price_per_hour ?? 0,
      slots: slotsIso,
      booked: roomBookings,
    };
  }

  return NextResponse.json({
    ok: true,
    date,
    rules: BOOKING_RULES,
    businessHours: {
      startUtc: businessStartUtc.toISOString(),
      endUtc: businessEndUtc.toISOString(),
    },
    rooms: result,
  });
}
