"use client";

import { useEffect, useMemo, useState } from "react";
import { loadTossPayments } from "@tosspayments/payment-sdk";

type AvailabilityResponse = {
  ok: boolean;
  date: string;
  rules: {
    slotMinutes: number;
    minMinutes: number; // 120
    openHour: number;
    closeHour: number;  // 24
    timezone: string;
  };
  businessHours: { startUtc: string; endUtc: string };
  rooms: Record<
    string,
    {
      roomId: string;
      pricePerHour: number;
      slots: string[];
      booked: { start_at: string; end_at: string }[];
    }
  >;
};

function todayKst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

function formatKstTime(isoUtc: string) {
  const d = new Date(isoUtc);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function moneyKRW(n: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.max(0, Math.round(n)));
}

export default function ReservePage() {
  const [date, setDate] = useState<string>(todayKst());
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [roomName, setRoomName] = useState<string>("A");

  // ✅ 선택 상태: 기본 2시간
  const [startIsoUtc, setStartIsoUtc] = useState<string>("");
  const [durationHours, setDurationHours] = useState<number>(2);

  // 예약자
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const minHours = Math.max(2, Math.floor((availability?.rules?.minMinutes ?? 120) / 60));

  async function loadAvailability(nextDate: string, keepSelection = false) {
    setLoading(true);
    setMessage("");

    if (!keepSelection) {
      setStartIsoUtc("");
      setDurationHours(minHours); // ✅ 기본 2시간으로 복구
    }

    try {
      const res = await fetch(`/api/availability?date=${nextDate}`);
      const data: AvailabilityResponse = await res.json();
      setAvailability(data);

      const roomKeys = data?.rooms ? Object.keys(data.rooms) : [];
      const first = roomKeys[0] || "A";
      setRoomName((prev) => (data?.rooms?.[prev] ? prev : first));
    } catch {
      setMessage("가능 시간표를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAvailability(date, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const roomOptions = useMemo(() => (availability?.rooms ? Object.keys(availability.rooms) : []), [availability]);
  const selectedRoom = availability?.rooms?.[roomName];
  const slots = selectedRoom?.slots ?? [];
  const booked = selectedRoom?.booked ?? [];
  const pricePerHour = selectedRoom?.pricePerHour ?? 0;

  const endIsoUtc = useMemo(() => {
    if (!startIsoUtc) return "";
    const start = new Date(startIsoUtc);
    return new Date(start.getTime() + durationHours * 60 * 60 * 1000).toISOString();
  }, [startIsoUtc, durationHours]);

  const selectedRange = useMemo(() => {
    if (!startIsoUtc) return new Set<string>();
    const start = new Date(startIsoUtc);
    const set = new Set<string>();
    for (let i = 0; i < durationHours; i++) {
      const iso = new Date(start.getTime() + i * 60 * 60 * 1000).toISOString();
      set.add(iso);
    }
    return set;
  }, [startIsoUtc, durationHours]);

  const slotInfo = useMemo(() => {
    const map = new Map<string, { blocked: boolean; label?: string }>();
    for (const iso of slots) {
      const s = new Date(iso);
      const e = new Date(s.getTime() + 60 * 60 * 1000);

      let blocked = false;
      let label: string | undefined;

      for (const b of booked) {
        const bS = new Date(b.start_at);
        const bE = new Date(b.end_at);
        if (overlaps(s, e, bS, bE)) {
          blocked = true;
          label = `${formatKstTime(b.start_at)}~${formatKstTime(b.end_at)} 예약됨`;
          break;
        }
      }
      map.set(iso, { blocked, label });
    }
    return map;
  }, [slots, booked]);

  const selectionValid = useMemo(() => {
    if (!startIsoUtc || !availability?.ok) return false;

    const start = new Date(startIsoUtc);
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

    const bStart = new Date(availability.businessHours.startUtc);
    const bEnd = new Date(availability.businessHours.endUtc);
    if (start < bStart || end > bEnd) return false;

    for (const iso of selectedRange) {
      if (!slots.includes(iso)) return false;
      if (slotInfo.get(iso)?.blocked) return false;
    }
    return durationHours >= minHours;
  }, [startIsoUtc, durationHours, availability, selectedRange, slots, slotInfo, minHours]);

  const nextExtendIso = useMemo(() => {
    if (!startIsoUtc) return "";
    const start = new Date(startIsoUtc);
    return new Date(start.getTime() + durationHours * 60 * 60 * 1000).toISOString();
  }, [startIsoUtc, durationHours]);

  const canExtend = useMemo(() => {
    if (!availability?.ok || !startIsoUtc) return false;
    if (!nextExtendIso) return false;
    if (!slots.includes(nextExtendIso)) return false;
    if (slotInfo.get(nextExtendIso)?.blocked) return false;

    const start = new Date(startIsoUtc);
    const newEnd = new Date(start.getTime() + (durationHours + 1) * 60 * 60 * 1000);
    const bEnd = new Date(availability.businessHours.endUtc);
    return newEnd <= bEnd;
  }, [availability, startIsoUtc, durationHours, nextExtendIso, slots, slotInfo]);

  const totalPrice = useMemo(() => pricePerHour * durationHours, [pricePerHour, durationHours]);

  function resetSelection() {
    setStartIsoUtc("");
    setDurationHours(minHours);
  }

  // ✅ 클릭 규칙 유지: 기본 2시간 + 연장/축소
  function onClickSlot(iso: string) {
    if (!availability?.ok || !selectedRoom?.roomId) return;
    if (slotInfo.get(iso)?.blocked) return;

    if (!startIsoUtc) {
      setStartIsoUtc(iso);
      setDurationHours(minHours); // ✅ 기본 2시간 자동 선택
      return;
    }

    const start = new Date(startIsoUtc);
    const clicked = new Date(iso);
    const isInside = selectedRange.has(iso);

    if (iso === nextExtendIso) {
      if (!canExtend) return;
      setDurationHours((h) => h + 1);
      return;
    }

    if (isInside) {
      if (iso === startIsoUtc) {
        resetSelection();
        return;
      }

      const diffHours = Math.round((clicked.getTime() - start.getTime()) / (60 * 60 * 1000));
      const newDuration = Math.max(minHours, diffHours + 1);

      // 마지막 슬롯 클릭 → 1시간 줄이기(최소 2시간 유지)
      if (diffHours === durationHours - 1) {
        setDurationHours(Math.max(minHours, durationHours - 1));
        return;
      }

      // 중간 클릭 → 그 지점까지 줄이기(최소 2시간 유지)
      setDurationHours(newDuration);
      return;
    }

    // 다른 곳 클릭 → 새 시작 + 기본 2시간
    setStartIsoUtc(iso);
    setDurationHours(minHours);
  }

  // ✅ 결제 시작(예약 확정 전 결제)
  async function submitBooking() {
    if (!availability?.ok) return setMessage("가능 시간표가 준비되지 않았습니다.");
    if (!selectedRoom?.roomId) return setMessage("룸 정보가 없습니다.");
    if (!startIsoUtc) return setMessage("시간을 선택해 주세요.");
    if (!customerName.trim()) return setMessage("이름을 입력해 주세요.");
    if (!customerPhone.trim()) return setMessage("전화번호를 입력해 주세요.");
    if (!selectionValid) return setMessage("선택한 시간에 예약이 있거나 운영시간을 벗어났습니다.");

    setSubmitting(true);
    setMessage("");

    const prepRes = await fetch("/api/payments/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: selectedRoom.roomId,
        date,
        startIsoUtc,
        durationHours,
        customerName,
        customerPhone,
      }),
    });

    const prep = await prepRes.json();

    if (!prep.ok) {
      setSubmitting(false);
      return setMessage(prep.error || "결제 준비 실패");
    }

    try {
      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;
      const tossPayments = await loadTossPayments(clientKey);

      await tossPayments.requestPayment("CARD", {
        amount: prep.amount,
        orderId: prep.orderId,
        orderName: prep.orderName,
        customerName,
        successUrl: prep.successUrl,
        failUrl: prep.failUrl,
      });
    } catch (e: any) {
      console.error("Toss requestPayment error:", e);
      await fetch("/api/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: prep.orderId }),
      });
      const reason = e?.message || e?.code || "";
      setMessage(`결제가 취소되었거나 결제창 호출에 실패했습니다. `.trim());
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 6 }}>Abbeyroad Studio 예약</h1>
      <div style={{ color: "#666", marginBottom: 18 }}>
        운영 {availability?.rules?.openHour ?? 8}:00 ~ {availability?.rules?.closeHour ?? 24}:00 / 최소 {minHours}시간 / 1시간 단위
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 12 }}>1) 날짜/룸/시간</h2>

          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", marginBottom: 12 }}
          />

          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>룸</label>
          <select
            value={roomName}
            onChange={(e) => {
              setRoomName(e.target.value);
              resetSelection();
            }}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", marginBottom: 12 }}
          >
            {roomOptions.map((r) => (
              <option key={r} value={r}>
                {r} 룸
              </option>
            ))}
          </select>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>
              선택:{" "}
              {startIsoUtc ? (
                <>
                  {formatKstTime(startIsoUtc)} ~ {formatKstTime(endIsoUtc)} ({durationHours}시간)
                </>
              ) : (
                "없음"
              )}
              {startIsoUtc && (
                <span style={{ marginLeft: 10, color: "#444", fontWeight: 800 }}>
                  예상 금액: {moneyKRW(totalPrice)}원
                </span>
              )}
            </div>

            <button
              onClick={resetSelection}
              style={{ fontSize: 12, padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
            >
              선택 초기화
            </button>
          </div>

          <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>시간 선택(모든 시간 표시)</label>

          {loading ? (
            <div style={{ color: "#666" }}>불러오는 중...</div>
          ) : !availability?.ok ? (
            <div style={{ color: "crimson" }}>가능 시간표 오류</div>
          ) : (
            <div className="slotGrid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {slots.map((iso) => {
                const info = slotInfo.get(iso);
                const blocked = !!info?.blocked;
                const selected = selectedRange.has(iso);

                return (
                  <button
                    key={iso}
                    onClick={() => onClickSlot(iso)}
                    disabled={blocked}
                    title={blocked ? (info?.label ?? "이미 예약됨") : "클릭"}
                    style={{
                      position: "relative",
                      padding: "10px 8px",
                      borderRadius: 10,
                      border: selected ? "2px solid #111" : "1px solid #ddd",
                      background: blocked ? "#f3f3f3" : selected ? "#111" : "#fff",
                      color: blocked ? "#999" : selected ? "#fff" : "#111",
                      cursor: blocked ? "not-allowed" : "pointer",
                      fontWeight: 900,
                      opacity: blocked ? 0.9 : 1,
                    }}
                  >
                    {formatKstTime(iso)}

                    {blocked && (
                      <span
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "#ddd",
                          color: "#333",
                          fontWeight: 900,
                        }}
                      >
                        예약됨
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {startIsoUtc && (
            <div style={{ marginTop: 10, fontSize: 12, color: canExtend ? "#0a7" : "#999" }}>
              {canExtend ? `다음 시간(${formatKstTime(nextExtendIso)})을 누르면 1시간 연장됩니다.` : "더 이상 연장할 수 없습니다."}
            </div>
          )}

          {!selectionValid && startIsoUtc && (
            <div style={{ marginTop: 10, color: "crimson", fontSize: 13 }}>
              선택한 구간에 예약이 있거나 운영시간을 벗어났습니다. (시간을 다시 선택해 주세요)
            </div>
          )}

          <style jsx>{`
            @media (max-width: 860px) {
              .slotGrid {
                grid-template-columns: repeat(3, 1fr) !important;
              }
            }
            @media (max-width: 520px) {
              .slotGrid {
                grid-template-columns: repeat(2, 1fr) !important;
              }
            }
          `}</style>
        </div>

        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 12 }}>2) 예약자 정보</h2>

          <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "#fafafa", border: "1px solid #eee" }}>
            <div style={{ fontSize: 13, fontWeight: 900 }}>요금</div>
            <div style={{ marginTop: 6, fontSize: 13, color: "#333" }}>
              시간당: <b>{moneyKRW(pricePerHour)}</b>원 × {durationHours}시간 = <b>{moneyKRW(totalPrice)}</b>원
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#777" }}>
              * 24:00 마감이며, 심야 시간 예약은 유선 문의 부탁드립니다.
            </div>
          </div>

          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>이름 *</label>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", marginBottom: 12 }}
          />

          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>전화번호 *</label>
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="010-0000-0000"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", marginBottom: 12 }}
          />

          <button
            onClick={submitBooking}
            disabled={submitting || !selectionValid}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 900,
              cursor: submitting || !selectionValid ? "not-allowed" : "pointer",
              opacity: submitting || !selectionValid ? 0.5 : 1,
            }}
          >
            {submitting ? "결제 준비 중..." : "결제하기"}
          </button>

          {message && (
            <div style={{ marginTop: 12, color: message.includes("완료") ? "green" : "crimson" }}>{message}</div>
          )}
        </div>
      </div>
    </div>
  );
}
