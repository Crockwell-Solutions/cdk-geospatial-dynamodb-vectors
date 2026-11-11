#!/usr/bin/env node
process.setSourceMapsEnabled(true);
import { App, Tags } from 'aws-cdk-lib';
import { getEnvironmentConfig } from '../config';
import { FrontendStack } from '../lib/frontend/frontend-stack';
import { StatefulStack } from '../lib/stateful/stateful-stack';
import { StatelessStack } from '../lib/stateless/stateless-stack';

const app = new App();
const envConfig = getEnvironmentConfig();
const { project, stage, env } = envConfig;

// DynamoDB table, with its vector index
const statefulStack = new StatefulStack(app, `${project}StatefulStack`, {
  description: `${project}: DynamoDB table and 4D vector index`,
  stage,
  envConfig,
  env,
});

// API Gateway and Lambda functions
const statelessStack = new StatelessStack(app, `${project}StatelessStack`, {
  description: `${project}: flights API`,
  stage,
  envConfig,
  env,
  table: statefulStack.table,
});

// Map application, served with the API from one CloudFront distribution
const frontendStack = new FrontendStack(app, `${project}FrontendStack`, {
  description: `${project}: map frontend`,
  stage,
  envConfig,
  env,
  api: statelessStack.api,
});

for (const stack of [statefulStack, statelessStack, frontendStack]) {
  Tags.of(stack).add('project', project);
  Tags.of(stack).add('stage', stage);
}
