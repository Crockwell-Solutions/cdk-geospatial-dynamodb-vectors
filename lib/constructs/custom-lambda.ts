/**
 * A Node.js Lambda function with the project's defaults: ARM64, JSON logging to
 * a dedicated log group, X-Ray tracing and Powertools configuration.
 *
 * The AWS SDK is bundled with the function rather than taken from the Lambda
 * runtime. Vector search (`SearchVectorsCommand`) only exists in recent SDK
 * releases, and bundling pins the version to the one this project was tested with.
 *
 * @example
 * ```typescript
 * const { lambda } = new CustomLambda(this, 'GetFlight', {
 *   source: 'src/api/get-flight.ts',
 *   envConfig,
 *   environmentVariables: { TABLE_NAME: table.tableName },
 * });
 * ```
 */

import * as path from 'path';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, LoggingFormat, Runtime, SystemLogLevel, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../../config';
import { projectRoot } from '../utils/project-root';

interface CustomLambdaProps {
  readonly envConfig: EnvironmentConfig;
  /** Path to the handler source file, relative to the project root */
  readonly source: string;
  readonly environmentVariables?: Record<string, string>;
  readonly memorySize?: number;
  readonly timeout?: Duration;
}

export class CustomLambda extends Construct {
  public readonly logGroup: LogGroup;
  public readonly lambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: CustomLambdaProps) {
    super(scope, id);

    const { envConfig } = props;
    const functionName = `${envConfig.project}-${id}`;

    this.logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.lambda = new NodejsFunction(this, 'Function', {
      functionName,
      entry: path.join(projectRoot, props.source),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize ?? 1024,
      timeout: props.timeout ?? Duration.seconds(29),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: functionName,
        POWERTOOLS_LOG_LEVEL: envConfig.logLevel,
        ...props.environmentVariables,
      },
      logGroup: this.logGroup,
      loggingFormat: LoggingFormat.JSON,
      systemLogLevelV2: SystemLogLevel.WARN,
      tracing: Tracing.ACTIVE,
      bundling: {
        bundleAwsSDK: true,
        sourceMap: true,
        minify: envConfig.minifyCodeOnDeployment,
        esbuildArgs: { '--log-level': 'warning' },
      },
    });
  }
}
