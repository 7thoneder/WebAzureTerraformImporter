# Azure Terraform Import Planner Desktop

Local Windows desktop app for finding Azure resources that are not represented in a Terraform state file, then generating Terraform `import` blocks.

## What It Does

- Signs in to Azure using OAuth device-code flow.
- Lists Azure subscriptions available to the signed-in user.
- Queries Azure Resource Graph for resources in the selected subscription.
- Loads Terraform state directly from an Azure Storage blob.
- Compares those resources with pasted Terraform state JSON.
- Generates Terraform 1.5+ `import { ... }` blocks.
- Saves generated imports to a local `imports.tf` file.

## Azure Setup

Create or reuse an Azure App Registration:

1. Open Microsoft Entra ID > App registrations.
2. Create an app registration or select an existing one.
3. Copy the Application (client) ID.
4. Under Authentication, enable public client flows:
   - Advanced settings > Allow public client flows: Yes
5. Make sure the signed-in user has permission to read subscriptions and Resource Graph data.
6. If loading remote state from Azure Storage, grant the signed-in user `Storage Blob Data Reader` on the state storage account or container.

No client secret is required. Tokens are held in app memory and are not written to disk.

## Run The Packaged App

Open:

```text
outputs/AzureTerraformImportPlanner-win32-x64/AzureTerraformImportPlanner.exe
```

Or use the zipped bundle:

```text
outputs/AzureTerraformImportPlanner-win32-x64-archive.zip
```

Extract the zip before running the `.exe`.

## Use The App

1. Enter the Azure Application (client) ID.
2. Leave Tenant as `organizations`, or enter a tenant ID for a specific tenant.
3. Select Sign in to Azure.
4. Enter the one-time code shown in the Azure Connection panel when the browser opens.
5. Return to the desktop app and choose a subscription.
6. Select Query selected subscription.
7. Paste Terraform state JSON from:

```bash
terraform state pull
```

   Or load state from Azure Storage by entering:

   - Storage account name
   - Container name
   - State blob/key name

8. Review unmanaged resources and generated import blocks.
9. Select Copy import blocks or Save imports.tf.

## Development

Install dependencies:

```bash
pnpm install
```

Run the desktop app locally:

```bash
pnpm run desktop
```

Package the Windows desktop app:

```bash
pnpm run desktop:package
```

The packaged app is written to `outputs/AzureTerraformImportPlanner-win32-x64`.

Build an NSIS installer:

```bash
pnpm run installer
```

Build a signed installer after setting `CSC_LINK` and `CSC_KEY_PASSWORD`:

```powershell
$env:CSC_LINK="C:\certs\company-code-signing-cert.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
pnpm run installer:signed
```

## Notes

- The Terraform type mapping covers common AzureRM resources. Unknown resource types are emitted as `azapi_resource` and marked as manual.
- Medium-confidence mappings, such as virtual machines and web apps, should be reviewed before applying.
- Always run `terraform plan` after adding import blocks.
- The app reads pasted Terraform state only in the local desktop session.
