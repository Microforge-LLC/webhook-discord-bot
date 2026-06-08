import {VercelWebhookPayload} from "./vercel";
import {isValidVercelSignature} from "./vercelSignature";

export class VercelWebhookVerificationError extends Error {}

export function parseVerifiedVercelWebhook(body: Buffer, signature: string, secret: string): VercelWebhookPayload {
    if (!secret) {
        throw new Error("VERCEL_WEBHOOK_SECRET is not set.");
    }

    if (!isValidVercelSignature(secret, body, signature)) {
        throw new VercelWebhookVerificationError("Invalid Vercel webhook signature");
    }

    return JSON.parse(body.toString("utf8"))
}
