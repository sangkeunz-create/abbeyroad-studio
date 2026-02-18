import { Suspense } from "react";
import PaySuccessClient from "./PaySuccessClient";

export default function PaySuccessPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>결제 확인 중...</div>}>
      <PaySuccessClient />
    </Suspense>
  );
}
