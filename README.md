# UK average salary (static)

This repo builds a **fully static** mini-site that lets you search UK job categories and view **official earnings** from ONS ASHE Table 2 (occupation by 2-digit SOC).

## Quick start

Install deps:

```bash
npm install
```

Build the static data JSON (downloads ONS zip, parses it):

```bash
npm run build:data
```

Serve the `public/` folder:

```bash
npm run serve
```

## What you deploy

Deploy the contents of `public/` (static files). After running `npm run build:data`, it will include:

- `public/data/roles.json`
- `public/data/earnings.json`
- `public/data/meta.json`

## Data source

ONS dataset page: `https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/earningsandworkinghours/datasets/occupation2digitsocashetable2`

## Security note

The build step uses the `xlsx` npm package to parse ONS spreadsheets. `npm audit` currently reports advisories for `xlsx` with **no upstream fix**. This repo only uses it at **build time** to generate static JSON; it is not shipped to the browser.

