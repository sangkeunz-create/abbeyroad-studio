import { NextResponse } from "next/server";

export async function GET() {
  const ck = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "";
  const sk = process.env.TOSS_SECRET_KEY || "";
  return NextResponse.json({
    hasClientKey: !!ck,
    clientKeyPrefix: ck.slice(0, 10),
    hasSecretKey: !!sk,
    secretKeyPrefix: sk.slice(0, 10),
  });
}
