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

const COLOR_GREEN = "#57F287"
const COLOR_RED = "#ED4245"
const COLOR_YELLOW = "#FEE75C"

interface EventStyle {
    color: string;
    emoji: string;
    title: string;
    summary: string;
    showLogsButton?: boolean;
}

type EmbedField = {name: string; value: string; inline?: boolean}

function getEventStyle(payload: WebhookPayload): EventStyle | null {
    switch (payload.type) {
        case "deploy_started":
            return {
                color: COLOR_YELLOW,
                emoji: "🚀",
                title: "Deploy Started",
                summary: "A new deployment is in progress.",
                showLogsButton: true,
            }
        case "deploy_ended":
            switch (payload.data.status) {
                case "succeeded":
                    return {
                        color: COLOR_GREEN,
                        emoji: "✅",
                        title: "Deploy Succeeded",
                        summary: "The latest version is now live.",
                        showLogsButton: true,
                    }
                case "failed":
                    return {
                        color: COLOR_RED,
                        emoji: "❌",
                        title: "Deploy Failed",
                        summary: "Deployment did not complete.",
                        showLogsButton: true,
                    }
                case "canceled":
                    return {
                        color: COLOR_YELLOW,
                        emoji: "⏹️",
                        title: "Deploy Canceled",
                        summary: "Deployment was canceled.",
                        showLogsButton: true,
                    }
                default:
                    return {
                        color: COLOR_YELLOW,
                        emoji: "🚀",
                        title: "Deploy Ended",
                        summary: `Deployment ended with status: ${payload.data.status ?? "unknown"}.`,
                        showLogsButton: true,
                    }
            }
        case "maintenance_started":
            return {
                color: COLOR_YELLOW,
                emoji: "🔧",
                title: "Maintenance Started",
                summary: "A platform maintenance window has started.",
            }
        case "maintenance_ended":
            return {
                color: COLOR_GREEN,
                emoji: "✅",
                title: "Maintenance Ended",
                summary: "The platform maintenance window has ended.",
            }
        case "service_suspended":
            return {
                color: COLOR_RED,
                emoji: "⏸️",
                title: "Service Suspended",
                summary: "The service has been suspended.",
            }
        case "server_failed":
            return {
                color: COLOR_RED,
                emoji: "❌",
                title: "Server Failed",
                summary: "The service is no longer running.",
                showLogsButton: true,
            }
        case "postgres_backup_completed":
            return {
                color: COLOR_GREEN,
                emoji: "✅",
                title: "Backup Completed",
                summary: "Postgres backup completed successfully.",
            }
        case "postgres_backup_failed":
            return {
                color: COLOR_RED,
                emoji: "❌",
                title: "Backup Failed",
                summary: "Postgres backup did not complete.",
            }
        case "postgres_unavailable":
            return {
                color: COLOR_RED,
                emoji: "⚠️",
                title: "Postgres Unavailable",
                summary: "The Postgres database is currently unavailable.",
            }
        default:
            return null
    }
}

function describeFailureReason(failureReason: any): string {
    if (!failureReason) return "Unknown reason"
    if (failureReason.nonZeroExit) {
        return `Exited with status ${failureReason.nonZeroExit}`
    }
    if (failureReason.oomKilled) {
        return "Out of memory"
    }
    if (failureReason.timedOutSeconds) {
        return `Timed out ${failureReason.timedOutReason ?? ""}`.trim()
    }
    if (failureReason.unhealthy) {
        return failureReason.unhealthy
    }
    return "Unknown reason"
}

async function handleWebhook(payload: WebhookPayload) {
    try {
        const style = getEventStyle(payload)
        if (!style) {
            console.log(`unhandled webhook type ${payload.type} for service ${payload.data.serviceId}`)
            return
        }

        const isPostgres = payload.type.startsWith("postgres_")
        const resource = isPostgres
            ? await fetchPostgresInfo(payload)
            : await fetchServiceInfo(payload)

        const fields: EmbedField[] = []
        if (payload.type === "server_failed") {
            const event = await fetchEventInfo(payload)
            fields.push({name: "Reason", value: describeFailureReason(event.details?.reason)})
        }

        console.log(`sending discord message for ${resource.name} (${payload.type})`)
        await sendNotification({
            name: resource.name,
            dashboardUrl: resource.dashboardUrl,
            style,
            fields,
        })
    } catch (error) {
        console.error(error)
    }
}

async function sendNotification(opts: {
    name: string;
    dashboardUrl: string;
    style: EventStyle;
    fields: EmbedField[];
}) {
    const channel = await client.channels.fetch(discordChannelID);
    if (!channel) {
        throw new Error(`unable to find specified Discord channel ${discordChannelID}`);
    }

    if (!channel.isSendable()) {
        throw new Error(`specified Discord channel ${discordChannelID} is not sendable`);
    }

    const embed = new EmbedBuilder()
        .setColor(opts.style.color as ColorResolvable)
        .setAuthor({name: "Render"})
        .setTitle(`${opts.style.emoji}  ${opts.style.title}`)
        .setURL(opts.dashboardUrl)
        .setDescription(`**${opts.name}**\n${opts.style.summary}`)
        .setFooter({text: "Render Webhook"})
        .setTimestamp(new Date())

    if (opts.fields.length > 0) {
        embed.addFields(opts.fields)
    }

    const buttons: ButtonBuilder[] = [
        new ButtonBuilder()
            .setLabel("Open Dashboard")
            .setURL(opts.dashboardUrl)
            .setStyle(ButtonStyle.Link),
    ]
    if (opts.style.showLogsButton) {
        buttons.push(
            new ButtonBuilder()
                .setLabel("View Logs")
                .setURL(`${opts.dashboardUrl}/logs`)
                .setStyle(ButtonStyle.Link),
        )
    }
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons)

    await channel.send({embeds: [embed], components: [row]})
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
