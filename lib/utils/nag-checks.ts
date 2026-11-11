import { Acknowledgment, IPolicyValidationPlugin, Stack, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

/** Preserve stack-scoped checks and existing v2 blanket suppressions with cdk-nag v3. */
export function addStackNagChecks(stack: Stack, suppressions: Acknowledgment[]): IPolicyValidationPlugin {
  const checks = new AwsSolutionsChecks(stack, {
    verbose: true,
    writeSuppressionsToCloudFormation: true,
  });
  Validations.of(stack).acknowledge(...suppressions);

  const plugin: IPolicyValidationPlugin = {
    name: `${checks.name}-${stack.node.id}`,
    version: checks.version,
    ruleIds: checks.ruleIds,
    validate: () => {
      // Plugins register on the enclosing Stage; keep these checks within their original stack.
      const report = checks.validateScope(stack);
      // v3 matches granular IDs exactly, whereas v2 blanket suppressions also covered their findings.
      const violations = report.violations.filter(
        (violation) => !suppressions.some(({ id }) => violation.ruleName.startsWith(`${id}[`)),
      );
      return { ...report, success: violations.length === 0, violations };
    },
  };
  Validations.of(stack).addPlugins(plugin);
  return plugin;
}
