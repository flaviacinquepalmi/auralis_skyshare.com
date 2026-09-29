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
  from?: string;
  to?: string;
  departureDate?: string;
  preferredTime?: string;
  passengers?: number;
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
    signal: init.signal || AbortSignal.timeout(15000),
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
    dealname: `${input.from || "Da definire"} → ${input.to || "Da definire"} · ${input.passengers ? `${input.passengers} pax` : "Passeggeri da definire"} · ${input.departureDate || "Data da definire"}`,
    pipeline: pipeline.pipelineId,
    dealstage: pipeline.stageId,
    [sourceProperty]: leadSourceValue,
    [requestIdProperty]: input.requestId,
  };

  if (input.passengers !== undefined) properties[passengersProperty] = String(input.passengers);
  if (input.from) properties[fromProperty] = input.from;
  if (input.to) properties[toProperty] = input.to;
  if (input.departureDate) properties[departureProperty] = input.departureDate;

  if (dealTypeValue) {
    properties[dealTypeProperty] = dealTypeValue;
  }

  // Reconcile a previous attempt before creating another deal for this request.
  const existing = await hubspotFetch<{ results: Array<{ id: string }> }>(
    "/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify({ filterGroups: [{ filters: [
        { propertyName: requestIdProperty, operator: "EQ", value: input.requestId }
      ] }], limit: 1 }),
    });
  if (existing.results[0]) return existing.results[0].id;

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


export type CustomerCrmRequest = {
  requestId: string;
  hubspotDealId: string;
  from: string | null;
  to: string | null;
  departureDate: string | null;
  passengers: number | null;
  status: string;
  createdAt: Date;
};

type DealRecord = { id: string; properties: Record<string, string | null> };

function customerRequestStatus(label: string): string {
  const statuses: Record<string, string> = {
    "nuova richiesta": "Richiesta ricevuta",
    "da qualificare": "In verifica",
    "disponibilita in verifica": "In verifica",
    "disponibilita confermata": "Disponibilità confermata",
    "preventivo inviato": "Preventivo inviato",
    "cliente interessato": "Preventivo inviato",
    "prenotazione confermata": "Prenotazione confermata",
    "closed won": "Prenotazione confermata",
    "chiuso perso": "Chiusa",
    "closed lost": "Chiusa",
  };
  return statuses[normalize(label)] || "In lavorazione";
}

async function customerDealMetadata() {
  const schema = await loadDealProperties();
  const fields = {
    requestId: findPropertyName(schema, "ID richiesta volo", env.hubspotPropertyRequestId || "id_richiesta_volo"),
    from: findPropertyName(schema, "Percorso da", env.hubspotPropertyRouteFrom || "percorso_da"),
    to: findPropertyName(schema, "Percorso a", env.hubspotPropertyRouteTo || "percorso_a"),
    departureDate: findPropertyName(schema, "Data di partenza", env.hubspotPropertyDepartureDate || "data_di_partenza"),
    passengers: findPropertyName(schema, "Passeggeri", env.hubspotPropertyPassengers || "passeggeri"),
  };
  const pipelines = await hubspotFetch<{ results: HubSpotPipeline[] }>("/crm/v3/pipelines/deals");
  const stages = new Map<string, string>();
  for (const pipeline of pipelines.results) {
    for (const stage of pipeline.stages || []) stages.set(`${pipeline.id}:${stage.id}`, stage.label);
  }
  const properties = [...Object.values(fields), "pipeline", "dealstage", "createdate"];
  function map(deal: DealRecord): CustomerCrmRequest | null {
    const p = deal.properties;
    const requestId = p[fields.requestId];
    if (!requestId || !/^AFR-[A-Z0-9-]+$/i.test(requestId)) return null;
    const date = p[fields.departureDate];
    const parsedDate = date ? new Date(/^\d{13}$/.test(date) ? Number(date) : date) : null;
    const createdAt = new Date(p.createdate || "");
    const passengers = p[fields.passengers] ? Number(p[fields.passengers]) : null;
    return {
      requestId, hubspotDealId: deal.id,
      from: p[fields.from] || null, to: p[fields.to] || null,
      departureDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : null,
      passengers: passengers !== null && Number.isInteger(passengers) && passengers > 0 ? passengers : null,
      status: customerRequestStatus(stages.get(`${p.pipeline}:${p.dealstage}`) || ""),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
  }
  return { fields, properties, map };
}

// Used only after the backend verifies ownership of the email through Auth0.
export async function listFlightRequestsForEmail(email: string): Promise<CustomerCrmRequest[]> {
  if (!isHubSpotEnabled()) return [];
  const contacts = await hubspotFetch<{ results: Array<{ id: string }> }>(
    "/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({ filterGroups: [{ filters: [
        { propertyName: "email", operator: "EQ", value: email.trim().toLowerCase() }
      ] }], limit: 1 }),
    });
  const contact = contacts.results[0];
  if (!contact) return [];
  const metadata = await customerDealMetadata();
  const results: CustomerCrmRequest[] = [];
  let after: string | undefined;
  do {
    const page = await hubspotFetch<{ results: DealRecord[]; paging?: { next?: { after: string } } }>(
      "/crm/v3/objects/deals/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [
            { propertyName: "associations.contact", operator: "EQ", value: contact.id },
            { propertyName: metadata.fields.requestId, operator: "HAS_PROPERTY" },
          ] }], properties: metadata.properties,
          sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
          limit: 100, ...(after ? { after } : {}),
        }),
      });
    for (const deal of page.results) {
      const request = metadata.map(deal);
      if (request) results.push(request);
    }
    after = page.paging?.next?.after;
  } while (after);
  return results;
}

// IDs must come from the database rows owned by the authenticated user.
export async function readCustomerDeals(ids: string[]): Promise<CustomerCrmRequest[]> {
  if (!isHubSpotEnabled() || !ids.length) return [];
  const metadata = await customerDealMetadata();
  const results: CustomerCrmRequest[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = await hubspotFetch<{ results: DealRecord[] }>("/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify({ properties: metadata.properties, inputs: ids.slice(offset, offset + 100).map(id => ({ id })) }),
    });
    for (const deal of batch.results) {
      const request = metadata.map(deal);
      if (request) results.push(request);
    }
  }
  return results;
}
