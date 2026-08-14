# Azure Terraform Import Planner

Desktop and web application for finding Azure resources that are not represented in a Terraform state file and generating Terraform `import` blocks, starter Terraform `.tf` files, module-aware targets, and review/export packages.

## Features

- Azure sign-in using OAuth device-code flow.
- One-time Azure login code displayed directly in the app.
- Azure subscription picker.
- Azure Resource Graph scan for selected subscriptions.
- Terraform state comparison using pasted state JSON or remote state from Azure Storage.
- Azure Storage state loading using Microsoft Entra ID bearer tokens.
- Common Azure resource type mapping to Terraform AzureRM resource types.
- Generated Terraform 1.5+ `import { ... }` blocks.
- Copy-to-clipboard and save-to-file actions for generated imports.
- Web app version with Azure SPA sign-in.
- Module-aware import target rules.
- Starter Terraform `.tf` block generation.
- Review-ready export package with `imports.tf`, generated resources, module rules, and inventory JSON.

## Prerequisites

- Windows
- Node.js `>=22.13.0`
- pnpm
- Azure App Registration with public client flows enabled

## Azure App Registration

1. Open Microsoft Entra ID.
2. Go to **App registrations**.
3. Create or select an app registration.
4. Copy the **Application (client) ID**.
5. Open **Authentication**.
6. Set **Allow public client flows** to **Yes**.

No client secret is required.

The signed-in user needs:

- Reader access or equivalent for subscription/resource discovery.
- `Storage Blob Data Reader` or equivalent data-plane access if loading Terraform state from Azure Storage.

## Install

```bash
pnpm install
```

## Run Web App Locally

```bash
pnpm run dev
```

Open:

```text
http://localhost:3000/
```

## Build Web App For Azure

```bash
pnpm run build:azure
```

Run the production server:

```bash
pnpm run start:azure
```

The Azure hosting path uses Docker and Azure App Service for Containers. See [Azure Hosting Guide](docs/Azure-Hosting.md).

## Run Locally

```bash
pnpm run desktop
```

## Package Windows Desktop App

```bash
pnpm run desktop:package
```

The packaged app is written to:

```text
outputs/AzureTerraformImportPlanner-win32-x64
```

## Build Windows Installer

Create an NSIS installer:

```bash
pnpm run installer
```

Create a signed installer after setting certificate environment variables:

```powershell
$env:CSC_LINK="C:\certs\company-code-signing-cert.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
pnpm run installer:signed
```

Installer artifacts are written to:

```text
release/
```

See [Signed Installer Packaging](docs/Signed-Installer-Packaging.md) for details.

## Use The App

1. Launch the desktop app.
2. Enter the Azure Application client ID.
3. Leave tenant as `organizations`, or enter a specific tenant ID.
4. Select **Sign in to Azure**.
5. Enter the displayed one-time code in the browser sign-in flow.
6. Select an Azure subscription.
7. Select **Query selected subscription**.
8. Paste Terraform state from `terraform state pull`, or load the state from Azure Storage.
9. Review unmanaged resources and confidence labels.
10. Copy or save the generated import blocks.
11. Add the import blocks to Terraform and run `terraform plan`.

## Repository Layout

```text
desktop/
  index.html      Desktop UI markup
  styles.css      Desktop styling
  renderer.js     UI logic, state parsing, diffing, copy/save actions
  main.cjs        Electron main process, Azure auth, Azure API calls
  preload.cjs     Secure Electron IPC bridge
  README.md       Desktop-specific usage notes

docs/
  Azure-Terraform-Import-Planner-Desktop-Documentation.md
  Azure-Hosting.md
  Signed-Installer-Packaging.md

azure/
  app-service-container.bicep

scripts/
  vinext-build.mjs
  vinext-start.mjs

package.json      Root scripts and dependencies
pnpm-lock.yaml    Dependency lockfile
Dockerfile        Azure-ready web container build
.dockerignore     Docker build ignore rules
.gitignore        Ignored local/build artifacts
```

## Notes

- Generated import blocks must be reviewed before use.
- Importing state does not create matching Terraform configuration.
- Unknown Azure resource types are emitted as `azapi_resource` and should be reviewed manually.
- Always run `terraform plan` before applying changes.
