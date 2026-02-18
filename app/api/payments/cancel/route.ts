import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type Body = { orderId: string };

export async function POST(req: Request) {
  const { orderId } = (await req.json()) as Body;
  if (!orderId) return NextResponse.json({ ok: false, error: "Missing orderId" }, { status: 400 });

  const { error } = await supabaseServer
    .from("bookings")
    .update({ status: "CANCELED" })
    .eq("order_id", orderId)
    .eq("status", "PENDING");

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
