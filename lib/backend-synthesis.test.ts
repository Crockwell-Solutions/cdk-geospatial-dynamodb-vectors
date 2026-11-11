import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, NestedStack, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MockIntegration } from 'aws-cdk-lib/aws-apigateway';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { AwsSolutionsChecks } from 'cdk-nag';
import { EnvironmentConfig, Stage } from '../config';
import { StatefulStack } from './stateful/stateful-stack';
import { StatelessStack } from './stateless/stateless-stack';
import { scopeReplicaProviderLogging } from './utils/replica-provider-logging';

let outputDirectory: string;
let app: App;
const env = { account: '111111111111', region: 'eu-west-1' };
const envConfig: EnvironmentConfig = {
  env,
  regions: ['eu-west-1', 'ap-southeast-4'],
  stage: Stage.local,
  project: 'Template',
  name: 'Local',
  terminationProtection: false,
  logLevel: 'INFO',
  cognitoUserPoolArn: 'arn:aws:cognito-idp:eu-west-1:111111111111:userpool/eu-west-1_example',
  cognitoUserPoolClientId: 'example',
  apiDomainName: 'api.example.invalid',
};

beforeEach(() => {
  outputDirectory = mkdtempSync(join(tmpdir(), 'template-backend-synthesis-'));
  const { context } = JSON.parse(readFileSync(join(__dirname, '../cdk.json'), 'utf8'));
  app = new App({ outdir: outputDirectory, autoSynth: false, context });
});

afterEach(() => rmSync(outputDirectory, { recursive: true, force: true }));

function createBackend() {
  const stateful = new StatefulStack(app, 'Stateful', { env, envConfig, stage: Stage.local });
  const stateless = new StatelessStack(app, 'Stateless', {
    env,
    envConfig,
    stage: Stage.local,
    table: stateful.table,
  });
  return { stateful, stateless };
}

test('synthesizes the public health route and two-region replicas with scoped provider logging', () => {
  const { stateful, stateless } = createBackend();
  const assembly = app.synth();
  const apiTemplate = Template.fromJSON(assembly.getStackArtifact(stateless.artifactId).template);
  apiTemplate.resourceCountIs('AWS::ApiGateway::Authorizer', 0);
  apiTemplate.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'GET', AuthorizationType: 'NONE' });
  const provider = stateful.node.findChild('@aws-cdk--aws-dynamodb.ReplicaProvider') as NestedStack;
  const providerTemplate = Template.fromStack(provider);
  providerTemplate.resourceCountIs('AWS::Lambda::Function', 5);
  providerTemplate.resourceCountIs('AWS::Logs::LogGroup', 5);
  providerTemplate.allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
  expect(JSON.stringify(providerTemplate.toJSON())).not.toContain('AWSLambdaBasicExecutionRole');

  for (const fn of provider.node.findAll().filter((node): node is LambdaFunction => node instanceof LambdaFunction)) {
    const resource = fn.node.defaultChild as CfnFunction;
    const loggingConfig = provider.resolve(resource.loggingConfig);
    const logGroupId = loggingConfig.logGroup.Ref;
    providerTemplate.hasResourceProperties('AWS::IAM::Policy', {
      Roles: [provider.resolve(fn.role!.roleName)],
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: { 'Fn::GetAtt': [logGroupId, 'Arn'] },
          },
        ]),
      },
    });
  }
  // Removing the logging managed policy must retain the provider's operational permissions.
  providerTemplate.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({ Action: 'dynamodb:DescribeLimits', Effect: 'Allow' })]),
    },
  });
  expect(
    new AwsSolutionsChecks()
      .validateScope(stateful)
      .violations.some(({ ruleName }) => ruleName.startsWith('AwsSolutions-IAM4')),
  ).toBe(false);
});

test('creates one Cognito authorizer when protected methods are added and keeps health public', () => {
  const { stateless } = createBackend();
  const protectedResource = stateless.api.root.addResource('protected-test');
  stateless.addCognitoAuthorizedMethod(protectedResource, 'GET', new MockIntegration());
  stateless.addCognitoAuthorizedMethod(protectedResource, 'POST', new MockIntegration());
  const assembly = app.synth();
  const template = Template.fromJSON(assembly.getStackArtifact(stateless.artifactId).template);
  template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
  template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
    Type: 'COGNITO_USER_POOLS',
    ProviderARNs: [envConfig.cognitoUserPoolArn],
  });
  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'GET',
    AuthorizationType: 'COGNITO_USER_POOLS',
  });
  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'POST',
    AuthorizationType: 'COGNITO_USER_POOLS',
  });
  template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'GET', AuthorizationType: 'NONE' });
});

test('the health exception does not hide an accidentally public application route', () => {
  const { stateless } = createBackend();
  stateless.api.root.addResource('unprotected-test').addMethod('GET', new MockIntegration());
  const rules = new AwsSolutionsChecks().validateScope(stateless).violations.map(({ ruleName }) => ruleName);
  expect(rules).toContain('AwsSolutions-APIG4');
  expect(rules).toContain('AwsSolutions-COG4');
});

test('logging changes preserve shared roles, other managed policies, and unrelated functions', () => {
  const stack = new Stack(app, 'LoggingScope', { env });
  const provider = new Construct(stack, '@aws-cdk--aws-dynamodb.ReplicaProvider');
  const role = new Role(provider, 'SharedRole', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess'),
    ],
  });
  const props = {
    code: Code.fromInline('exports.handler = async () => {};'),
    handler: 'index.handler',
    runtime: Runtime.NODEJS_24_X,
  };
  const first = new LambdaFunction(provider, 'First', { ...props, role });
  const second = new LambdaFunction(provider, 'Second', { ...props, role });
  const unrelated = new LambdaFunction(stack, 'Unrelated', props);
  const idsBefore = [first, second, unrelated].map((fn) => stack.getLogicalId(fn.node.defaultChild as CfnFunction));

  scopeReplicaProviderLogging(stack, RemovalPolicy.RETAIN);

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Logs::LogGroup', 2);
  template.hasResourceProperties('AWS::IAM::Role', {
    ManagedPolicyArns: [stack.resolve(ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess').managedPolicyArn)],
  });
  template.hasResourceProperties('AWS::IAM::Role', {
    ManagedPolicyArns: [
      stack.resolve(
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole').managedPolicyArn,
      ),
    ],
  });
  expect([first, second, unrelated].map((fn) => stack.getLogicalId(fn.node.defaultChild as CfnFunction))).toEqual(
    idsBefore,
  );
  template.hasResourceProperties('AWS::Lambda::Function', { LoggingConfig: { LogGroup: Match.anyValue() } });
  const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
    (policy) => policy.Properties.PolicyDocument.Statement,
  );
  const logResources = statements
    .filter((statement) => statement.Action.includes('logs:PutLogEvents'))
    .flatMap((statement) => (Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]));
  expect(logResources).toHaveLength(2);
});
