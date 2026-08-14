# Azure Hosting Guide

This guide configures the web version of Azure Terraform Import Planner for Azure hosting.

Because the app includes a server API route for loading Terraform state from Azure Storage, host it as a containerized web app rather than a static-only site.

## Recommended Hosting Option

- Azure App Service for Containers
- Azure Container Registry
- Node.js 22 container runtime

## Files Added

- `Dockerfile` - Builds and runs the Vinext web app in a Linux container.
- `.dockerignore` - Excludes local build artifacts from the container context.
- `pnpm-workspace.yaml` - Approves required native dependency build scripts for non-interactive Docker installs.
- `scripts/vinext-build.mjs` - Cross-platform production build wrapper.
- `scripts/vinext-start.mjs` - Cross-platform production start wrapper.
- `azure/app-service-container.bicep` - App Service container infrastructure template.
- `.github/workflows/azure-webapp-container.yml` - Optional GitHub Actions deployment workflow.

## Azure App Registration Redirect URI

When hosted in Azure, add the deployed URL as a Single-page application redirect URI:

```text
https://<your-web-app-name>.azurewebsites.net/
```

Keep the local URI for development:

```text
http://localhost:3000/
```

The app uses the hardcoded tenant:

```text
d4ae2391-a29e-4697-9db1-da7b68f5a3b4
```

## Local Container Build

From the repository root:

```bash
docker build -t azure-terraform-import-planner:local .
docker run --rm -p 3000:3000 azure-terraform-import-planner:local
```

Open:

```text
http://localhost:3000/
```

## Deploy Infrastructure With Bicep

Create a resource group:

```bash
az group create \
  --name rg-tf-import-planner \
  --location eastus
```

Create an Azure Container Registry:

```bash
az acr create \
  --resource-group rg-tf-import-planner \
  --name <acr-name> \
  --sku Basic \
  --admin-enabled true
```

Build and push the image:

```bash
az acr build \
  --registry <acr-name> \
  --image azure-terraform-import-planner:latest \
  .
```

Deploy the Web App:

```bash
az deployment group create \
  --resource-group rg-tf-import-planner \
  --template-file azure/app-service-container.bicep \
  --parameters webAppName=<web-app-name> \
  --parameters containerImage=<acr-name>.azurecr.io/azure-terraform-import-planner:latest
```

## Configure Container Registry Pull Access

If App Service cannot pull the image, assign `AcrPull` to the Web App managed identity:

```bash
principalId=$(az webapp identity show \
  --resource-group rg-tf-import-planner \
  --name <web-app-name> \
  --query principalId \
  --output tsv)

acrId=$(az acr show \
  --resource-group rg-tf-import-planner \
  --name <acr-name> \
  --query id \
  --output tsv)

az role assignment create \
  --assignee "$principalId" \
  --role AcrPull \
  --scope "$acrId"
```

Then restart the app:

```bash
az webapp restart \
  --resource-group rg-tf-import-planner \
  --name <web-app-name>
```

## Required Azure Permissions For Users

Users signing into the app need:

- Reader access or equivalent on the Azure subscriptions being scanned.
- Storage Blob Data Reader on the Terraform state storage account or container.
- Consent to the app registration permissions for Azure Resource Manager and Azure Storage delegated access.

## Production Notes

- Do not configure a client secret. The web app uses browser PKCE auth.
- Keep `WEBSITES_PORT` set to `3000`.
- The workflow uses `az webapp config container set --container-image-name`, which is the current Azure CLI option for custom container images.
- Add every deployed host URL to the app registration as a Single-page application redirect URI.
- Run `terraform plan` before applying generated imports or generated `.tf` blocks.
