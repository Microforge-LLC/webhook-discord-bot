export type VercelDeploymentEventType =
    | "deployment.created"
    | "deployment.succeeded"
    | "deployment.error"
    | "deployment.canceled";

interface VercelProject {
    id: string;
    name?: string;
}

interface VercelDeployment {
    id: string;
    name?: string;
    url?: string;
    target?: string;
    inspectorUrl?: string;
    errorMessage?: string;
    meta?: Record<string, string | undefined>;
}

interface VercelPayload {
    deployment?: VercelDeployment;
    project?: VercelProject;
    target?: string | null;
    links?: {
        deployment?: string;
        project?: string;
    };
    errorMessage?: string;
}

export interface VercelWebhookPayload {
    id: string;
    type: string;
    createdAt: number;
    payload: VercelPayload;
    region?: string;
}

export type DiscordMessageField = {name: string; value: string; inline?: boolean}

export interface DiscordMessageButton {
    label: string;
    url: string;
}

export interface VercelDeploymentMessage {
    authorName: string;
    color: string;
    title: string;
    url?: string;
    description: string;
    footerText: string;
    fields: DiscordMessageField[];
    buttons: DiscordMessageButton[];
}

interface VercelEventStyle {
    color: string;
    title: string;
    summary: string;
}

const VERCEL_EVENT_STYLES: Record<VercelDeploymentEventType, VercelEventStyle> = {
    "deployment.created": {
        color: "#5865F2",
        title: "Deployment Created",
        summary: "Vercel has started a new deployment.",
    },
    "deployment.succeeded": {
        color: "#57F287",
        title: "Deployment Succeeded",
        summary: "Vercel finished this deployment successfully.",
    },
    "deployment.error": {
        color: "#ED4245",
        title: "Deployment Error",
        summary: "Vercel could not complete this deployment.",
    },
    "deployment.canceled": {
        color: "#99AAB5",
        title: "Deployment Canceled",
        summary: "This Vercel deployment was canceled.",
    },
};

export function isSupportedVercelDeploymentEvent(type: string): type is VercelDeploymentEventType {
    return type in VERCEL_EVENT_STYLES;
}

export function buildVercelDeploymentMessage(payload: VercelWebhookPayload): VercelDeploymentMessage | null {
    if (!isSupportedVercelDeploymentEvent(payload.type)) {
        return null;
    }

    const style = VERCEL_EVENT_STYLES[payload.type];
    const deployment = payload.payload.deployment;
    const project = payload.payload.project;
    const target = payload.payload.target === null ? null : payload.payload.target || deployment?.target;
    const environment = formatVercelEnvironment(target);
    const projectName = project?.name || deployment?.name || project?.id || "Unknown project";
    const deploymentName = deployment?.name || deployment?.id || "Unknown deployment";
    const deploymentUrl = normalizeDeploymentUrl(deployment?.url);
    const detailsUrl = payload.payload.links?.deployment || deployment?.inspectorUrl;
    const branch = deployment?.meta?.githubCommitRef || deployment?.meta?.branchAlias;
    const fields: DiscordMessageField[] = [
        {name: "Platform", value: "Vercel", inline: true},
        {name: "Environment", value: environment, inline: true},
        {name: "Project", value: projectName, inline: true},
        {name: "Deployment", value: deploymentName, inline: true},
    ];

    if (branch) {
        fields.push({name: "Branch", value: branch, inline: true});
    }

    const errorMessage = payload.payload.errorMessage || deployment?.errorMessage;
    if (payload.type === "deployment.error" && errorMessage) {
        fields.push({name: "Error", value: errorMessage});
    }

    const buttons: DiscordMessageButton[] = [];
    if (deploymentUrl) {
        buttons.push({label: "Open Deployment", url: deploymentUrl});
    }
    if (detailsUrl) {
        buttons.push({label: "Open Vercel Details", url: detailsUrl});
    }

    return {
        authorName: "Vercel Deployments",
        color: style.color,
        title: `[Vercel] ${style.title} (${environment})`,
        url: deploymentUrl,
        description: `**${projectName}**\n${style.summary}`,
        footerText: `Vercel Webhook - ${environment}`,
        fields,
        buttons,
    };
}

function formatVercelEnvironment(target: string | null | undefined) {
    if (target === null) {
        return "Preview";
    }

    if (!target) {
        return "Unknown";
    }

    return target
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ") || "Unknown";
}

function normalizeDeploymentUrl(url: string | undefined) {
    if (!url) {
        return undefined;
    }

    if (/^https?:\/\//i.test(url)) {
        return url;
    }

    return `https://${url}`;
}
