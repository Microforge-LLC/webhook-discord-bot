import {createHmac, timingSafeEqual} from "node:crypto";

export function createVercelSignature(secret: string, body: Buffer | string) {
    return createHmac("sha1", secret).update(body).digest("hex");
}

export function isValidVercelSignature(secret: string, body: Buffer | string, signature: string) {
    if (!secret || !signature) {
        return false;
    }

    const expectedSignature = createVercelSignature(secret, body);
    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(signature, "hex");

    return expected.length === received.length && timingSafeEqual(expected, received);
}
