import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  return NextResponse.json({
    hasUrl: Boolean(url),
    urlStartsWithHttps: url.startsWith("https://"),
    urlHostPreview: url ? url.replace("https://", "").split("/")[0].slice(0, 10) + "..." : "",
    hasAnonKey: Boolean(anon),
    anonPrefix: anon ? anon.slice(0, 8) + "..." : "",
    anonLength: anon.length,
    hasServiceRoleKey: Boolean(svc),
    servicePrefix: svc ? svc.slice(0, 8) + "..." : "",
    serviceLength: svc.length,
    serviceLooksJwt: svc.startsWith("eyJ"),
  });
}
