# Signed Windows Installer Packaging

This project supports Windows installer packaging with `electron-builder`.

## What This Produces

The installer command creates a Windows NSIS installer for:

```text
Azure Terraform Import Planner
```

By default, installer artifacts are written to:

```text
release/
```

The `release/` folder is ignored by Git.

## Required Tooling

- Windows build machine
- Node.js `>=22.13.0`
- pnpm
- A Windows Authenticode code-signing certificate
- Certificate password

## Certificate Options

`electron-builder` can sign Windows builds when code-signing certificate settings are provided through environment variables.

Common setup:

```powershell
$env:CSC_LINK="C:\certs\company-code-signing-cert.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
```

`CSC_LINK` can be:

- A local `.pfx` file path
- A base64-encoded certificate
- A URL to a certificate file, depending on your CI setup

Do not commit certificates or certificate passwords to GitHub.

## Install Dependencies

Run this once after cloning:

```bash
pnpm install
```

This installs `electron-builder` and updates `pnpm-lock.yaml` if needed.

## Build Unsigned Installer

For local testing without a certificate:

```bash
pnpm run installer
```

If no signing certificate is configured, `electron-builder` may create an unsigned installer or warn that signing was skipped, depending on the local environment.

## Build Signed Installer

In PowerShell:

```powershell
$env:CSC_LINK="C:\certs\company-code-signing-cert.pfx"
$env:CSC_KEY_PASSWORD="your-certificate-password"
pnpm run installer:signed
```

The signed installer is written to:

```text
release/
```

## Directory Build For Testing

To create an unpacked Windows app directory without producing an installer:

```bash
pnpm run installer:dir
```

## GitHub Actions / CI Notes

In CI, store signing material as encrypted secrets.

Recommended secrets:

```text
CSC_LINK
CSC_KEY_PASSWORD
```

Then expose them only to the packaging step.

## Verification

After creating the installer, verify the signature in PowerShell:

```powershell
Get-AuthenticodeSignature ".\release\Azure Terraform Import Planner Setup*.exe"
```

The result should show:

```text
Status : Valid
```

## Important Security Rules

- Never commit `.pfx`, `.p12`, or certificate password files.
- Never hard-code signing passwords in `package.json`.
- Restrict certificate access to release engineers or CI.
- Rotate signing credentials according to company policy.
