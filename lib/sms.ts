import { SolapiMessageService } from "solapi";

function must(name: string, v?: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// 관리자에게 SMS 보내기
export async function sendAdminSms(text: string) {
  const apiKey = must("SOLAPI_API_KEY", process.env.SOLAPI_API_KEY);
  const apiSecret = must("SOLAPI_API_SECRET", process.env.SOLAPI_API_SECRET);

  // 발신번호/수신번호는 숫자만 권장 (예: 01012345678)
  const from = must("SMS_FROM", process.env.SMS_FROM);
  const to = must("SMS_TO_ADMIN", process.env.SMS_TO_ADMIN);

  const service = new SolapiMessageService(apiKey, apiSecret);

  // solapi SDK 기본 형태
  const result = await service.sendOne({
    to,
    from,
    text,
  });

  return result;
}
