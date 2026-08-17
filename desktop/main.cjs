const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const azureScope = "offline_access https://management.azure.com/user_impersonation";
const storageScope = "https://storage.azure.com/user_impersonation";
const resourceGraphQuery =
  "Resources | project id, name, type, resourceGroup, location | order by type asc, name asc";

let mainWindow;
let tokenState = null;
let authContext = null;
let pendingDeviceLogin = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#f6f8f9",
    title: "Azure Terraform Import Planner",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      body?.error?.message ?? body?.error_description ?? body?.message ?? response.statusText;
    throw new Error(message);
  }
  return body;
}

async function startDeviceLogin({ clientId, tenantId }) {
  const activeClientId = String(clientId ?? "").trim();
  const activeTenantId = String(tenantId ?? "organizations").trim() || "organizations";
  if (!activeClientId) {
    throw new Error("Enter an Azure app registration client ID first.");
  }

  const deviceBody = new URLSearchParams();
  deviceBody.set("client_id", activeClientId);
  deviceBody.set("scope", azureScope);

  const device = await fetchJson(
    `https://login.microsoftonline.com/${encodeURIComponent(activeTenantId)}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: deviceBody,
    },
  );

  await shell.openExternal(device.verification_uri_complete ?? device.verification_uri);

  pendingDeviceLogin = {
    clientId: activeClientId,
    tenantId: activeTenantId,
    device,
  };

  return {
    userCode: device.user_code,
    message: device.message ?? `Enter code ${device.user_code} to sign in to Azure.`,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete,
    expiresIn: Number(device.expires_in ?? 900),
  };
}

async function completeDeviceLogin() {
  if (!pendingDeviceLogin) {
    throw new Error("Start Azure sign-in first.");
  }

  const { clientId, tenantId, device } = pendingDeviceLogin;
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const expiresAt = Date.now() + Number(device.expires_in ?? 900) * 1000;
  let interval = Number(device.interval ?? 5);
  let data = null;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const tokenBody = new URLSearchParams();
    tokenBody.set("client_id", clientId);
    tokenBody.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    tokenBody.set("device_code", device.device_code);

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    const tokenText = await response.text();
    const tokenResponse = tokenText ? JSON.parse(tokenText) : {};

    if (response.ok) {
      data = tokenResponse;
      break;
    }

    if (tokenResponse.error === "authorization_pending") {
      mainWindow?.webContents.send("azure:authMessage", {
        message: "Waiting for Azure sign-in to finish in the browser...",
      });
      continue;
    }
    if (tokenResponse.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (tokenResponse.error === "expired_token") {
      throw new Error("The Azure sign-in code expired. Start sign-in again.");
    }

    throw new Error(tokenResponse.error_description ?? tokenResponse.error ?? "Azure sign-in failed.");
  }

  if (!data) {
    throw new Error("Azure sign-in timed out. Start sign-in again.");
  }

  pendingDeviceLogin = null;

  tokenState = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
  authContext = { clientId, tenantId };

  return { expiresAt: tokenState.expiresAt };
}

function requireToken() {
  if (!tokenState?.accessToken || tokenState.expiresAt < Date.now() + 60_000) {
    throw new Error("Sign in to Azure again. The current token is missing or expired.");
  }
  return tokenState.accessToken;
}

async function getStorageToken() {
  if (!authContext || !tokenState?.refreshToken) {
    throw new Error("Sign in to Azure again before loading state from Azure Storage.");
  }

  const body = new URLSearchParams();
  body.set("client_id", authContext.clientId);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokenState.refreshToken);
  body.set("scope", storageScope);

  const data = await fetchJson(
    `https://login.microsoftonline.com/${encodeURIComponent(authContext.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (data.refresh_token) {
    tokenState.refreshToken = data.refresh_token;
  }

  return data.access_token;
}

function encodeBlobPath(blobName) {
  return String(blobName ?? "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function loadStateFromStorage({ accountName, containerName, blobName }) {
  const account = String(accountName ?? "").trim();
  const container = String(containerName ?? "").trim();
  const blob = String(blobName ?? "").trim();

  if (!account || !container || !blob) {
    throw new Error("Enter storage account, container, and state blob name.");
  }
  if (!/^[a-z0-9]{3,24}$/.test(account)) {
    throw new Error("Storage account name must be 3-24 lowercase letters or numbers.");
  }

  const storageToken = await getStorageToken();
  const url = `https://${account}.blob.core.windows.net/${encodeURIComponent(container)}/${encodeBlobPath(blob)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${storageToken}`,
      "x-ms-version": "2023-11-03",
    },
  });
  const text = await response.text();

  if (!response.ok) {
    let message = response.statusText;
    const match = text.match(/<Message>(.*?)<\/Message>/s);
    if (match?.[1]) message = match[1].replace(/\n/g, " ").trim();
    throw new Error(`Could not load Terraform state blob: ${message}`);
  }

  JSON.parse(text);
  return text;
}

ipcMain.handle("azure:startDeviceLogin", (_event, payload) => startDeviceLogin(payload));
ipcMain.handle("azure:completeDeviceLogin", () => completeDeviceLogin());

ipcMain.handle("azure:subscriptions", async () => {
  const data = await fetchJson("https://management.azure.com/subscriptions?api-version=2020-01-01", {
    headers: { Authorization: `Bearer ${requireToken()}` },
  });
  return data.value ?? [];
});

ipcMain.handle("azure:queryResources", async (_event, subscriptionId) => {
  const data = await fetchJson(
    "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscriptions: [subscriptionId],
        query: resourceGraphQuery,
        options: { resultFormat: "objectArray" },
      }),
    },
  );
  return data.data ?? [];
});

ipcMain.handle("azure:loadStateFromStorage", (_event, payload) => loadStateFromStorage(payload));

ipcMain.handle("imports:save", async (_event, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Terraform import blocks",
    defaultPath: "imports.tf",
    filters: [{ name: "Terraform", extensions: ["tf"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, content, "utf8");
  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
