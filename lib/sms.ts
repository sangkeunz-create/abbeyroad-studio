import SolapiMessageService from "solapi";

const apiKey = process.env.SOLAPI_API_KEY!;
const apiSecret = process.env.SOLAPI_API_SECRET!;
const from = process.env.SMS_FROM!;
const toAdmin = process.env.SMS_TO_ADMIN!;

const service = new SolapiMessageService(apiKey, apiSecret);

export async function sendAdminSms(text: string) {
  if (!apiKey || !apiSecret || !from || !toAdmin) {
    console.warn("[SMS] Missing env. Skip sending.");
    return { ok: false, skipped: true };
  }
  await service.sendOne({ to: toAdmin, from, text });
  return { ok: true };
}
