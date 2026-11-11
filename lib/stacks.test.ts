import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EnvironmentConfig, getEnvironmentConfig } from '../config';
import { FrontendStack } from './frontend/frontend-stack';
import { StatefulStack } from './stateful/stateful-stack';
import { StatelessStack } from './stateless/stateless-stack';

const env = { account: '111111111111', region: 'eu-west-1' };
const envConfig: EnvironmentConfig = { ...getEnvironmentConfig(), env };

const { context } = JSON.parse(readFileSync(join(__dirname, '../cdk.json'), 'utf8'));

function createStacks(app: App) {
  const props = { env, envConfig, stage: envConfig.stage };
  const stateful = new StatefulStack(app, 'Stateful', props);
  const stateless = new StatelessStack(app, 'Stateless', { ...props, table: stateful.table });
  const frontend = new FrontendStack(app, 'Frontend', { ...props, api: stateless.api });
  return { stateful, stateless, frontend };
}

// Most tests only inspect the templates, so skip bundling the Lambda code and the frontend
const templates = (() => {
  const app = new App({ context: { ...context, 'aws:cdk:bundling-stacks': [] } });
  const { stateful, stateless, frontend } = createStacks(app);
  return {
    stateful: Template.fromStack(stateful),
    stateless: Template.fromStack(stateless),
    frontend: Template.fromStack(frontend),
  };
})();

describe('stateful stack', () => {
  test('creates an on-demand table with a four-dimensional Euclidean vector index', () => {
    const template = templates.stateful;

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'FlightVectors',
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      VectorIndexes: [
        {
          IndexName: 'position-4d',
          VectorAttribute: { AttributeName: 'vec' },
          Dimensions: 4,
          DistanceFunction: 'EUCLIDEAN',
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  test('declares only key attributes: the vector attribute needs no attribute definition', () => {
    const template = templates.stateful;
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1', Projection: { ProjectionType: 'ALL' } })],
    });
  });

  test('removes the table when the stack is destroyed', () => {
    templates.stateful.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });
});

describe('stateless stack', () => {
  test('exposes five public GET routes and no authorizer', () => {
    const template = templates.stateless;

    template.resourceCountIs('AWS::ApiGateway::Authorizer', 0);
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'))
      .map((method) => method.Properties)
      .filter((properties) => properties.HttpMethod === 'GET');
    expect(methods).toHaveLength(5);
    for (const method of methods) expect(method.AuthorizationType).toBe('NONE');

    const paths = Object.values(template.findResources('AWS::ApiGateway::Resource')).map(
      (resource) => resource.Properties.PathPart,
    );
    expect(paths.sort()).toEqual(['api', 'flights', 'health', 'manifest', 'nearby', '{flightId}']);
  });

  test('throttles the public API', () => {
    templates.stateless.hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: [Match.objectLike({ ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 })],
    });
  });

  test('grants vector search on the index to the nearby-flights function only', () => {
    const template = templates.stateless;
    const policies = Object.entries(template.findResources('AWS::IAM::Policy'));
    const withVectorSearch = policies.filter(([, policy]) =>
      JSON.stringify(policy.Properties.PolicyDocument).includes('dynamodb:SearchVectors'),
    );

    expect(withVectorSearch).toHaveLength(1);
    const [logicalId, policy] = withVectorSearch[0];
    expect(logicalId).toMatch(/^FindNearbyFlights/);

    const statement = policy.Properties.PolicyDocument.Statement.find(
      (candidate: { Action: string }) => candidate.Action === 'dynamodb:SearchVectors',
    );
    expect(statement.Effect).toBe('Allow');
    // <table arn>/index/position-4d, in a statement of its own with no conditions
    expect(JSON.stringify(statement.Resource)).toContain('/index/position-4d');
    expect(statement).not.toHaveProperty('Condition');
  });

  test('runs every function on Node.js 24 (ARM) with the table name configured', () => {
    const template = templates.stateless;
    const functions = Object.values(template.findResources('AWS::Lambda::Function'));
    expect(functions).toHaveLength(5);
    for (const fn of functions) {
      expect(fn.Properties).toMatchObject({ Runtime: 'nodejs24.x', Architectures: ['arm64'] });
      expect(fn.Properties.Environment.Variables).toHaveProperty('TABLE_NAME');
    }
  });
});

describe('synthesis', () => {
  let outputDirectory: string;

  beforeAll(() => {
    outputDirectory = mkdtempSync(join(tmpdir(), 'flight-vectors-synth-'));
  });

  afterAll(() => rmSync(outputDirectory, { recursive: true, force: true }));

  test('passes cdk-nag and bundles the AWS SDK with the nearby-flights function', () => {
    // Bundle the Lambda code for real, but still skip the frontend build
    const app = new App({
      outdir: outputDirectory,
      context: { ...context, 'aws:cdk:bundling-stacks': ['Stateless'] },
    });
    const { stateless } = createStacks(app);

    // addStackNagChecks registers the AwsSolutions pack as a validation plugin on the stateful and
    // stateless stacks: synthesis throws if either has a finding that is not acknowledged
    const assembly = app.synth();

    // SearchVectors only exists in recent SDK releases, so the bundle must carry its own copy
    // rather than rely on whatever version the Lambda runtime ships
    const resources = assembly.getStackArtifact(stateless.artifactId).template.Resources as Record<
      string,
      { Type: string; Properties: { Code: { S3Key: string } } }
    >;
    const [, nearby] = Object.entries(resources).find(
      ([id, resource]) => resource.Type === 'AWS::Lambda::Function' && id.startsWith('FindNearbyFlights'),
    )!;
    const assetDirectory = `asset.${nearby.Properties.Code.S3Key.replace('.zip', '')}`;
    const bundle = readFileSync(join(outputDirectory, assetDirectory, 'index.js'), 'utf8');
    expect(bundle).toContain('SearchVectors');
  });
});

describe('frontend stack', () => {
  test('serves the application and the API from one CloudFront distribution', () => {
    const template = templates.frontend;

    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: 'assets/*' }),
          Match.objectLike({ PathPattern: 'api/*', ViewerProtocolPolicy: 'redirect-to-https' }),
        ]),
      }),
    });
  });

  test('does not forward the viewer Host header to API Gateway', () => {
    // API Gateway rejects requests whose Host header is the CloudFront domain
    const policies = Object.values(templates.frontend.findResources('AWS::CloudFront::CachePolicy')).map(
      (policy) => policy.Properties.CachePolicyConfig,
    );
    const apiPolicy = policies.find(
      (config) => config.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior === 'all',
    );
    expect(apiPolicy.ParametersInCacheKeyAndForwardedToOrigin.HeadersConfig).toEqual({ HeaderBehavior: 'none' });
    expect(apiPolicy).toMatchObject({ MinTTL: 0, DefaultTTL: 0 });
  });

  test('has no Cognito resources or configuration', () => {
    for (const template of Object.values(templates)) {
      expect(JSON.stringify(template.toJSON())).not.toMatch(/cognito/i);
    }
  });
});
