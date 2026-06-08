import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {buildVercelDeploymentMessage, isSupportedVercelDeploymentEvent} from "./vercel";
import {createVercelSignature, isValidVercelSignature} from "./vercelSignature";
import {VercelWebhookVerificationError, parseVerifiedVercelWebhook} from "./vercelWebhook";

describe("Vercel deployment Discord message", () => {
    it("builds a Vercel-branded production success message", () => {
        const message = buildVercelDeploymentMessage({
            id: "evt_123",
            type: "deployment.succeeded",
            createdAt: 1716220800000,
            payload: {
                target: "production",
                links: {
                    deployment: "https://vercel.com/acme/web-app/dpl_123",
                },
                deployment: {
                    id: "dpl_123",
                    name: "web-app",
                    url: "web-app-abcd.vercel.app",
                    meta: {
                        githubCommitRef: "main",
                    },
                },
                project: {
                    id: "prj_123",
                    name: "web-app",
                },
            },
        });

        assert.equal(message?.authorName, "Vercel Deployments");
        assert.equal(message?.title, "[Vercel] Deployment Succeeded (Production)");
        assert.equal(message?.footerText, "Vercel Webhook - Production");
        assert.equal(message?.url, "https://web-app-abcd.vercel.app");
        assert.equal(message?.description, "**web-app**\nVercel finished this deployment successfully.");
        assert.deepEqual(message?.fields.slice(0, 3), [
            {name: "Platform", value: "Vercel", inline: true},
            {name: "Environment", value: "Production", inline: true},
            {name: "Project", value: "web-app", inline: true},
        ]);
        assert.ok(message?.buttons.some(button => button.label === "Open Deployment" && button.url === "https://web-app-abcd.vercel.app"));
        assert.ok(message?.buttons.some(button => button.label === "Open Vercel Details" && button.url === "https://vercel.com/acme/web-app/dpl_123"));
    });

    it("shows preview environment and error details for failed deployments", () => {
        const message = buildVercelDeploymentMessage({
            id: "evt_456",
            type: "deployment.error",
            createdAt: 1716220800000,
            payload: {
                target: "preview",
                deployment: {
                    id: "dpl_456",
                    name: "web-app",
                    url: "web-app-feature.vercel.app",
                    meta: {
                        githubCommitRef: "feature/vercel-webhook",
                    },
                },
                project: {
                    id: "prj_456",
                    name: "web-app",
                },
                errorMessage: "Build command failed",
            },
        });

        assert.equal(message?.title, "[Vercel] Deployment Error (Preview)");
        assert.equal(message?.fields.find(field => field.name === "Environment")?.value, "Preview");
        assert.deepEqual(message?.fields.find(field => field.name === "Error"), {
            name: "Error",
            value: "Build command failed",
        });
    });

    it("supports exactly the requested Vercel deployment events", () => {
        assert.equal(isSupportedVercelDeploymentEvent("deployment.created"), true);
        assert.equal(isSupportedVercelDeploymentEvent("deployment.succeeded"), true);
        assert.equal(isSupportedVercelDeploymentEvent("deployment.error"), true);
        assert.equal(isSupportedVercelDeploymentEvent("deployment.canceled"), true);
        assert.equal(isSupportedVercelDeploymentEvent("deployment.promoted"), false);
        assert.equal(isSupportedVercelDeploymentEvent("project.created"), false);
    });

    it("maps documented null targets to preview environment", () => {
        const message = buildVercelDeploymentMessage({
            id: "evt_789",
            type: "deployment.created",
            createdAt: 1716220800000,
            payload: {
                target: null,
                deployment: {
                    id: "dpl_789",
                    name: "web-app",
                    url: "web-app-preview.vercel.app",
                },
                project: {
                    id: "prj_789",
                },
            },
        });

        assert.equal(message?.title, "[Vercel] Deployment Created (Preview)");
        assert.equal(message?.fields.find(field => field.name === "Environment")?.value, "Preview");
    });
});

describe("Vercel webhook signatures", () => {
    it("validates Vercel HMAC-SHA1 signatures", () => {
        const body = Buffer.from(JSON.stringify({type: "deployment.created"}));
        const signature = createVercelSignature("vercel-secret", body);

        assert.equal(isValidVercelSignature("vercel-secret", body, signature), true);
        assert.equal(isValidVercelSignature("vercel-secret", body, "bad-signature"), false);
        assert.equal(isValidVercelSignature("other-secret", body, signature), false);
    });

    it("parses signed Vercel webhook bodies", () => {
        const body = Buffer.from(JSON.stringify({
            id: "evt_parse",
            type: "deployment.canceled",
            createdAt: 1716220800000,
            payload: {
                target: "production",
                deployment: {
                    id: "dpl_parse",
                    url: "web-app.vercel.app",
                },
            },
        }));
        const signature = createVercelSignature("vercel-secret", body);

        const payload = parseVerifiedVercelWebhook(body, signature, "vercel-secret");

        assert.equal(payload.type, "deployment.canceled");
        assert.equal(payload.payload.target, "production");
    });

    it("rejects unsigned or malformed Vercel webhook bodies", () => {
        const body = Buffer.from(JSON.stringify({type: "deployment.created"}));
        const malformedBody = Buffer.from("{");
        const malformedSignature = createVercelSignature("vercel-secret", malformedBody);

        assert.throws(() => parseVerifiedVercelWebhook(body, "bad-signature", "vercel-secret"), VercelWebhookVerificationError);
        assert.throws(() => parseVerifiedVercelWebhook(malformedBody, malformedSignature, "vercel-secret"), SyntaxError);
    });
});
