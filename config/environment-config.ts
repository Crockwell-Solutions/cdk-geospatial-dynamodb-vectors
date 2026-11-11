import { RemovalPolicy } from 'aws-cdk-lib';
import { Stage } from './types';

export interface EnvironmentConfig {
  env: {
    account?: string;
    region: string;
  };
  stage: Stage;
  /** Prefix for stack, table and function names */
  project: string;
  /** Name of the DynamoDB table. The data loader (`npm run load-data`) uses the same default. */
  tableName: string;
  logLevel: string;
  minifyCodeOnDeployment: boolean;
  /** Requests per second allowed across the whole API. The API is public, so keep this modest. */
  apiThrottle: {
    rateLimit: number;
    burstLimit: number;
  };
}

export const DEFAULT_TABLE_NAME = 'FlightVectors';

/**
 * The demo deploys a single environment into whichever account and region your
 * AWS credentials point at. DynamoDB vector indexes are not yet available in
 * every region, so set CDK_DEFAULT_REGION (or AWS_REGION) to one where they are.
 */
export const getEnvironmentConfig = (): EnvironmentConfig => ({
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'eu-west-1',
  },
  stage: Stage.dev,
  project: 'FlightVectors',
  tableName: DEFAULT_TABLE_NAME,
  logLevel: 'INFO',
  minifyCodeOnDeployment: true,
  apiThrottle: {
    rateLimit: 20,
    burstLimit: 40,
  },
});

/** Everything is disposable outside production, so `cdk destroy` leaves nothing behind */
export function getRemovalPolicyFromStage(stage: Stage): RemovalPolicy {
  return stage === Stage.prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
}
