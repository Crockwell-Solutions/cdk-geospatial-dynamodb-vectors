import { RemovalPolicy, Stack, Token } from 'aws-cdk-lib';
import { CfnRole, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { CfnFunction, Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

/** Replace only the DynamoDB replica provider's broad logging policy with scoped log grants. */
export function scopeReplicaProviderLogging(stack: Stack, removalPolicy: RemovalPolicy): void {
  // Table creates this singleton nested stack; leave application and other provider roles untouched.
  const provider = stack.node.tryFindChild('@aws-cdk--aws-dynamodb.ReplicaProvider');
  if (!provider) return;

  const scopedRoles = new Set<CfnRole>();
  for (const construct of provider.node.findAll()) {
    if (!(construct instanceof LambdaFunction)) continue;
    const role = construct.role?.node.defaultChild;
    const lambda = construct.node.defaultChild;
    if (!(role instanceof CfnRole) || !(lambda instanceof CfnFunction)) continue;

    if (!scopedRoles.has(role)) {
      const roleStack = Stack.of(role);
      const basicLoggingPolicy = roleStack.resolve(
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole').managedPolicyArn,
      );
      const managedPolicies: unknown[] = roleStack.resolve(role.managedPolicyArns) ?? [];
      const retainedPolicies = managedPolicies.filter(
        (policy) => JSON.stringify(policy) !== JSON.stringify(basicLoggingPolicy),
      );
      if (retainedPolicies.length === managedPolicies.length) continue;
      // A public L1 escape hatch is needed because Table does not expose provider role options.
      role.managedPolicyArns = retainedPolicies.length
        ? retainedPolicies.map((policy) => Token.asString(policy))
        : undefined;
      scopedRoles.add(role);
    }

    // Independent log-group names avoid a function -> role -> function reference cycle.
    const logGroup = new LogGroup(construct, 'ScopedLogs', {
      retention: RetentionDays.THREE_MONTHS,
      removalPolicy,
    });
    logGroup.grantWrite(construct);
    lambda.loggingConfig = {
      ...Stack.of(lambda).resolve(lambda.loggingConfig),
      logGroup: logGroup.logGroupName,
    };
  }
}
