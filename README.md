# Geospatial DynamoDB Vectors

## Architecture

The application is composed of three CDK stacks deployed in order via CodePipeline:

1. **StatefulStack** — DynamoDB global table and replica-provider logging
2. **StatelessStack** — API Gateway, public health check, and optional Cognito-authorised routes
3. **FrontendStack** — S3 + CloudFront hosting for the React SPA, with runtime config injection at deploy time

Stages: `local`, `dev` and `prod` — configured in `config/environment-config.ts`.

## Project Structure

```text
├── bin/                          # CDK app entry point
├── config/                       # Environment & pipeline configuration
│   ├── types.ts                  # Enums: Region, Stage
│   ├── environment-config.ts     # Per-stage config (dev/prod) & defaults
│   ├── pipeline-config.ts        # CodePipeline settings (repo, branches, accounts)
│   └── index.ts                  # Barrel export
├── lib/                          # CDK infrastructure stacks
│   ├── constructs/               # Reusable constructs (CustomLambda, CustomTable)
│   ├── frontend/                 # FrontendStack: S3 + CloudFront + config.js deploy
│   ├── stateful/                 # StatefulStack: DynamoDB and replica providers
│   ├── stateless/                # StatelessStack: API Gateway and Lambdas
│   ├── utils/                    # Project paths, validation, and provider logging
│   ├── application-stage.ts      # CDK Stage composing all stacks
│   └── pipeline-stack.ts         # CodePipeline V2 with GitHub source
├── src/                          # Application source code
│   ├── api/                      # Lambda handlers for API
│   ├── shared/                   # Shared TS utilities (logger, consts, utils)
└── frontend/                     # React SPA (Vite + Tailwind CSS)
    └── src/
        ├── App.tsx               # Starter application
        ├── App.css               # Starter component styles
        └── index.css             # Global styles & Tailwind imports
```

## Prerequisites

- Node.js 22.13+ on the 22.x line, or Node.js 24+ (Node.js 24 LTS recommended)
- npm 11.17+; CI and Docker builds select npm 11.19.1
- AWS credentials for deployment; local synthesis can run without them
- The project includes the CDK CLI; use `npm run cdk` or `npx cdk`

## Getting Started

Install dependencies:

```bash
npm install
npm install --prefix frontend
```

Use `npm ci` and `npm ci --prefix frontend` for reproducible installs from the committed lockfiles.

## Dependency release policy

Both projects include `.npmrc` with `min-release-age=2` (npm measures this in days), no package exemptions, and `engine-strict=true`. New direct, scoped, aliased, and transitive dependency selections must have been published at least 48 hours earlier. Use the newest release that satisfies this window when updating dependency ranges. The npm engine requirement prevents older clients from silently ignoring the policy.

`npm ci` trusts the versions already recorded in the lockfile and does not recheck their publication ages. The checked-in lockfiles have been audited against the 48-hour window; regenerate updates using the project configuration and review externally supplied lockfile changes before installing them. The project policy does not configure npm outside these two project directories.

The root manifest scopes a `katex` override to `micromark-extension-math` to fix [GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7). Remove this override when the upstream Markdown tooling accepts a patched KaTeX release.

## TypeScript toolchain

Both projects use the stable TypeScript 7.0.2 compiler for `tsc`, builds, and watch mode. TypeScript 7 does not expose the compiler API required by ESLint, ts-node, and ts-jest, so the manifests use Microsoft's [recommended compatibility aliases](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0):

- `@typescript/native` installs TypeScript 7 and provides `tsc`.
- `typescript` aliases `@typescript/typescript6` for tools that need the compiler API; it provides `tsc6`.

Run `npx tsc --version` in either project to check the build compiler. The `typescript` compatibility dependency is intentional and should be kept until those tools support the TypeScript 7 API.

Build and synthesise CloudFormation templates:

```bash
npm run build
npm run synth
```

For a credential-free synthesis check, use an explicit placeholder account and disable context lookups:

```bash
CDK_DEFAULT_ACCOUNT=123456789012 CDK_DEFAULT_REGION=eu-west-1 npm run synth -- --no-lookups
```

Replace the template account IDs, repository/connection settings, Cognito settings, and API domain before deployment.

`GET /health` is intentionally public. Add protected routes with `StatelessStack.addCognitoAuthorizedMethod(...)`; it creates and attaches a shared Cognito authorizer when the first protected route is added. The DynamoDB replica-provider functions have individual log groups and scoped write grants rather than the broad AWS-managed basic execution policy.

## Development Approach

Each developer maintains their own isolated AWS environment, deployed via cdk deploy. This allows for quick iteration and for changes to be made without impacted the deployed environments. Feature branches are worked on independently in per-developer stacks, then merged to main. Once changes are merged into main, they are deployed to the managed environments (currently just Dev / Preprod, and in the future a production environment).

There are two different ways to deploy and work with this project.
1. Deploy to staging (and eventually production) through the CDK Pipeline(s). Make changes in this repo and merge into `main` for standard pipeline based deployment to the target account(s).
2. Deploy some of the resources to a "Local" account and use those for testing before merging changes into `main`.

To work with a "local" AWS account, deploy the resources directly to that account with the command:

```bash
cdk deploy "Local/*" --require-approval never
```

The way of working in this method is then:

1. Deploy resource
2. Run Lambda functions locally, whilst connecting to your "local" AWS account. You can use "AWS SAM" to run the Lambda functions locally, whilst still connecting to remote resources. This is handled through the configuration of vscode's launch.json (`.vscode/launch.json`)
3. Configure the `frontend/public/config.js` file and run the frontend locally (see below)
4. Make changes and re-deploy to your local AWS account to iterate

## Frontend

The frontend is a React 19 starter using Vite 8, TypeScript 7, and Tailwind CSS 4 through `@tailwindcss/vite`. Tailwind utilities are available in JSX; see `frontend/README.md` for styling details. Routing and authentication are not included in the starter.

The CDK frontend stack generates runtime configuration (API URL and Cognito settings) as `window.__RUNTIME_CONFIG__` in `config.js` at deploy time. When adding application code that consumes this configuration, load `/config.js` from `index.html`. For local development, copy the example config:

```bash
cp frontend/public/config.js.example frontend/public/config.js
```

Then start the dev server:

```bash
cd frontend
npm install
npm run dev
```

## CI/CD Pipeline

Deployment is managed by AWS CodePipeline V2, defined in `lib/pipeline-stack.ts`. The pipeline:

- Sources from the repo on GitHub via CodeStar Connections
- Selects npm 11.19.1, then runs `npm ci`, `npm run build`, `npx cdk synth` in the synth step
- Deploys the `ApplicationStage` (all three stacks) to the target account
- Supports optional manual approval gates per stage

Pipeline configuration lives in `config/pipeline-config.ts`.

## Commands

### Infrastructure (root)

| Command | Description |
|---|---|
| `npm install` | Install CDK/backend dependencies |
| `npm run build` | Compile TypeScript |
| `npm run synth` | Synthesise all CloudFormation stacks |
| `npm run test` | Run Jest unit tests |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npx cdk deploy --all` | Deploy all stacks |
| `npx cdk diff` | Diff deployed vs local |

### Frontend (`frontend/`)

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | Lint frontend code |
