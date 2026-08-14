"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type AzureResource = {
  id: string;
  name: string;
  type: string;
  resourceGroup?: string;
  location?: string;
  kind?: string;
  sku?: Record<string, unknown>;
  tags?: Record<string, string>;
  properties?: Record<string, unknown>;
};

type StateResource = {
  address: string;
  id: string;
};

type Subscription = {
  subscriptionId: string;
  displayName: string;
  state?: string;
};

type TokenState = {
  accessToken: string;
  refreshToken?: string;
  storageRefreshToken?: string;
  expiresAt: number;
};

type UnmanagedResource = AzureResource & {
  terraformType: string;
  baseAddress: string;
  address: string;
  modulePath?: string;
  confidence: "high" | "medium" | "manual";
};

type ModuleRule = {
  match: string;
  module: string;
  name?: string;
};

const azureScope = "offline_access https://management.azure.com/user_impersonation";
const storageScope = "https://storage.azure.com/user_impersonation";
const storageInteractiveScope = `offline_access ${storageScope}`;
const authStateKey = "azure-import-web-auth-state";
const authModeKey = "azure-import-web-auth-mode";
const verifierKey = "azure-import-web-code-verifier";
const tenantId = "d4ae2391-a29e-4697-9db1-da7b68f5a3b4";

const resourceGraphQuery =
  "Resources | project id, name, type, resourceGroup, location, kind, sku, tags, properties | order by type asc, name asc";

const sampleAzure = JSON.stringify(
  [
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-core",
      name: "prod-core",
      type: "microsoft.resources/subscriptions/resourcegroups",
      location: "eastus",
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-core/providers/Microsoft.Storage/storageAccounts/prodcorelogs01",
      name: "prodcorelogs01",
      type: "microsoft.storage/storageaccounts",
      resourceGroup: "prod-core",
      location: "eastus",
      sku: { name: "Standard_LRS", tier: "Standard" },
      kind: "StorageV2",
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-core/providers/Microsoft.Network/virtualNetworks/prod-vnet",
      name: "prod-vnet",
      type: "microsoft.network/virtualnetworks",
      resourceGroup: "prod-core",
      location: "eastus",
      properties: {
        addressSpace: {
          addressPrefixes: ["10.42.0.0/16"],
        },
      },
    },
  ],
  null,
  2,
);

const sampleState = JSON.stringify(
  {
    version: 4,
    resources: [
      {
        mode: "managed",
        type: "azurerm_resource_group",
        name: "prod_core",
        instances: [
          {
            attributes: {
              id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-core",
            },
          },
        ],
      },
    ],
  },
  null,
  2,
);

const typeMap: Record<string, string> = {
  "microsoft.resources/subscriptions/resourcegroups": "azurerm_resource_group",
  "microsoft.storage/storageaccounts": "azurerm_storage_account",
  "microsoft.network/virtualnetworks": "azurerm_virtual_network",
  "microsoft.network/networksecuritygroups": "azurerm_network_security_group",
  "microsoft.network/publicipaddresses": "azurerm_public_ip",
  "microsoft.network/networkinterfaces": "azurerm_network_interface",
  "microsoft.network/loadbalancers": "azurerm_lb",
  "microsoft.compute/virtualmachines": "azurerm_linux_virtual_machine",
  "microsoft.compute/disks": "azurerm_managed_disk",
  "microsoft.keyvault/vaults": "azurerm_key_vault",
  "microsoft.web/sites": "azurerm_linux_web_app",
  "microsoft.web/serverfarms": "azurerm_service_plan",
  "microsoft.sql/servers": "azurerm_mssql_server",
  "microsoft.sql/servers/databases": "azurerm_mssql_database",
  "microsoft.containerregistry/registries": "azurerm_container_registry",
  "microsoft.containerservice/managedclusters": "azurerm_kubernetes_cluster",
  "microsoft.insights/components": "azurerm_application_insights",
  "microsoft.operationalinsights/workspaces": "azurerm_log_analytics_workspace",
};

const sampleModuleRules = JSON.stringify(
  [
    {
      match: "microsoft.storage/*",
      module: "module.storage",
    },
    {
      match: "microsoft.network/*",
      module: "module.network",
    },
    {
      match: "microsoft.keyvault/vaults",
      module: "module.security",
    },
    {
      match: "microsoft.operationalinsights/*",
      module: "module.monitoring",
    },
    {
      match: "microsoft.insights/*",
      module: "module.monitoring",
    },
  ],
  null,
  2,
);

function normalizeId(id: string) {
  return id.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeModulePath(modulePath: string) {
  return modulePath
    .trim()
    .replace(/\.+$/g, "")
    .replace(/^module\./, "module.");
}

function parseModuleRules(input: string): ModuleRule[] {
  if (!input.trim()) return [];
  const parsed = JSON.parse(input);
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((row) => ({
      match: String(row.match ?? "").trim().toLowerCase(),
      module: normalizeModulePath(String(row.module ?? "")),
      name: row.name ? safeName(String(row.name)) : undefined,
    }))
    .filter((rule) => rule.match && rule.module.startsWith("module."));
}

function safeName(name: string) {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return /^[a-z_]/.test(cleaned) ? cleaned || "imported" : `r_${cleaned}`;
}

function localNameFromAddress(address: string) {
  return address.split(".").at(-1)?.replace(/\[.*\]$/, "") || "imported";
}

function moduleRuleMatches(resource: AzureResource, rule: ModuleRule) {
  const resourceType = resource.type.toLowerCase();
  if (rule.match.endsWith("/*")) {
    return resourceType.startsWith(rule.match.slice(0, -1));
  }
  return resourceType === rule.match;
}

function applyModuleRules(
  resources: UnmanagedResource[],
  rules: ModuleRule[],
  state: StateResource[],
) {
  const seenAddresses = new Set(state.map((resource) => resource.address));

  return resources.map((resource): UnmanagedResource => {
    const rule = rules.find((candidate) => moduleRuleMatches(resource, candidate));
    const localName = rule?.name ?? localNameFromAddress(resource.baseAddress);
    const baseAddress = rule
      ? `${rule.module}.${resource.terraformType}.${localName}`
      : resource.baseAddress;
    let address = baseAddress;
    let counter = 2;

    while (seenAddresses.has(address)) {
      address = `${baseAddress}_${counter}`;
      counter += 1;
    }
    seenAddresses.add(address);

    return {
      ...resource,
      address,
      modulePath: rule?.module,
    };
  });
}

function parseJson(input: string) {
  if (!input.trim()) return null;
  return JSON.parse(input);
}

function inferNameFromId(id: string) {
  return id.split("/").filter(Boolean).at(-1) ?? "resource";
}

function unwrapAzureRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.value)) return record.value;
    if (Array.isArray(record.rows) && Array.isArray(record.columns)) {
      const columns = record.columns as Array<{ name?: string }>;
      return (record.rows as unknown[][]).map((row) =>
        Object.fromEntries(columns.map((column, index) => [column.name, row[index]])),
      );
    }
  }
  return [];
}

function parseAzureResources(input: string): AzureResource[] {
  return unwrapAzureRows(parseJson(input))
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? inferNameFromId(String(row.id ?? ""))),
      type: String(row.type ?? ""),
      resourceGroup: row.resourceGroup ? String(row.resourceGroup) : undefined,
      location: row.location ? String(row.location) : undefined,
      kind: row.kind ? String(row.kind) : undefined,
      sku: row.sku && typeof row.sku === "object" ? (row.sku as Record<string, unknown>) : undefined,
      tags: normalizeTags(row.tags),
      properties:
        row.properties && typeof row.properties === "object"
          ? (row.properties as Record<string, unknown>)
          : undefined,
    }))
    .filter((resource) => resource.id && resource.type);
}

function normalizeTags(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const tags = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, tagValue]) => tagValue !== null && tagValue !== undefined)
      .map(([key, tagValue]) => [key, String(tagValue)]),
  );
  return Object.keys(tags).length ? tags : undefined;
}

function parseStateResources(input: string): StateResource[] {
  const state = parseJson(input);
  if (!state || typeof state !== "object") return [];
  const resources = (state as { resources?: unknown[] }).resources ?? [];

  return resources.flatMap((resource) => {
    if (!resource || typeof resource !== "object") return [];
    const record = resource as Record<string, unknown>;
    if (record.mode && record.mode !== "managed") return [];
    const modulePrefix = record.module ? `${record.module}.` : "";
    const type = String(record.type ?? "");
    const name = String(record.name ?? "");
    const instances = Array.isArray(record.instances) ? record.instances : [];

    return instances.flatMap((instance, index) => {
      const instanceRecord = instance as { attributes?: Record<string, unknown>; index_key?: string | number };
      const id = String(instanceRecord.attributes?.id ?? "");
      if (!id) return [];
      const suffix =
        instanceRecord.index_key !== undefined
          ? `[${JSON.stringify(instanceRecord.index_key)}]`
          : instances.length > 1
            ? `[${index}]`
            : "";
      return [{ address: `${modulePrefix}${type}.${name}${suffix}`, id }];
    });
  });
}

function compareResources(azure: AzureResource[], state: StateResource[]) {
  const managedIds = new Set(state.map((resource) => normalizeId(resource.id)));
  const seenAddresses = new Set(state.map((resource) => resource.address));

  return azure
    .filter((resource) => !managedIds.has(normalizeId(resource.id)))
    .map((resource): UnmanagedResource => {
      const terraformType = typeMap[resource.type.toLowerCase()] ?? "azapi_resource";
      const baseAddress = `${terraformType}.${safeName(resource.name)}`;
      let address = baseAddress;
      let counter = 2;
      while (seenAddresses.has(address)) {
        address = `${baseAddress}_${counter}`;
        counter += 1;
      }
      seenAddresses.add(address);

      return {
        ...resource,
        terraformType,
        baseAddress,
        address,
        confidence: typeMap[resource.type.toLowerCase()]
          ? resource.type.toLowerCase().includes("virtualmachines") ||
            resource.type.toLowerCase().includes("sites")
            ? "medium"
            : "high"
          : "manual",
      };
    });
}

function buildImportBlocks(resources: UnmanagedResource[]) {
  return resources
    .map(
      (resource) => `import {
  to = ${resource.address}
  id = "${resource.id}"
}`,
    )
    .join("\n\n");
}

function hclString(value: string) {
  return JSON.stringify(value);
}

function hclList(values: string[]) {
  return `[${values.map(hclString).join(", ")}]`;
}

function hclTags(tags?: Record<string, string>) {
  if (!tags || !Object.keys(tags).length) return "";
  const lines = Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `    ${hclString(key)} = ${hclString(value)}`);
  return `\n  tags = {\n${lines.join("\n")}\n  }\n`;
}

function resourceBlock(resource: UnmanagedResource, body: string) {
  const terraformName = localNameFromAddress(resource.baseAddress) || safeName(resource.name);
  const moduleHint = resource.modulePath
    ? `  # Module target: ${resource.address}\n  # Place this resource block inside ${resource.modulePath} or adapt it to that module's inputs.\n`
    : "";
  return `resource "${resource.terraformType}" "${terraformName}" {\n${moduleHint}${body.trimEnd()}\n}`;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function getStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function resourceGroupLine(resource: UnmanagedResource) {
  return resource.resourceGroup ? `  resource_group_name = ${hclString(resource.resourceGroup)}\n` : "";
}

function locationLine(resource: UnmanagedResource) {
  return resource.location ? `  location            = ${hclString(resource.location)}\n` : "";
}

function storageAccountParts(resource: UnmanagedResource) {
  const skuName = getString(resource.sku?.name) ?? "Standard_LRS";
  const [tier = "Standard", replication = "LRS"] = skuName.split("_");
  return { tier, replication };
}

function parentIdFromAzureId(id: string) {
  const lower = id.toLowerCase();
  const providerIndex = lower.lastIndexOf("/providers/");
  return providerIndex > 0 ? id.slice(0, providerIndex) : id.split("/").slice(0, -2).join("/");
}

function buildTerraformConfigBlock(resource: UnmanagedResource) {
  const type = resource.type.toLowerCase();
  const tags = hclTags(resource.tags);

  if (type === "microsoft.resources/subscriptions/resourcegroups") {
    return resourceBlock(
      resource,
      `  name     = ${hclString(resource.name)}
${locationLine(resource)}${tags}`,
    );
  }

  if (type === "microsoft.storage/storageaccounts") {
    const { tier, replication } = storageAccountParts(resource);
    return resourceBlock(
      resource,
      `  name                     = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  account_tier             = ${hclString(tier)}
  account_replication_type = ${hclString(replication)}
${resource.kind ? `  account_kind             = ${hclString(resource.kind)}\n` : ""}${tags}`,
    );
  }

  if (type === "microsoft.network/virtualnetworks") {
    const addressSpace = resource.properties?.addressSpace as Record<string, unknown> | undefined;
    const prefixes = getStringList(addressSpace?.addressPrefixes);
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  address_space       = ${hclList(prefixes.length ? prefixes : ["10.0.0.0/16"])}
${tags}`,
    );
  }

  if (type === "microsoft.network/networksecuritygroups") {
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}${tags}
  # TODO: Add security_rule blocks from Azure before applying changes.
`,
    );
  }

  if (type === "microsoft.network/publicipaddresses") {
    const allocationMethod = getString(resource.properties?.publicIPAllocationMethod) ?? "Static";
    const skuName = getString(resource.sku?.name);
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  allocation_method   = ${hclString(allocationMethod)}
${skuName ? `  sku                 = ${hclString(skuName)}\n` : ""}${tags}`,
    );
  }

  if (type === "microsoft.network/networkinterfaces") {
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}${tags}
  # TODO: Add ip_configuration blocks from Azure before applying changes.
`,
    );
  }

  if (type === "microsoft.network/loadbalancers") {
    const skuName = getString(resource.sku?.name);
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}${skuName ? `  sku                 = ${hclString(skuName)}\n` : ""}${tags}
  # TODO: Add frontend_ip_configuration blocks from Azure before applying changes.
`,
    );
  }

  if (type === "microsoft.compute/disks") {
    const skuName = getString(resource.sku?.name) ?? "Standard_LRS";
    const diskSize = resource.properties?.diskSizeGB;
    return resourceBlock(
      resource,
      `  name                 = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  storage_account_type = ${hclString(skuName)}
  create_option        = "Empty"
${typeof diskSize === "number" ? `  disk_size_gb         = ${diskSize}\n` : ""}${tags}
  # TODO: Confirm create_option and disk settings against Azure before applying changes.
`,
    );
  }

  if (type === "microsoft.keyvault/vaults") {
    const tenantId = getString(resource.properties?.tenantId) ?? "00000000-0000-0000-0000-000000000000";
    const sku = resource.properties?.sku as Record<string, unknown> | undefined;
    const skuName = getString(sku?.name) ?? "standard";
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  tenant_id           = ${hclString(tenantId)}
  sku_name            = ${hclString(skuName.toLowerCase())}
${tags}
  # TODO: Add access_policy or RBAC settings from Azure before applying changes.
`,
    );
  }

  if (type === "microsoft.containerregistry/registries") {
    const skuName = getString(resource.sku?.name) ?? "Basic";
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  sku                 = ${hclString(skuName)}
${tags}`,
    );
  }

  if (type === "microsoft.operationalinsights/workspaces") {
    const sku = resource.properties?.sku as Record<string, unknown> | undefined;
    const skuName = getString(sku?.name) ?? "PerGB2018";
    const retention = resource.properties?.retentionInDays;
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  sku                 = ${hclString(skuName)}
${typeof retention === "number" ? `  retention_in_days   = ${retention}\n` : ""}${tags}`,
    );
  }

  if (type === "microsoft.insights/components") {
    const applicationType = getString(resource.kind) ?? "web";
    return resourceBlock(
      resource,
      `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  application_type    = ${hclString(applicationType)}
${tags}`,
    );
  }

  if (type === "microsoft.sql/servers") {
    return resourceBlock(
      resource,
      `  name                         = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}  version                      = "12.0"
  administrator_login          = "TODO_admin"
  administrator_login_password = "TODO_replace_with_sensitive_variable"
${tags}
  # TODO: Replace administrator credentials with variables or Key Vault references.
`,
    );
  }

  if (type === "microsoft.sql/servers/databases") {
    const serverName = resource.id.split("/").filter(Boolean).at(-3) ?? "TODO_server_name";
    const skuName = getString(resource.sku?.name);
    return resourceBlock(
      resource,
      `  name      = ${hclString(resource.name)}
  server_id = azurerm_mssql_server.${safeName(serverName)}.id
${skuName ? `  sku_name  = ${hclString(skuName)}\n` : ""}${tags}
  # TODO: Confirm server_id and database settings before applying changes.
`,
    );
  }

  if (["microsoft.compute/virtualmachines", "microsoft.web/sites", "microsoft.containerservice/managedclusters"].includes(type)) {
    return `# ${resource.terraformType}.${safeName(resource.name)}
# This resource type has many required nested settings. Import it first, then use:
# terraform state show ${resource.address}
# to build the final resource block from the imported state.
${resourceBlock(
  resource,
  `  name                = ${hclString(resource.name)}
${resourceGroupLine(resource)}${locationLine(resource)}${tags}
  # TODO: Fill in required nested blocks before running terraform apply.
`,
)}`;
  }

  const [, terraformName = safeName(resource.name)] = resource.address.split(".");
  return `resource "azapi_resource" "${terraformName}" {
  type      = "${resource.type}@TODO_API_VERSION"
  name      = ${hclString(resource.name)}
  parent_id = ${hclString(parentIdFromAzureId(resource.id))}
${resource.location ? `  location  = ${hclString(resource.location)}\n` : ""}  body = jsonencode({})

  # TODO: Replace TODO_API_VERSION and body with the exported Azure properties.
}`;
}

function buildTerraformConfigBlocks(resources: UnmanagedResource[]) {
  return resources.map(buildTerraformConfigBlock).join("\n\n");
}

function buildReviewMarkdown(resources: UnmanagedResource[], moduleRules: ModuleRule[]) {
  const generatedAt = new Date().toISOString();
  const highRisk = resources.filter((resource) =>
    ["medium", "manual"].includes(resource.confidence),
  );

  return `# Terraform Import Review

Generated: ${generatedAt}

## Package Contents

- \`imports.tf\` - Terraform import blocks for resources not currently in state.
- \`generated-resources.tf\` - Starter Terraform resource blocks.
- \`resource-inventory.json\` - JSON inventory of import candidates and module targets.
- \`module-rules.json\` - Module mapping rules used for this export.

## Suggested Workflow

1. Copy \`generated-resources.tf\` into the correct Terraform root or module locations.
2. Review every TODO comment before running Terraform.
3. Copy \`imports.tf\` into the Terraform root module.
4. Run \`terraform fmt\`.
5. Run \`terraform plan\` and reconcile generated configuration until no unwanted changes remain.
6. Run \`terraform apply\` only after the plan matches expectations.

## Summary

- Import candidates: ${resources.length}
- Module rules: ${moduleRules.length}
- High confidence: ${resources.filter((resource) => resource.confidence === "high").length}
- Needs review: ${highRisk.length}

## Resources Requiring Extra Review

${
  highRisk.length
    ? highRisk
        .map(
          (resource) =>
            `- ${resource.address} (${resource.type}) - ${resource.confidence} confidence`,
        )
        .join("\n")
    : "- None flagged by the generator."
}

## Notes

Generated Terraform blocks are first drafts. Azure resources with nested settings, secrets,
identity, networking, policies, private endpoints, access policies, or provider-specific defaults
will require manual reconciliation with \`terraform plan\` and \`terraform state show\`.
`;
}

function buildResourceInventory(resources: UnmanagedResource[]) {
  return JSON.stringify(
    resources.map((resource) => ({
      name: resource.name,
      azureType: resource.type,
      terraformType: resource.terraformType,
      address: resource.address,
      baseAddress: resource.baseAddress,
      modulePath: resource.modulePath ?? null,
      confidence: resource.confidence,
      resourceGroup: resource.resourceGroup ?? null,
      location: resource.location ?? null,
      id: resource.id,
    })),
    null,
    2,
  );
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(value: number) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function writeUint32(value: number) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function dosTimestamp(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const year = Math.max(date.getFullYear(), 1980);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const { time, day } = dosTimestamp();
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const localHeader = new Uint8Array([
      ...writeUint32(0x04034b50),
      ...writeUint16(20),
      ...writeUint16(0),
      ...writeUint16(0),
      ...writeUint16(time),
      ...writeUint16(day),
      ...writeUint32(checksum),
      ...writeUint32(content.length),
      ...writeUint32(content.length),
      ...writeUint16(name.length),
      ...writeUint16(0),
      ...name,
    ]);
    chunks.push(localHeader, content);

    centralDirectory.push(
      new Uint8Array([
        ...writeUint32(0x02014b50),
        ...writeUint16(20),
        ...writeUint16(20),
        ...writeUint16(0),
        ...writeUint16(0),
        ...writeUint16(time),
        ...writeUint16(day),
        ...writeUint32(checksum),
        ...writeUint32(content.length),
        ...writeUint32(content.length),
        ...writeUint16(name.length),
        ...writeUint16(0),
        ...writeUint16(0),
        ...writeUint16(0),
        ...writeUint16(0),
        ...writeUint32(0),
        ...writeUint32(offset),
        ...name,
      ]),
    );

    offset += localHeader.length + content.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  const endRecord = new Uint8Array([
    ...writeUint32(0x06054b50),
    ...writeUint16(0),
    ...writeUint16(0),
    ...writeUint16(files.length),
    ...writeUint16(files.length),
    ...writeUint32(centralDirectorySize),
    ...writeUint32(centralDirectoryOffset),
    ...writeUint16(0),
  ]);

  const allChunks = [...chunks, ...centralDirectory, endRecord];
  const totalLength = allChunks.reduce((total, chunk) => total + chunk.length, 0);
  const zipBytes = new Uint8Array(totalLength);
  let cursor = 0;
  for (const chunk of allChunks) {
    zipBytes.set(chunk, cursor);
    cursor += chunk.length;
  }

  return new Blob([zipBytes.buffer], { type: "application/zip" });
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(text: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as Record<string, any>;
  if (!response.ok) {
    const message = String(
      body?.error?.message ?? body?.error_description ?? body?.message ?? response.statusText,
    );
    if (message.includes("AADSTS9002326")) {
      throw new Error(
        "Azure sign-in is using a redirect URI that is not configured as a Single-page application for this client ID. Confirm you are using the new app registration client ID, add the exact redirect URI under Authentication > Single-page application, remove the same URI from Web redirects, then click Reset Azure login in this app and try again.",
      );
    }
    if (message.includes("AADSTS65001")) {
      throw new Error(
        "Azure Storage consent is required for this app registration. Click Reset Azure login, sign in again, and approve the Azure Storage permission prompt. If your tenant requires admin consent, an administrator must grant delegated consent for Azure Storage user_impersonation on this app registration.",
      );
    }
    throw new Error(message);
  }
  return body as T;
}

export default function Home() {
  const [clientId, setClientId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [token, setToken] = useState<TokenState | null>(null);
  const [azureInput, setAzureInput] = useState(sampleAzure);
  const [stateInput, setStateInput] = useState(sampleState);
  const [moduleRulesInput, setModuleRulesInput] = useState(sampleModuleRules);
  const [filter, setFilter] = useState("");
  const [storageAccount, setStorageAccount] = useState("");
  const [stateContainer, setStateContainer] = useState("");
  const [stateBlob, setStateBlob] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [message, setMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const isSignedIn = Boolean(token && token.expiresAt > Date.now() + 60_000);

  useEffect(() => {
    const currentRedirectUri = `${window.location.origin}${window.location.pathname}`;
    setRedirectUri(currentRedirectUri);

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const storedState = sessionStorage.getItem(authStateKey);
    const verifier = sessionStorage.getItem(verifierKey);
    const authMode = sessionStorage.getItem(authModeKey) ?? "arm";
    const storedClientId = sessionStorage.getItem("azure-import-web-client-id");

    if (storedClientId) setClientId(storedClientId);
    if (!code) return;

    window.history.replaceState({}, document.title, window.location.pathname);
    if (!verifier || !storedClientId || returnedState !== storedState) {
      setMessage("Azure sign-in could not be completed. Start sign-in again.");
      return;
    }

    const scope = authMode === "storage" ? storageInteractiveScope : azureScope;
    exchangeCodeForToken(code, verifier, storedClientId, tenantId, currentRedirectUri, scope)
      .then((nextToken) => {
        if (authMode === "storage") {
          setToken((currentToken) =>
            currentToken
              ? { ...currentToken, storageRefreshToken: nextToken.refreshToken ?? currentToken.storageRefreshToken }
              : { ...nextToken, storageRefreshToken: nextToken.refreshToken },
          );
          setMessage("Azure Storage authorized. You can load Terraform state now.");
          return null;
        }

        setToken(nextToken);
        setMessage("Signed in to Azure. Loading subscriptions...");
        return loadSubscriptions(nextToken.accessToken);
      })
      .then((items) => {
        if (!items) return;
        setSubscriptionId(items[0]?.subscriptionId ?? "");
        setMessage(items.length ? "Choose a subscription to scan." : "No subscriptions returned.");
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => {
        sessionStorage.removeItem(authStateKey);
        sessionStorage.removeItem(authModeKey);
        sessionStorage.removeItem(verifierKey);
      });
  }, []);

  const result = useMemo(() => {
    try {
      const azure = parseAzureResources(azureInput);
      const state = parseStateResources(stateInput);
      const moduleRules = parseModuleRules(moduleRulesInput);
      const unmanaged = applyModuleRules(compareResources(azure, state), moduleRules, state);
      return { azure, state, moduleRules, unmanaged, error: "" };
    } catch (caught) {
      return {
        azure: [],
        state: [],
        moduleRules: [],
        unmanaged: [],
        error: caught instanceof Error ? caught.message : "Could not parse input",
      };
    }
  }, [azureInput, moduleRulesInput, stateInput]);

  const visibleUnmanaged = result.unmanaged.filter((resource) =>
    `${resource.name} ${resource.type} ${resource.resourceGroup ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const importBlocks = buildImportBlocks(visibleUnmanaged);
  const terraformConfigBlocks = buildTerraformConfigBlocks(visibleUnmanaged);
  const resourceGraphCommand = `az graph query -q "${resourceGraphQuery}"${
    subscriptionId ? ` --subscriptions ${subscriptionId}` : ""
  } -o json`;

  async function startLogin() {
    if (!clientId.trim()) {
      setMessage("Enter an Azure app registration client ID first.");
      return;
    }

    const verifier = randomString();
    const challenge = base64UrlEncode(await sha256(verifier));
    const state = randomString();
    const currentRedirectUri = `${window.location.origin}${window.location.pathname}`;
    setRedirectUri(currentRedirectUri);
    sessionStorage.setItem(verifierKey, verifier);
    sessionStorage.setItem(authStateKey, state);
    sessionStorage.setItem(authModeKey, "arm");
    sessionStorage.setItem("azure-import-web-client-id", clientId.trim());

    const url = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`,
    );
    url.searchParams.set("client_id", clientId.trim());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", currentRedirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", azureScope);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    window.location.assign(url.toString());
  }

  async function startStorageAuthorization() {
    if (!clientId.trim()) {
      setMessage("Enter an Azure app registration client ID first.");
      return;
    }

    const verifier = randomString();
    const challenge = base64UrlEncode(await sha256(verifier));
    const state = randomString();
    const currentRedirectUri = `${window.location.origin}${window.location.pathname}`;
    setRedirectUri(currentRedirectUri);
    sessionStorage.setItem(verifierKey, verifier);
    sessionStorage.setItem(authStateKey, state);
    sessionStorage.setItem(authModeKey, "storage");
    sessionStorage.setItem("azure-import-web-client-id", clientId.trim());

    const url = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`,
    );
    url.searchParams.set("client_id", clientId.trim());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", currentRedirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", storageInteractiveScope);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    window.location.assign(url.toString());
  }

  function resetAzureLogin() {
    sessionStorage.removeItem(authStateKey);
    sessionStorage.removeItem(authModeKey);
    sessionStorage.removeItem(verifierKey);
    sessionStorage.removeItem("azure-import-web-client-id");
    sessionStorage.removeItem("azure-import-web-tenant-id");
    setToken(null);
    setSubscriptions([]);
    setSubscriptionId("");
    setMessage("Azure login state reset. Confirm the client ID, then sign in again.");
  }

  async function exchangeCodeForToken(
    code: string,
    verifier: string,
    activeClientId: string,
    activeTenantId: string,
    activeRedirectUri: string,
    scope: string,
  ) {
    const body = new URLSearchParams();
    body.set("client_id", activeClientId);
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", activeRedirectUri);
    body.set("scope", scope);
    body.set("code_verifier", verifier);

    const data = await fetchJson<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>(`https://login.microsoftonline.com/${encodeURIComponent(activeTenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    };
  }

  async function getStorageToken() {
    const refreshToken = token?.storageRefreshToken ?? token?.refreshToken;
    if (!refreshToken) {
      throw new Error("Storage state loading needs Storage authorization. Click Authorize Azure Storage first.");
    }

    const body = new URLSearchParams();
    body.set("client_id", clientId.trim());
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("scope", storageScope);

    const data = await fetchJson<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (data.refresh_token) {
      setToken(token ? { ...token, storageRefreshToken: data.refresh_token } : null);
    }
    return data.access_token;
  }

  async function loadSubscriptions(accessToken = token?.accessToken) {
    if (!accessToken) return [];
    const data = await fetchJson<{ value?: Subscription[] }>(
      "https://management.azure.com/subscriptions?api-version=2020-01-01",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const items = data.value ?? [];
    setSubscriptions(items);
    if (!subscriptionId && items[0]) setSubscriptionId(items[0].subscriptionId);
    return items;
  }

  async function queryAzure() {
    if (!token?.accessToken || !subscriptionId) {
      setMessage("Sign in and choose a subscription first.");
      return;
    }
    setBusyAction("query");
    setMessage("Querying Azure Resource Graph...");
    try {
      const data = await fetchJson<{ data?: AzureResource[] }>(
        "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscriptions: [subscriptionId],
            query: resourceGraphQuery,
            options: { resultFormat: "objectArray" },
          }),
        },
      );
      setAzureInput(JSON.stringify(data.data ?? [], null, 2));
      setMessage(`Loaded ${(data.data ?? []).length} resources from Azure.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Azure query failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function loadStateFromStorage() {
    setBusyAction("storage");
    setMessage("Loading Terraform state from Azure Storage...");
    try {
      const storageToken = await getStorageToken();
      const data = await fetchJson<{ state: string }>("/api/state-blob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountName: storageAccount,
          containerName: stateContainer,
          blobName: stateBlob,
          accessToken: storageToken,
        }),
      });
      setStateInput(data.state);
      setMessage("Terraform state loaded from Azure Storage.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load state from Azure Storage.");
    } finally {
      setBusyAction("");
    }
  }

  async function copyImportBlocks() {
    if (!importBlocks.trim()) {
      setCopyMessage("No import blocks to copy.");
      return;
    }
    await navigator.clipboard.writeText(importBlocks);
    setCopyMessage("Import blocks copied to clipboard.");
  }

  async function copyTerraformConfig() {
    if (!terraformConfigBlocks.trim()) {
      setConfigMessage("No Terraform configuration to copy.");
      return;
    }
    await navigator.clipboard.writeText(terraformConfigBlocks);
    setConfigMessage("Terraform configuration copied to clipboard.");
  }

  function downloadImportBlocks() {
    const blob = new Blob([importBlocks], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "imports.tf";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadTerraformConfig() {
    const blob = new Blob([terraformConfigBlocks], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "generated-resources.tf";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadExportPackage() {
    if (!visibleUnmanaged.length) {
      setExportMessage("No import candidates to export.");
      return;
    }

    const zip = buildZip([
      { name: "imports.tf", content: importBlocks },
      { name: "generated-resources.tf", content: terraformConfigBlocks },
      { name: "README-review.md", content: buildReviewMarkdown(visibleUnmanaged, result.moduleRules) },
      { name: "resource-inventory.json", content: buildResourceInventory(visibleUnmanaged) },
      { name: "module-rules.json", content: JSON.stringify(result.moduleRules, null, 2) },
    ]);
    const url = URL.createObjectURL(zip);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "terraform-import-export.zip";
    anchor.click();
    URL.revokeObjectURL(url);
    setExportMessage("Export package downloaded.");
  }

  return (
    <main className="web-shell">
      <section className="web-hero">
        <div>
          <p className="eyebrow">Azure Terraform Import Planner</p>
          <h1>Web import planning for Azure and Terraform.</h1>
          <p className="lede">
            Sign in, pick a subscription, scan Azure Resource Graph, load Terraform state from
            Azure Storage or paste it manually, and generate import blocks.
          </p>
        </div>
        <Panel title="Azure Connection">
          <label htmlFor="client">App registration client ID</label>
          <input id="client" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <label>Tenant</label>
          <div className="readonly-field mono break">{tenantId}</div>
          <p className="hint">
            Azure setup: App registrations &gt; Authentication &gt; Add a platform &gt; Single-page
            application. Add this exact redirect URI:
            <span className="mono break">{redirectUri}</span>
          </p>
          <p className="hint">
            If Azure shows AADSTS9002326, the URI was added under Web instead of
            Single-page application.
          </p>
          <p className="hint">
            Loading `.tfstate` from Azure Storage uses a separate Storage authorization flow
            because Azure tokens cannot combine ARM and Storage scopes in one request.
          </p>
          <div className="actions">
            <button type="button" onClick={startLogin}>
              {isSignedIn ? "Reconnect Azure" : "Sign in to Azure"}
            </button>
            <button type="button" className="secondary" onClick={resetAzureLogin}>
              Reset Azure login
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!isSignedIn}
              onClick={() => loadSubscriptions().catch((error: Error) => setMessage(error.message))}
            >
              Refresh subscriptions
            </button>
          </div>
          <select
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
            disabled={!subscriptions.length}
          >
            <option value="">Choose a subscription</option>
            {subscriptions.map((subscription) => (
              <option key={subscription.subscriptionId} value={subscription.subscriptionId}>
                {subscription.displayName} ({subscription.subscriptionId})
              </option>
            ))}
          </select>
          {message ? <p className="message">{message}</p> : null}
        </Panel>
      </section>

      <section className="metrics">
        <Metric label="Azure resources" value={result.azure.length} />
        <Metric label="Already in state" value={result.state.length} />
        <Metric label="Import candidates" value={result.unmanaged.length} emphasis />
      </section>

      <section className="grid two">
        <Panel title="Azure Resource Graph">
          <p className="hint">Load resources from Azure or paste Resource Graph JSON manually.</p>
          <pre>{resourceGraphCommand}</pre>
          <button
            type="button"
            onClick={queryAzure}
            disabled={!isSignedIn || !subscriptionId || busyAction === "query"}
          >
            {busyAction === "query" ? "Querying Azure..." : "Query selected subscription"}
          </button>
          <textarea value={azureInput} onChange={(e) => setAzureInput(e.target.value)} />
        </Panel>

        <Panel title="Terraform State">
          <p className="hint">Paste `terraform state pull` output or load remote state.</p>
          <div className="storage-loader">
            <h3>Load state from Azure Storage</h3>
            <label htmlFor="storage">Storage account</label>
            <input id="storage" value={storageAccount} onChange={(e) => setStorageAccount(e.target.value)} />
            <label htmlFor="container">Container</label>
            <input id="container" value={stateContainer} onChange={(e) => setStateContainer(e.target.value)} />
            <label htmlFor="blob">State blob/key</label>
            <input id="blob" value={stateBlob} onChange={(e) => setStateBlob(e.target.value)} />
            <button type="button" className="secondary" onClick={startStorageAuthorization}>
              Authorize Azure Storage
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!isSignedIn || busyAction === "storage"}
              onClick={loadStateFromStorage}
            >
              {busyAction === "storage" ? "Loading state..." : "Load state from Azure Storage"}
            </button>
          </div>
          <textarea value={stateInput} onChange={(e) => setStateInput(e.target.value)} />
        </Panel>
      </section>

      <section className="grid module-grid">
        <Panel title="Module Target Rules">
          <p className="hint">
            Map Azure resource types to Terraform module paths. Use exact matches or wildcard
            prefixes such as `microsoft.network/*`. Add `name` when a module uses a fixed resource
            name like `this`.
          </p>
          <textarea
            className="compact-textarea"
            value={moduleRulesInput}
            onChange={(e) => setModuleRulesInput(e.target.value)}
          />
          <p className="hint">
            Active rules: {result.moduleRules.length}. Matched resources will use module-aware
            import targets while `.tf` blocks keep comments showing where they belong.
          </p>
        </Panel>
      </section>

      <section className="grid results">
        <Panel title="Unmanaged Resources">
          <div className="toolbar">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, type, or resource group"
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAzureInput(sampleAzure);
                setStateInput(sampleState);
                setModuleRulesInput(sampleModuleRules);
              }}
            >
              Load sample
            </button>
          </div>
          {result.error ? <p className="error">{result.error}</p> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Terraform target</th>
                  <th>Module</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {visibleUnmanaged.map((resource) => (
                  <tr key={resource.id}>
                    <td>
                      <strong>{resource.name}</strong>
                      <div className="subtext">{resource.type}</div>
                    </td>
                    <td>
                      <div className="mono break">{resource.address}</div>
                      {resource.address !== resource.baseAddress ? (
                        <div className="subtext mono">base: {resource.baseAddress}</div>
                      ) : null}
                    </td>
                    <td>{resource.modulePath ? <span className="module-pill">{resource.modulePath}</span> : "Root"}</td>
                    <td>
                      <span className={`status status-${resource.confidence}`}>
                        {resource.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
                {!visibleUnmanaged.length ? (
                  <tr>
                    <td colSpan={4}>No unmanaged resources match the current inputs.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Export Package">
          <p className="hint">
            Download a review-ready ZIP for the filtered import candidates. The package includes
            import blocks, starter `.tf`, module rules, inventory JSON, and review guidance.
          </p>
          <div className="export-summary">
            <Metric label="Packaged resources" value={visibleUnmanaged.length} />
            <Metric
              label="Module targets"
              value={visibleUnmanaged.filter((resource) => resource.modulePath).length}
            />
            <Metric
              label="Needs review"
              value={visibleUnmanaged.filter((resource) => resource.confidence !== "high").length}
            />
          </div>
          <div className="actions">
            <button type="button" onClick={downloadExportPackage}>
              Download export package
            </button>
          </div>
          {exportMessage ? <p className="message">{exportMessage}</p> : null}
        </Panel>

        <Panel title="Generated Import Blocks">
          <p className="hint">Review medium and manual matches before applying.</p>
          <textarea value={importBlocks} readOnly />
          <div className="actions">
            <button type="button" onClick={copyImportBlocks}>
              Copy import blocks
            </button>
            <button type="button" className="secondary" onClick={downloadImportBlocks}>
              Download imports.tf
            </button>
          </div>
          {copyMessage ? <p className="message">{copyMessage}</p> : null}
        </Panel>

        <Panel title="Generated Terraform .tf">
          <p className="hint">
            Starter resource blocks for the import candidates. Review TODO comments and reconcile
            with `terraform plan` before applying.
          </p>
          <textarea value={terraformConfigBlocks} readOnly />
          <div className="actions">
            <button type="button" onClick={copyTerraformConfig}>
              Copy .tf blocks
            </button>
            <button type="button" className="secondary" onClick={downloadTerraformConfig}>
              Download generated-resources.tf
            </button>
          </div>
          {configMessage ? <p className="message">{configMessage}</p> : null}
        </Panel>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <article className={emphasis ? "metric accent" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
