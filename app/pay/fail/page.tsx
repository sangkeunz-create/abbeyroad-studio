import { Suspense } from "react";
import PayFailClient from "./PayFailClient";

export default function PayFailPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>결제 실패 처리 중...</div>}>
      <PayFailClient />
    </Suspense>
  );
}
