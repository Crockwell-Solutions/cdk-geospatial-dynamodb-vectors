import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, IPolicyValidationContext, Stack } from 'aws-cdk-lib';
import { CfnRole } from 'aws-cdk-lib/aws-iam';
import { CfnBucket } from 'aws-cdk-lib/aws-s3';
import { addStackNagChecks } from './nag-checks';

let outputDirectory: string;
let app: App;
let stack: Stack;
let context: IPolicyValidationContext;

beforeEach(() => {
  outputDirectory = mkdtempSync(join(tmpdir(), 'template-nag-checks-'));
  app = new App({ outdir: outputDirectory });
  stack = new Stack(app, 'CheckedStack');
  context = { appConstruct: app, templatePaths: [], stackTemplates: [] };
});

afterEach(() => {
  rmSync(outputDirectory, { recursive: true, force: true });
});

function addWildcardRole(): CfnRole {
  return new CfnRole(stack, 'Role', {
    assumeRolePolicyDocument: {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    },
    managedPolicyArns: ['arn:aws:iam::aws:policy/ReadOnlyAccess'],
    policies: [
      {
        policyName: 'WildcardAccess',
        policyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }],
        },
      },
    ],
  });
}

test('keeps blanket IAM suppressions and audit metadata within the original stack', () => {
  const role = addWildcardRole();
  const siblingStack = new Stack(app, 'UncheckedStack');
  new CfnBucket(siblingStack, 'Bucket');
  const suppressions = [
    { id: 'AwsSolutions-IAM4', reason: 'Existing managed policy exception.' },
    { id: 'AwsSolutions-IAM5', reason: 'Existing wildcard permission exception.' },
  ];
  const plugin = addStackNagChecks(stack, suppressions);

  expect(plugin.validate(context)).toMatchObject({ success: true, violations: [] });

  const assembly = app.synth();
  const template = assembly.getStackArtifact(stack.artifactId).template;
  expect(template.Resources[stack.getLogicalId(role)].Metadata.cdk_nag.rules_to_suppress).toEqual(suppressions);
});

test('continues reporting unrelated findings in the checked stack', () => {
  addWildcardRole();
  new CfnBucket(stack, 'Bucket');
  const plugin = addStackNagChecks(stack, [
    { id: 'AwsSolutions-IAM4', reason: 'Existing managed policy exception.' },
    { id: 'AwsSolutions-IAM5', reason: 'Existing wildcard permission exception.' },
  ]);

  const report = plugin.validate(context);
  expect(report.success).toBe(false);
  expect(report.violations.some(({ ruleName }) => ruleName === 'AwsSolutions-S1')).toBe(true);
  expect(report.violations.some(({ ruleName }) => ruleName.startsWith('AwsSolutions-IAM'))).toBe(false);
});

test('keeps granular acknowledgments narrow and does not suppress similarly named rules', () => {
  addWildcardRole();
  const plugin = addStackNagChecks(stack, [
    { id: 'AwsSolutions-IAM5[Action::s3:*]', reason: 'Only this action was accepted.' },
    { id: 'AwsSolutions-IAM', reason: 'A prefix must not suppress IAM4 or IAM5.' },
  ]);

  const report = plugin.validate(context);
  const ruleNames = report.violations.map(({ ruleName }) => ruleName);
  expect(report.success).toBe(false);
  expect(ruleNames).not.toContain('AwsSolutions-IAM5[Action::s3:*]');
  expect(ruleNames).toContain('AwsSolutions-IAM5[Resource::*]');
  expect(ruleNames).toContain('AwsSolutions-IAM4[Policy::arn:aws:iam::aws:policy/ReadOnlyAccess]');
});
