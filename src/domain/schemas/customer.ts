import { z } from "zod";
import { checkbox, optEmail, optId, optText, reqText } from "./common";

export const CONTACT_METHODS = ["PHONE", "WHATSAPP", "EMAIL", "SMS", "OTHER"] as const;

export const customerSchema = z
  .object({
    name: reqText("Name", 120),
    company: optText(120),
    email: optEmail(),
    phone: optText(40).refine((v) => v === null || /^[+\d\s().-]{6,}$/.test(v), "Enter a valid phone number."),
    preferredContact: z.enum(CONTACT_METHODS).default("PHONE"),
    addressLine1: optText(200),
    addressLine2: optText(200),
    city: optText(100),
    postalCode: optText(20),
    country: optText(80),
    taxId: optText(40),
    vatExempt: checkbox(),
    notes: optText(5000),
    tags: optText(300),
    pricingPolicyId: optId(),
    marketingConsent: checkbox(),
    allowDuplicate: checkbox(),
  })
  .refine((v) => v.preferredContact !== "EMAIL" || v.email, { message: "Add an email address or choose another contact method.", path: ["email"] })
  .refine((v) => !["PHONE", "WHATSAPP", "SMS"].includes(v.preferredContact) || v.phone, {
    message: "Add a phone number or choose another contact method.",
    path: ["phone"],
  });

export type CustomerInput = z.output<typeof customerSchema>;

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return digits.length >= 6 ? digits : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  return [...new Set(tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}
