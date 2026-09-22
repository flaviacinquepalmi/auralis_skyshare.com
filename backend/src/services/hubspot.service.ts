import { env } from "../config/env";
import { logger } from "../utils/logger";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

type HubSpotProperty = {
  name: string;
  label: string;
  fieldType?: string;
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
};

type HubSpotPipeline = {
  id: string;
  label: string;
  displayOrder?: number;
  stages?: Array<{
    id: string;
    label: string;
    displayOrder?: number;
    metadata?: Record<string, string>;
  }>;
};

type FlightRequestForHubSpot = {
  requestId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  from: string;
  to: string;
  departureDate: string;
  preferredTime?: string;
  passengers: number;
  aircraftCategory?: string;
  requestType: "Richiesta Empty Leg" | "Richiesta volo su misura" | "Altro";
  leadSource: string;
};

class HubSpotApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "HubSpotApiError";
    this.status = status;
    this.body = body;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isHubSpotEnabled(): boolean {
  return env.hubspotEnabled && Boolean(env.hubspotAccessToken);
}

async function hubspotFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.hubspotAccessToken) {
    throw new Error("HUBSPOT_ACCESS_TOKEN non configurato");
  }

  const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.hubspotAccessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }

    throw new HubSpotApiError(
      response.status,
      `HubSpot API ${response.status} su ${path}`,
      body
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function findOrCreateContact(input: FlightRequestForHubSpot): Promise<string> {
  const search = await hubspotFetch<{
    results: Array<{ id: string }>;
  }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: input.email.toLowerCase(),
            },
          ],
        },
      ],
      properties: ["email", "firstname", "lastname", "phone"],
      limit: 1,
    }),
  });

  const properties: Record<string, string> = {
    email: input.email.toLowerCase(),
    firstname: input.firstName,
    lastname: input.lastName,
  };
  if (input.phone) properties.phone = input.phone;

  const existing = search.results?.[0];
  if (existing) {
    await hubspotFetch(`/crm/v3/objects/contacts/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return existing.id;
  }

  const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  return created.id;
}

async function loadDealProperties(): Promise<HubSpotProperty[]> {
  try {
    const result = await hubspotFetch<{ results: HubSpotProperty[] }>(
      "/crm/v3/properties/deals"
    );
    return result.results || [];
  } catch (error) {
    logger.warn(
      { error },
      "Impossibile leggere lo schema proprietà HubSpot; uso i nomi interni predefiniti"
    );
    return [];
  }
}

function findPropertyName(
  properties: HubSpotProperty[],
  label: string,
  fallback: string
): string {
  const expected = normalize(label);
  const exact = properties.find((property) => normalize(property.label) === expected);
  return exact?.name || fallback;
}

function findSelectOptionValue(
  properties: HubSpotProperty[],
  propertyName: string,
  visibleLabel: string,
  fallback: string
): string {
  const property = properties.find((item) => item.name === propertyName);
  const expected = normalize(visibleLabel);
  const option = property?.options?.find(
    (item) => !item.hidden && normalize(item.label) === expected
  );
  return option?.value || fallback;
}

async function resolvePipeline(): Promise<{ pipelineId: string; stageId: string }> {
  try {
    const result = await hubspotFetch<{ results: HubSpotPipeline[] }>(
      "/crm/v3/pipelines/deals"
    );

    const pipelines = result.results || [];
    const pipeline =
      pipelines.find((item) => normalize(item.label) === "sales pipeline") ||
      pipelines.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))[0];

    if (!pipeline) {
      throw new Error("Nessuna pipeline HubSpot trovata");
    }

    const stage =
      pipeline.stages?.find((item) => normalize(item.label) === "nuova richiesta") ||
      pipeline.stages?.sort(
        (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)
      )[0];

    if (!stage) {
      throw new Error("Nessuna fase HubSpot trovata");
    }

    return { pipelineId: pipeline.id, stageId: stage.id };
  } catch (error) {
    logger.warn(
      { error },
      "Impossibile leggere pipeline/fase HubSpot; uso i fallback configurati"
    );
    return {
      pipelineId: env.hubspotPipelineId || "default",
      stageId: env.hubspotNewRequestStageId || "appointmentscheduled",
    };
  }
}

async function resolveDealToContactAssociationTypeId(): Promise<number> {
  try {
    const result = await hubspotFetch<{
      results: Array<{
        category: string;
        typeId: number;
        label: string | null;
      }>;
    }>("/crm/v4/associations/deals/contacts/labels");

    const defaultAssociation = result.results?.find(
      (item) => item.category === "HUBSPOT_DEFINED" && item.label === null
    );

    return defaultAssociation?.typeId || 3;
  } catch (error) {
    logger.warn({ error }, "Impossibile leggere association type; uso deal→contact = 3");
    return 3;
  }
}

async function createDeal(
  input: FlightRequestForHubSpot,
  contactId: string
): Promise<string> {
  const [dealProperties, pipeline, associationTypeId] = await Promise.all([
    loadDealProperties(),
    resolvePipeline(),
    resolveDealToContactAssociationTypeId(),
  ]);

  const passengersProperty = findPropertyName(
    dealProperties,
    "Passeggeri",
    env.hubspotPropertyPassengers || "passeggeri"
  );
  const sourceProperty = findPropertyName(
    dealProperties,
    "Fonte del lead",
    env.hubspotPropertyLeadSource || "fonte_del_lead"
  );
  const fromProperty = findPropertyName(
    dealProperties,
    "Percorso da",
    env.hubspotPropertyRouteFrom || "percorso_da"
  );
  const toProperty = findPropertyName(
    dealProperties,
    "Percorso a",
    env.hubspotPropertyRouteTo || "percorso_a"
  );
  const requestIdProperty = findPropertyName(
    dealProperties,
    "ID richiesta volo",
    env.hubspotPropertyRequestId || "id_richiesta_volo"
  );
  const departureProperty = findPropertyName(
    dealProperties,
    "Data di partenza",
    env.hubspotPropertyDepartureDate || "data_di_partenza"
  );
  const dealTypeProperty = findPropertyName(
    dealProperties,
    "Tipo di trattativa",
    env.hubspotPropertyDealType || "dealtype"
  );

  const dealTypeFallback =
    input.requestType === "Richiesta Empty Leg"
      ? "new_customer"
      : input.requestType === "Richiesta volo su misura"
        ? "existing_customer"
        : "";

  const dealTypeValue = findSelectOptionValue(
    dealProperties,
    dealTypeProperty,
    input.requestType,
    dealTypeFallback
  );

  const leadSourceValue = findSelectOptionValue(
    dealProperties,
    sourceProperty,
    input.leadSource,
    input.leadSource
  );

  const properties: Record<string, string> = {
    dealname: `${input.from} → ${input.to} · ${input.passengers} pax · ${input.departureDate}`,
    pipeline: pipeline.pipelineId,
    dealstage: pipeline.stageId,
    [passengersProperty]: String(input.passengers),
    [sourceProperty]: leadSourceValue,
    [fromProperty]: input.from,
    [toProperty]: input.to,
    [requestIdProperty]: input.requestId,
    [departureProperty]: input.departureDate,
  };

  if (dealTypeValue) {
    properties[dealTypeProperty] = dealTypeValue;
  }

  const created = await hubspotFetch<{ id: string }>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({
      properties,
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId,
            },
          ],
        },
      ],
    }),
  });

  return created.id;
}

export async function syncFlightRequestToHubSpot(
  input: FlightRequestForHubSpot
): Promise<{ contactId: string; dealId: string } | null> {
  if (!isHubSpotEnabled()) {
    logger.info("HubSpot disabilitato: richiesta volo non sincronizzata nel CRM");
    return null;
  }

  const contactId = await findOrCreateContact(input);
  const dealId = await createDeal(input, contactId);

  logger.info(
    { contactId, dealId, requestId: input.requestId },
    "Richiesta volo sincronizzata con HubSpot"
  );

  return { contactId, dealId };
}
