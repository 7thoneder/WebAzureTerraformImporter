# Azure Terraform Import Planner Desktop

## Overview

Azure Terraform Import Planner Desktop is a local Windows desktop application for identifying Azure resources that are not currently represented in a Terraform state file. The application connects to Azure, queries resources in a selected subscription, compares those resources against pasted Terraform state JSON, and generates Terraform 1.5+ `import` blocks.

The tool is intended to help cloud and infrastructure teams bring existing Azure resources under Terraform management with less manual inventory work.

## Primary Capabilities

- Sign in to Azure using OAuth device-code flow.
- Display a one-time Azure login code directly in the desktop application.
- List Azure subscriptions available to the signed-in user.
- Query Azure Resource Graph for resources in the selected subscription.
- Accept Terraform state JSON from `terraform state pull`.
- Load Terraform state directly from an Azure Storage blob.
- Detect Azure resources missing from Terraform state.
- Map common Azure resource provider types to Terraform AzureRM resource types.
- Mark lower-confidence and unknown mappings for review.
- Generate Terraform `import { ... }` blocks.
- Save generated import blocks to a local `imports.tf` file.

## Target Users

- Cloud engineers
- Platform engineering teams
- Infrastructure-as-code maintainers
- Azure administrators
- DevOps engineers migrating existing Azure resources into Terraform

## Application Workflow

1. User enters an Azure App Registration client ID.
2. User optionally enters a tenant ID, or leaves the default value as `organizations`.
3. User selects **Sign in to Azure**.
4. The application requests an Azure device-code login.
5. The app displays the one-time sign-in code in the Azure Connection panel.
6. The default browser opens to Microsoft sign-in.
7. User enters the displayed code and completes Azure authentication.
8. The desktop app loads available Azure subscriptions.
9. User selects a subscription.
10. User selects **Query selected subscription**.
11. The app queries Azure Resource Graph for the selected subscription.
12. User pastes Terraform state JSON from `terraform state pull`, or loads state from Azure Storage.
13. The app compares Azure resource IDs against Terraform state resource IDs.
14. The app displays unmanaged resources and generated import blocks.
15. User reviews the generated blocks and saves them as `imports.tf`.
16. User runs `terraform plan` to validate the imports.

## Azure Setup

An Azure App Registration is required for sign-in.

### App Registration Configuration

1. Open Microsoft Entra ID.
2. Go to **App registrations**.
3. Create a new app registration or use an existing one.
4. Copy the **Application (client) ID**.
5. Open **Authentication** for the app registration.
6. Enable public client flows:

```text
Advanced settings > Allow public client flows: Yes
```

No client secret is required.

### Azure Permissions

The signed-in user must have enough Azure permissions to:

- List subscriptions.
- Read Azure Resource Graph data.
- Read resources in the selected subscription.
- Read blob data from the Terraform state storage account, if loading state from Azure Storage.

Commonly, the user needs at least Reader-level access to the subscription.

To load remote Terraform state from Azure Storage, the user also needs data-plane access such as:

```text
Storage Blob Data Reader
```

Management-plane Reader access alone is not enough to read blob contents.

## Security Notes

- The application uses Azure OAuth device-code flow.
- The application does not require or store a client secret.
- Azure access tokens are held in Electron main-process memory.
- Azure Storage access is performed with Microsoft Entra ID bearer tokens, not account keys.
- Tokens are not written to disk.
- Terraform state is pasted into the local desktop session only.
- Generated import blocks are saved only when the user chooses a local file path.

## How Resource Detection Works

The application compares normalized Azure resource IDs from two sources:

- Azure Resource Graph query results.
- Terraform state resources from pasted state JSON.

Terraform state is expected to come from:

```bash
terraform state pull
```

If an Azure resource ID does not appear in Terraform state, the application treats it as an import candidate.

## Terraform Import Block Generation

The app generates Terraform 1.5+ import blocks in this format:

```hcl
import {
  to = azurerm_storage_account.prodcorelogs01
  id = "/subscriptions/.../resourceGroups/.../providers/Microsoft.Storage/storageAccounts/prodcorelogs01"
}
```

Generated Terraform addresses are based on:

- The mapped Terraform resource type.
- A sanitized version of the Azure resource name.

## Resource Type Mapping

The application includes mappings for common Azure resource types, including:

- Resource groups
- Storage accounts
- Virtual networks
- Network security groups
- Public IP addresses
- Network interfaces
- Load balancers
- Virtual machines
- Managed disks
- Key Vaults
- App Services
- App Service plans
- Azure SQL servers
- Azure SQL databases
- Container registries
- AKS clusters
- Application Insights
- Log Analytics workspaces

Unknown Azure resource types are emitted as:

```hcl
azapi_resource
```

These are marked as manual and should be reviewed before use.

## Confidence Levels

The application labels import candidates with confidence levels:

| Confidence | Meaning |
| --- | --- |
| High | Resource type has a direct known AzureRM mapping. |
| Medium | Resource type has a known mapping but may require manual review due to platform-specific variants. |
| Manual | Resource type is unknown or mapped to `azapi_resource`. |

Always review generated import blocks before applying them.

## Build Artifacts

The latest fixed desktop build is:

```text
outputs/AzureTerraformImportPlannerStorageState-win32-x64/AzureTerraformImportPlannerStorageState.exe
```

The zipped build is:

```text
outputs/AzureTerraformImportPlannerStorageState-win32-x64.zip
```

## Installation

### Option 1: Use the Folder Build

1. Copy the folder:

```text
AzureTerraformImportPlannerStorageState-win32-x64
```

2. Open the folder.
3. Run:

```text
AzureTerraformImportPlannerStorageState.exe
```

### Option 2: Use the Zip Build

1. Copy:

```text
AzureTerraformImportPlannerStorageState-win32-x64.zip
```

2. Extract the zip file.
3. Open the extracted folder.
4. Run:

```text
AzureTerraformImportPlannerStorageState.exe
```

## Operating Instructions

### 1. Start the App

Run the packaged `.exe`.

### 2. Enter Azure Connection Details

Enter:

- Azure Application client ID
- Tenant value

The tenant field can be:

- `organizations`
- `common`
- A specific tenant ID

### 3. Sign In

Select **Sign in to Azure**.

The app displays an Azure sign-in code. The browser opens to Microsoft sign-in. Enter the displayed code and complete authentication.

### 4. Choose Subscription

After sign-in, choose a subscription from the subscription picker.

### 5. Query Azure

Select **Query selected subscription**.

The application queries Azure Resource Graph using:

```kusto
Resources
| project id, name, type, resourceGroup, location
| order by type asc, name asc
```

### 6. Add Terraform State

From the Terraform working directory, run:

```bash
terraform state pull
```

Paste the JSON output into the Terraform State field.

Alternatively, load state directly from Azure Storage:

1. Enter the storage account name.
2. Enter the container name.
3. Enter the state blob/key name, such as `network/prod.tfstate`.
4. Select **Load state from Azure Storage**.

The app uses the signed-in Azure identity to download the blob and populate the Terraform State field.

### 7. Review Results

Review:

- Azure resource count
- Resources already in state
- Import candidates
- Confidence labels
- Generated import blocks

### 8. Save Import Blocks

Select **Save imports.tf** to save the generated import blocks locally.

### 9. Validate with Terraform

Add the saved `imports.tf` file to the Terraform configuration and run:

```bash
terraform plan
```

Review the plan carefully before applying.

## Development Stack

### Runtime and Desktop Shell

- Electron
- Node.js
- Chromium runtime bundled by Electron

### UI Layer

- HTML
- CSS
- JavaScript

The desktop UI is implemented in:

```text
desktop/index.html
desktop/styles.css
desktop/renderer.js
```

### Electron Main Process

Electron main-process logic is implemented in:

```text
desktop/main.cjs
```

Responsibilities:

- Create the desktop window.
- Handle Azure device-code authentication.
- Store Azure token in memory.
- Query Azure subscriptions.
- Query Azure Resource Graph.
- Exchange the signed-in session for an Azure Storage token.
- Download Terraform state blobs from Azure Storage.
- Save generated import files.

### Secure Bridge

The preload bridge is implemented in:

```text
desktop/preload.cjs
```

It exposes a limited API to the renderer:

- `startDeviceLogin`
- `completeDeviceLogin`
- `listSubscriptions`
- `queryResources`
- `loadStateFromStorage`
- `saveImports`

The app uses Electron context isolation and does not enable Node.js integration in the renderer.

### Package Management

- pnpm

### Packaging

- Electron Packager
- Electron Builder for NSIS installer packaging and code signing

The Windows desktop bundle is produced with:

```bash
pnpm run desktop:package
```

The Windows installer is produced with:

```bash
pnpm run installer
```

The signed Windows installer is produced after setting `CSC_LINK` and `CSC_KEY_PASSWORD`:

```powershell
$env:CSC_LINK="C:\certs\company-code-signing-cert.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
pnpm run installer:signed
```

Installer artifacts are written to:

```text
release/
```

### Web App Dependencies Present in Repository

The repository also contains web app scaffolding and dependencies from the earlier web version:

- Next.js
- React
- Vite
- Vinext
- Tailwind CSS
- Wrangler
- Cloudflare Vite plugin

The local desktop application itself is served from the `desktop/` directory through Electron.

## Source Layout

```text
desktop/
  index.html        Desktop UI markup
  styles.css        Desktop styling
  renderer.js       UI logic, state comparison, import block rendering
  main.cjs          Electron main process and Azure API calls
  preload.cjs       Secure IPC bridge
  package.json      Desktop package metadata
  README.md         Desktop-specific README

outputs/
  AzureTerraformImportPlannerStorageState-win32-x64/
  AzureTerraformImportPlannerStorageState-win32-x64.zip

package.json        Root scripts and dependencies
pnpm-lock.yaml      Dependency lockfile
.gitignore          Source control ignore rules
```

## Build Instructions

### Prerequisites

- Windows
- Node.js 22.13 or newer
- pnpm

### Install Dependencies

```bash
pnpm install
```

### Run Locally During Development

```bash
pnpm run desktop
```

### Package the Desktop App

```bash
pnpm run desktop:package
```

The packaged output is written to:

```text
outputs/AzureTerraformImportPlanner-win32-x64
```

## Troubleshooting

### Login Code Does Not Appear

Use the latest build:

```text
AzureTerraformImportPlannerStorageState-win32-x64
```

This build displays the device code in a dedicated Azure sign-in code panel.

### Azure Sign-In Fails

Check the Azure App Registration:

- Public client flows must be enabled.
- The correct Application client ID must be entered.
- The tenant value must be valid.

### No Subscriptions Appear

Confirm:

- The signed-in user has access to at least one Azure subscription.
- The tenant value matches where the subscriptions are available.
- The user has permission to list subscriptions.

### Resource Graph Query Fails

Confirm:

- The signed-in user has Reader-level access or equivalent.
- Azure Resource Graph is available for the subscription.
- The selected subscription is active.

### Azure Storage State Load Fails

Confirm:

- The storage account name is correct.
- The container name is correct.
- The blob/key name is correct.
- The signed-in user has `Storage Blob Data Reader` or equivalent data-plane access.
- Public client flows are enabled on the Azure App Registration.

### Generated Terraform Type Is `azapi_resource`

This means the Azure resource provider type is not currently in the app's AzureRM mapping table. Review the resource manually and update the mapping if a direct AzureRM resource exists.

### Terraform Plan Shows Unexpected Changes

Generated import blocks only attach existing infrastructure to Terraform state. Terraform configuration must still match the actual resource settings. Review provider configuration and resource definitions before applying.

## Maintenance Notes

Recommended future improvements:

- Add more AzureRM resource type mappings.
- Allow users to edit generated Terraform addresses before saving.
- Add a copy-to-clipboard button for import blocks.
- Add support for loading Terraform state from a local file.
- Add filtering by resource group and Azure provider type.
- Add signed installer packaging.
- Add automated tests for state parsing and resource mapping.

## Operational Cautions

- Always review generated import blocks before use.
- Always run `terraform plan` before `terraform apply`.
- Importing a resource into Terraform state does not automatically create matching Terraform configuration.
- Import blocks should be committed and reviewed with the Terraform configuration changes.
