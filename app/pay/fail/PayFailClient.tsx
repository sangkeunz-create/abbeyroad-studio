"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function PayFailClient() {
  const sp = useSearchParams();
  const [msg, setMsg] = useState("결제 실패 처리 중...");

  useEffect(() => {
    const orderId = sp.get("orderId");

    (async () => {
      if (orderId) {
        await fetch("/api/payments/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
      }
      const code = sp.get("code");
      const message = sp.get("message");
      setMsg(`결제가 실패/취소되었습니다. ${code ? `[${code}]` : ""} ${message ?? ""}`.trim());
    })();
  }, [sp]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>결제 실패</h1>
      <p style={{ marginTop: 12 }}>{msg}</p>
      <a href="/reserve" style={{ display: "inline-block", marginTop: 16 }}>예약 페이지로 돌아가기</a>
    </div>
  );
}
