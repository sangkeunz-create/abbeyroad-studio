"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function PaySuccessClient() {
  const sp = useSearchParams();
  const [msg, setMsg] = useState("결제 확인 중...");

  useEffect(() => {
    const paymentKey = sp.get("paymentKey");
    const orderId = sp.get("orderId");
    const amount = Number(sp.get("amount"));

    (async () => {
      const res = await fetch("/api/payments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
      const json = await res.json();
      setMsg(json.ok ? "결제 완료! 예약이 확정되었습니다." : `결제 확인 실패: ${json.error || "unknown"}`);
    })();
  }, [sp]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>결제 성공</h1>
      <p style={{ marginTop: 12 }}>{msg}</p>
      <a href="/reserve" style={{ display: "inline-block", marginTop: 16 }}>예약 페이지로 돌아가기</a>
    </div>
  );
}
