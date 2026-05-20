interface WebhookData {
    id: string
    serviceId: string
    serviceName?: string
    status?: "succeeded" | "failed" | "canceled"
}

export interface WebhookPayload {
    type: string
    timestamp: Date
    data: WebhookData
}

export interface RenderService {
    id: string
    name: string
    dashboardUrl: string
}

export interface RenderPostgres {
    id: string
    name: string
    dashboardUrl: string
}

export interface RenderEvent {
    id: string
    type: string
    details: any
}
