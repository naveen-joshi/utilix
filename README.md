# Utilix

Utilix is an Electron + Angular desktop utilities app for working with local files.

## Features

- Resize and optimize images and PDFs
- Convert files across image, PDF, text, and office formats
- PDF tools: merge, extract, rotate, delete pages, metadata updates
- Image tools: crop, rotate, resize, SVG conversion, favicon generation, background removal
- Global save preferences:
  - Ask where to save each output
  - Auto-save to a configured default directory

## Tech Stack

- Angular 21 (standalone components, signals)
- PrimeNG 21
- Electron 41
- sharp, pdf-lib, png-to-ico

## Getting Started

### Prerequisites

- Node.js 22+
- npm 11+

### Install

```bash
npm ci
```

### Run in desktop development mode

```bash
npm run electron:dev
```

### Build Angular app only

```bash
npm run build
```

### Build Electron main/preload only

```bash
npm run build:electron
```

## Packaging

### Local production package (all configured targets)

```bash
npm run electron:build
```

### Local Windows installer package

```bash
npm run electron:build:win
```

Packaged artifacts are generated in `release/`.

## GitHub Release Workflow

This repository includes [Build and Release Installer](.github/workflows/release.yml).

- Manual run (`workflow_dispatch`): builds and uploads Windows installer artifacts
- Tag run (`push` tag `v*`): builds installer and publishes a GitHub Release with attached assets

### Publish a release

1. Commit and push your changes.
2. Create and push a version tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

3. Wait for the workflow to finish and download the installer from the GitHub Release page.

## Notes

- Office conversion quality depends on available conversion engines on the machine.
- Save preferences are stored per user in the Electron app data directory.
