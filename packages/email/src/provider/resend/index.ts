import { Resend } from "resend";
import { keys } from "../../../keys";
import { getResendFrom } from "./resend-options";
import type { EmailPayload, EmailProvider } from "../types";

function metadataToTags(metadata?: Record<string, string>) {
  if (!metadata) {
    return undefined;
  }
  return Object.entries(metadata).map(([name, value]) => ({ name, value }));
}

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!keys().RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }
    resend = new Resend(keys().RESEND_API_KEY);
  }
  return resend;
}

const provider: EmailProvider = {
  async sendEmail(payload: EmailPayload): Promise<{ id?: string }> {
    const tags = payload.tags ?? metadataToTags(payload.metadata);
    const { data, error } = await getResend().emails.send({
      from: getResendFrom(),
      to: payload.recipient,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      cc: payload.cc,
      replyTo: payload.replyTo,
      tags,
      headers: payload.headers,
    });

    if (error) {
      throw new Error(error.message);
    }

    return { id: data?.id ?? undefined };
  },
};

export default provider;
