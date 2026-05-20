import express, {NextFunction, Request, Response} from "express";
import {Webhook, WebhookUnbrandedRequiredHeaders, WebhookVerificationError} from "standardwebhooks"
import {RenderEvent, RenderPostgres, RenderService, WebhookPayload} from "./render";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    ColorResolvable,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    MessageActionRowComponentBuilder
} from "discord.js";

const app = express();
const port = process.env.PORT || 3001;
const renderWebhookSecret = process.env.RENDER_WEBHOOK_SECRET || '';
if (!renderWebhookSecret ) {
    console.error("Error: RENDER_WEBHOOK_SECRET is not set.");
    process.exit(1);
}


const renderAPIURL = process.env.RENDER_API_URL || "https://api.render.com/v1"

// To create a Render API key, follow instructions here: https://render.com/docs/api#1-create-an-api-key
const renderAPIKey = process.env.RENDER_API_KEY || '';
if (!renderAPIKey ) {
    console.error("Error: RENDER_API_KEY is not set.");
    process.exit(1);
}

const discordToken = process.env.DISCORD_TOKEN || '';
if (!discordToken ) {
    console.error("Error: DISCORD_TOKEN is not set.");
    process.exit(1);
}
const discordChannelID = process.env.DISCORD_CHANNEL_ID || '';
if (!discordChannelID ) {
    console.error("Error: DISCORD_CHANNEL_ID is not set.");
    process.exit(1);
}

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, readyClient => {
    console.log(`Discord client setup! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(discordToken).catch(err => {
    console.error(`unable to connect to Discord: ${err}`);
});

app.post("/webhook", express.raw({type: 'application/json'}), (req: Request, res: Response, next: NextFunction) => {
    try {
        validateWebhook(req);
    } catch (error) {
        return next(error)
    }

    const payload: WebhookPayload = JSON.parse(req.body)

    res.status(200).send({}).end()

    // handle the webhook async so we don't timeout the request
    handleWebhook(payload)
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err);
    if (err instanceof WebhookVerificationError) {
        res.status(400).send({}).end()
    } else {
        res.status(500).send({}).end()
    }
});

const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

function validateWebhook(req: Request) {
    const headers: WebhookUnbrandedRequiredHeaders = {
        "webhook-id": req.header("webhook-id") || "",
        "webhook-timestamp": req.header("webhook-timestamp") || "",
        "webhook-signature": req.header("webhook-signature") || ""
    }

    const wh = new Webhook(renderWebhookSecret);
    wh.verify(req.body, headers);
}

const COLOR_INFO = "#5865F2"
const COLOR_SUCCESS = "#57F287"
const COLOR_FAILURE = "#FF5C88"
const COLOR_WARNING = "#FAA61A"
const COLOR_NEUTRAL = "#99AAB5"
const COLOR_SUSPENDED = "#992D22"

async function handleWebhook(payload: WebhookPayload) {
    try {
        switch (payload.type) {
            case "deploy_started": {
                const service = await fetchServiceInfo(payload)
                console.log(`sending discord message for ${service.name} (deploy_started)`)
                await sendNotification({
                    name: service.name,
                    dashboardUrl: service.dashboardUrl,
                    color: COLOR_INFO,
                    titleSuffix: "Deploy Started",
                    description: "Deployment in progress.",
                    showLogsButton: true,
                })
                return
            }
            case "deploy_ended": {
                const service = await fetchServiceInfo(payload)
                const {color, titleSuffix, description} = describeDeployEnded(payload)
                console.log(`sending discord message for ${service.name} (deploy_ended:${payload.data.status})`)
                await sendNotification({
                    name: service.name,
                    dashboardUrl: service.dashboardUrl,
                    color,
                    titleSuffix,
                    description,
                    showLogsButton: true,
                })
                return
            }
            case "maintenance_started": {
                const service = await fetchServiceInfo(payload)
                console.log(`sending discord message for ${service.name} (maintenance_started)`)
                await sendNotification({
                    name: service.name,
                    dashboardUrl: service.dashboardUrl,
                    color: COLOR_WARNING,
                    titleSuffix: "Maintenance Started",
                    description: "A platform maintenance window has started.",
                })
                return
            }
            case "maintenance_ended": {
                const service = await fetchServiceInfo(payload)
                console.log(`sending discord message for ${service.name} (maintenance_ended)`)
                await sendNotification({
                    name: service.name,
                    dashboardUrl: service.dashboardUrl,
                    color: COLOR_SUCCESS,
                    titleSuffix: "Maintenance Ended",
                    description: "The platform maintenance window has ended.",
                })
                return
            }
            case "service_suspended": {
                const service = await fetchServiceInfo(payload)
                console.log(`sending discord message for ${service.name} (service_suspended)`)
                await sendNotification({
                    name: service.name,
                    dashboardUrl: service.dashboardUrl,
                    color: COLOR_SUSPENDED,
                    titleSuffix: "Suspended",
                    description: "The service was suspended.",
                })
                return
            }
            case "server_failed": {
                const service = await fetchServiceInfo(payload)
                const event = await fetchEventInfo(payload)
                console.log(`sending discord message for ${service.name} (server_failed)`)
                await sendServerFailedMessage(service, event.details?.reason ?? {})
                return
            }
            case "postgres_backup_completed": {
                const postgres = await fetchPostgresInfo(payload)
                console.log(`sending discord message for ${postgres.name} (postgres_backup_completed)`)
                await sendNotification({
                    name: postgres.name,
                    dashboardUrl: postgres.dashboardUrl,
                    color: COLOR_SUCCESS,
                    titleSuffix: "Backup Completed",
                    description: "Postgres backup completed successfully.",
                })
                return
            }
            case "postgres_backup_failed": {
                const postgres = await fetchPostgresInfo(payload)
                console.log(`sending discord message for ${postgres.name} (postgres_backup_failed)`)
                await sendNotification({
                    name: postgres.name,
                    dashboardUrl: postgres.dashboardUrl,
                    color: COLOR_FAILURE,
                    titleSuffix: "Backup Failed",
                    description: "Postgres backup failed.",
                })
                return
            }
            case "postgres_unavailable": {
                const postgres = await fetchPostgresInfo(payload)
                console.log(`sending discord message for ${postgres.name} (postgres_unavailable)`)
                await sendNotification({
                    name: postgres.name,
                    dashboardUrl: postgres.dashboardUrl,
                    color: COLOR_FAILURE,
                    titleSuffix: "Unavailable",
                    description: "Postgres database is currently unavailable.",
                })
                return
            }
            default:
                console.log(`unhandled webhook type ${payload.type} for service ${payload.data.serviceId}`)
        }
    } catch (error) {
        console.error(error)
    }
}

function describeDeployEnded(payload: WebhookPayload): {color: string; titleSuffix: string; description: string} {
    switch (payload.data.status) {
        case "succeeded":
            return {color: COLOR_SUCCESS, titleSuffix: "Deploy Succeeded", description: "Deployment completed successfully."}
        case "failed":
            return {color: COLOR_FAILURE, titleSuffix: "Deploy Failed", description: "Deployment failed."}
        case "canceled":
            return {color: COLOR_NEUTRAL, titleSuffix: "Deploy Canceled", description: "Deployment was canceled."}
        default:
            return {color: COLOR_INFO, titleSuffix: "Deploy Ended", description: `Deployment ended with status: ${payload.data.status ?? "unknown"}.`}
    }
}

async function sendNotification(opts: {
    name: string;
    dashboardUrl: string;
    color: string;
    titleSuffix: string;
    description: string;
    showLogsButton?: boolean;
}) {
    const channel = await client.channels.fetch(discordChannelID);
    if (!channel) {
        throw new Error(`unable to find specified Discord channel ${discordChannelID}`);
    }

    if (!channel.isSendable()) {
        throw new Error(`specified Discord channel ${discordChannelID} is not sendable`);
    }

    const embed = new EmbedBuilder()
        .setColor(opts.color as ColorResolvable)
        .setTitle(`${opts.name} ${opts.titleSuffix}`)
        .setDescription(opts.description)
        .setURL(opts.dashboardUrl)

    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []
    if (opts.showLogsButton) {
        const logs = new ButtonBuilder()
            .setLabel("View Logs")
            .setURL(`${opts.dashboardUrl}/logs`)
            .setStyle(ButtonStyle.Link);
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
            .addComponents(logs);
        components.push(row)
    }

    await channel.send({embeds: [embed], components})
}

async function sendServerFailedMessage(service: RenderService, failureReason: any) {
    let description = "Failed for unknown reason"
    if (failureReason.nonZeroExit) {
        description = `Exited with status ${failureReason.nonZeroExit}`
    } else if (failureReason.oomKilled) {
        description = `Out of Memory`
    } else if (failureReason.timedOutSeconds) {
        description = `Timed out ` + failureReason.timedOutReason
    } else if (failureReason.unhealthy) {
        description = failureReason.unhealthy
    }

    await sendNotification({
        name: service.name,
        dashboardUrl: service.dashboardUrl,
        color: COLOR_FAILURE,
        titleSuffix: "Failed",
        description,
        showLogsButton: true,
    })
}

// fetchEventInfo fetches the event that triggered the webhook
// some events have additional information that isn't in the webhook payload
// for example, deploy events have the deploy id
async function fetchEventInfo(payload: WebhookPayload): Promise<RenderEvent> {
    const res = await fetch(
        `${renderAPIURL}/events/${payload.data.id}`,
        {
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${renderAPIKey}`,
            },
        },
    )
    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch event info; received code :${res.status.toString()}`)
    }
}

async function fetchServiceInfo(payload: WebhookPayload): Promise<RenderService> {
    const res = await fetch(
        `${renderAPIURL}/services/${payload.data.serviceId}`,
        {
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${renderAPIKey}`,
            },
        },
    )
    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch service info; received code :${res.status.toString()}`)
    }
}

async function fetchPostgresInfo(payload: WebhookPayload): Promise<RenderPostgres> {
    const res = await fetch(
        `${renderAPIURL}/postgres/${payload.data.serviceId}`,
        {
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${renderAPIKey}`,
            },
        },
    )
    if (res.ok) {
        return res.json()
    } else {
        throw new Error(`unable to fetch postgres info; received code :${res.status.toString()}`)
    }
}

process.on('SIGTERM', () => {
    console.debug('SIGTERM signal received: closing HTTP server')
    server.close(() => {
        console.debug('HTTP server closed')
    })
})
