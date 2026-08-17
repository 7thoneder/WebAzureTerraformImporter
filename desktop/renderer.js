const azureScopeQuery =
  "Resources | project id, name, type, resourceGroup, location | order by type asc, name asc";

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
    },
    {
      id: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod-core/providers/Microsoft.Network/virtualNetworks/prod-vnet",
      name: "prod-vnet",
      type: "microsoft.network/virtualnetworks",
      resourceGroup: "prod-core",
      location: "eastus",
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

const typeMap = {
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

const elements = {
  clientId: document.querySelector("#clientId"),
  tenantId: document.querySelector("#tenantId"),
  loginButton: document.querySelector("#loginButton"),
  refreshButton: document.querySelector("#refreshButton"),
  deviceCodePanel: document.querySelector("#deviceCodePanel"),
  deviceCodeValue: document.querySelector("#deviceCodeValue"),
  deviceCodeMessage: document.querySelector("#deviceCodeMessage"),
  subscriptionSelect: document.querySelector("#subscriptionSelect"),
  authMessage: document.querySelector("#authMessage"),
  azCommand: document.querySelector("#azCommand"),
  queryButton: document.querySelector("#queryButton"),
  azureInput: document.querySelector("#azureInput"),
  storageAccountInput: document.querySelector("#storageAccountInput"),
  stateContainerInput: document.querySelector("#stateContainerInput"),
  stateBlobInput: document.querySelector("#stateBlobInput"),
  loadStateButton: document.querySelector("#loadStateButton"),
  stateStorageMessage: document.querySelector("#stateStorageMessage"),
  stateInput: document.querySelector("#stateInput"),
  filterInput: document.querySelector("#filterInput"),
  sampleButton: document.querySelector("#sampleButton"),
  parseError: document.querySelector("#parseError"),
  resourcesTable: document.querySelector("#resourcesTable"),
  importsOutput: document.querySelector("#importsOutput"),
  copyButton: document.querySelector("#copyButton"),
  copyMessage: document.querySelector("#copyMessage"),
  saveButton: document.querySelector("#saveButton"),
  saveMessage: document.querySelector("#saveMessage"),
  azureCount: document.querySelector("#azureCount"),
  stateCount: document.querySelector("#stateCount"),
  candidateCount: document.querySelector("#candidateCount"),
};

let isSignedIn = false;
let subscriptions = [];

function normalizeId(id) {
  return id.trim().replace(/\/+$/, "").toLowerCase();
}

function normalizeType(type) {
  return type.trim().toLowerCase();
}

function safeName(name) {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return /^[a-z_]/.test(cleaned) ? cleaned || "imported" : `r_${cleaned}`;
}

function parseJson(input) {
  if (!input.trim()) return null;
  return JSON.parse(input);
}

function inferNameFromId(id) {
  return id.split("/").filter(Boolean).at(-1) ?? "resource";
}

function unwrapAzureRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.value)) return value.value;
    if (Array.isArray(value.rows) && Array.isArray(value.columns)) {
      return value.rows.map((row) =>
        Object.fromEntries(value.columns.map((column, index) => [column.name, row[index]])),
      );
    }
  }
  return [];
}

function parseAzureResources(input) {
  return unwrapAzureRows(parseJson(input))
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? inferNameFromId(String(row.id ?? ""))),
      type: String(row.type ?? ""),
      resourceGroup: row.resourceGroup ? String(row.resourceGroup) : undefined,
      location: row.location ? String(row.location) : undefined,
    }))
    .filter((resource) => resource.id && resource.type);
}

function parseStateResources(input) {
  const state = parseJson(input);
  if (!state || typeof state !== "object") return [];
  return (state.resources ?? []).flatMap((resource) => {
    if (!resource || typeof resource !== "object") return [];
    if (resource.mode && resource.mode !== "managed") return [];
    const modulePrefix = resource.module ? `${resource.module}.` : "";
    const instances = Array.isArray(resource.instances) ? resource.instances : [];
    return instances.flatMap((instance, index) => {
      const id = String(instance?.attributes?.id ?? "");
      if (!id) return [];
      const suffix =
        instance.index_key !== undefined
          ? `[${JSON.stringify(instance.index_key)}]`
          : instances.length > 1
            ? `[${index}]`
            : "";
      return [
        {
          address: `${modulePrefix}${resource.type}.${resource.name}${suffix}`,
          id,
          type: resource.type,
          name: resource.name,
        },
      ];
    });
  });
}

function compareResources(azure, state) {
  const managedIds = new Set(state.map((resource) => normalizeId(resource.id)));
  const seenAddresses = new Set(state.map((resource) => resource.address));
  return azure
    .filter((resource) => !managedIds.has(normalizeId(resource.id)))
    .map((resource) => {
      const terraformType = typeMap[normalizeType(resource.type)] ?? "azapi_resource";
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
        address,
        confidence: typeMap[normalizeType(resource.type)]
          ? resource.type.toLowerCase().includes("virtualmachines") ||
            resource.type.toLowerCase().includes("sites")
            ? "medium"
            : "high"
          : "manual",
      };
    });
}

function buildImportBlocks(resources) {
  return resources
    .map(
      (resource) => `import {
  to = ${resource.address}
  id = "${resource.id}"
}`,
    )
    .join("\n\n");
}

function updateCommand() {
  const subscriptionId = elements.subscriptionSelect.value;
  elements.azCommand.textContent = `az graph query -q "${azureScopeQuery}"${
    subscriptionId ? ` --subscriptions ${subscriptionId}` : ""
  } -o json`;
}

function renderSubscriptions() {
  elements.subscriptionSelect.innerHTML = '<option value="">Choose a subscription</option>';
  for (const subscription of subscriptions) {
    const option = document.createElement("option");
    option.value = subscription.subscriptionId;
    option.textContent = `${subscription.displayName} (${subscription.subscriptionId})`;
    elements.subscriptionSelect.append(option);
  }
  elements.subscriptionSelect.disabled = subscriptions.length === 0;
  elements.queryButton.disabled = !isSignedIn || !elements.subscriptionSelect.value;
  updateCommand();
}

function render() {
  let azure = [];
  let state = [];
  let unmanaged = [];
  elements.parseError.style.display = "none";

  try {
    azure = parseAzureResources(elements.azureInput.value);
    state = parseStateResources(elements.stateInput.value);
    unmanaged = compareResources(azure, state);
  } catch (error) {
    elements.parseError.textContent = error.message;
    elements.parseError.style.display = "block";
  }

  const filter = elements.filterInput.value.toLowerCase();
  const visible = unmanaged.filter((resource) =>
    `${resource.name} ${resource.type} ${resource.resourceGroup ?? ""}`.toLowerCase().includes(filter),
  );

  elements.azureCount.textContent = String(azure.length);
  elements.stateCount.textContent = String(state.length);
  elements.candidateCount.textContent = String(unmanaged.length);
  elements.importsOutput.value = buildImportBlocks(visible);

  elements.resourcesTable.innerHTML = "";
  if (!visible.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="3">No unmanaged resources match the current inputs.</td>';
    elements.resourcesTable.append(row);
    return;
  }

  for (const resource of visible) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <strong></strong>
        <div class="subtext"></div>
      </td>
      <td class="mono"></td>
      <td><span class="status status-${resource.confidence}">${resource.confidence}</span></td>
    `;
    row.querySelector("strong").textContent = resource.name;
    row.querySelector(".subtext").textContent = resource.type;
    row.querySelector(".mono").textContent = resource.address;
    elements.resourcesTable.append(row);
  }
}

async function loadSubscriptions() {
  elements.authMessage.textContent = "Loading subscriptions...";
  subscriptions = await window.desktopApi.listSubscriptions();
  renderSubscriptions();
  elements.authMessage.textContent = subscriptions.length
    ? "Choose a subscription to scan."
    : "No subscriptions returned.";
}

elements.loginButton.addEventListener("click", async () => {
  try {
    elements.loginButton.disabled = true;
    elements.deviceCodePanel.hidden = true;
    elements.deviceCodeValue.textContent = "";
    elements.deviceCodeMessage.textContent = "";
    elements.authMessage.textContent = "Requesting Azure sign-in code...";

    const device = await window.desktopApi.startDeviceLogin({
      clientId: elements.clientId.value,
      tenantId: elements.tenantId.value || "organizations",
    });

    elements.deviceCodeValue.textContent = device.userCode ?? "";
    elements.deviceCodeMessage.textContent =
      device.message ?? "Enter this code in the browser window that opened.";
    elements.deviceCodePanel.hidden = false;
    elements.authMessage.textContent = "Waiting for Azure sign-in to finish in the browser...";

    await window.desktopApi.completeDeviceLogin();
    isSignedIn = true;
    elements.refreshButton.disabled = false;
    elements.loadStateButton.disabled = false;
    elements.loginButton.textContent = "Reconnect Azure";
    elements.deviceCodePanel.hidden = true;
    await loadSubscriptions();
  } catch (error) {
    elements.authMessage.textContent = error.message;
  } finally {
    elements.loginButton.disabled = false;
  }
});

elements.refreshButton.addEventListener("click", () => {
  loadSubscriptions().catch((error) => {
    elements.authMessage.textContent = error.message;
  });
});

elements.subscriptionSelect.addEventListener("change", () => {
  elements.queryButton.disabled = !isSignedIn || !elements.subscriptionSelect.value;
  updateCommand();
});

elements.queryButton.addEventListener("click", async () => {
  try {
    elements.queryButton.disabled = true;
    elements.queryButton.textContent = "Querying Azure...";
    elements.authMessage.textContent = "Querying Azure Resource Graph...";
    const resources = await window.desktopApi.queryResources(elements.subscriptionSelect.value);
    elements.azureInput.value = JSON.stringify(resources, null, 2);
    elements.authMessage.textContent = `Loaded ${resources.length} resources from Azure.`;
    render();
  } catch (error) {
    elements.authMessage.textContent = error.message;
  } finally {
    elements.queryButton.textContent = "Query selected subscription";
    elements.queryButton.disabled = !isSignedIn || !elements.subscriptionSelect.value;
  }
});

elements.saveButton.addEventListener("click", async () => {
  try {
    const result = await window.desktopApi.saveImports(elements.importsOutput.value);
    elements.saveMessage.textContent = result.canceled ? "" : `Saved ${result.filePath}`;
  } catch (error) {
    elements.saveMessage.textContent = error.message;
  }
});

elements.copyButton.addEventListener("click", async () => {
  const importBlocks = elements.importsOutput.value.trim();
  elements.copyMessage.textContent = "";

  if (!importBlocks) {
    elements.copyMessage.textContent = "No import blocks to copy.";
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(importBlocks);
    } else {
      elements.importsOutput.focus();
      elements.importsOutput.select();
      document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
    elements.copyMessage.textContent = "Import blocks copied to clipboard.";
  } catch (error) {
    elements.copyMessage.textContent =
      error instanceof Error ? error.message : "Could not copy import blocks.";
  }
});

elements.loadStateButton.addEventListener("click", async () => {
  try {
    elements.loadStateButton.disabled = true;
    elements.loadStateButton.textContent = "Loading state...";
    elements.stateStorageMessage.textContent = "Downloading Terraform state from Azure Storage...";

    const state = await window.desktopApi.loadStateFromStorage({
      accountName: elements.storageAccountInput.value,
      containerName: elements.stateContainerInput.value,
      blobName: elements.stateBlobInput.value,
    });

    elements.stateInput.value = state;
    elements.stateStorageMessage.textContent = "Terraform state loaded from Azure Storage.";
    render();
  } catch (error) {
    elements.stateStorageMessage.textContent =
      error instanceof Error ? error.message : "Could not load state from Azure Storage.";
  } finally {
    elements.loadStateButton.textContent = "Load state from Azure Storage";
    elements.loadStateButton.disabled = !isSignedIn;
  }
});

elements.sampleButton.addEventListener("click", () => {
  elements.azureInput.value = sampleAzure;
  elements.stateInput.value = sampleState;
  render();
});

for (const element of [elements.azureInput, elements.stateInput, elements.filterInput]) {
  element.addEventListener("input", render);
}

elements.azureInput.value = sampleAzure;
elements.stateInput.value = sampleState;
renderSubscriptions();
render();
