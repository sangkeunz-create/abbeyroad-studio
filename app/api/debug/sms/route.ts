import { NextResponse } from "next/server";
import { sendAdminSms } from "@/lib/sms";

export async function GET() {
  try {
    const r = await sendAdminSms(`[Abbeyroad Studio] SMS 테스트 ${new Date().toISOString()}`);
    return NextResponse.json({ ok: true, result: r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
