const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  startDeviceLogin: (payload) => ipcRenderer.invoke("azure:startDeviceLogin", payload),
  completeDeviceLogin: () => ipcRenderer.invoke("azure:completeDeviceLogin"),
  listSubscriptions: () => ipcRenderer.invoke("azure:subscriptions"),
  queryResources: (subscriptionId) => ipcRenderer.invoke("azure:queryResources", subscriptionId),
  loadStateFromStorage: (payload) => ipcRenderer.invoke("azure:loadStateFromStorage", payload),
  saveImports: (content) => ipcRenderer.invoke("imports:save", content),
});
