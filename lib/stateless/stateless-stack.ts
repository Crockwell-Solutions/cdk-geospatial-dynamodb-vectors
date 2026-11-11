/*
 * CDK Stack - Stateless Resources
 *
 * The flights API: API Gateway in front of one Lambda function per route.
 *
 *   GET /api/health                         table and vector index status
 *   GET /api/manifest                       what has been loaded
 *   GET /api/flights?bucket=HH              flights starting in a UTC hour
 *   GET /api/flights/{flightId}             one flight with its position reports
 *   GET /api/flights/{flightId}/nearby      flights that came close, via the vector index
 *
 * Copyright Crockwell Solutions Limited
 */

import { CfnOutput, Duration, Size, Stack, StackProps } from 'aws-cdk-lib';
import { Cors, EndpointType, IResource, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { EnvironmentConfig, Stage } from '../../config';
import { VECTOR_INDEX } from '../../src/store/keys';
import { CustomLambda } from '../constructs/custom-lambda';
import { grantSearchVectors } from '../constructs/custom-table';
import { addStackNagChecks } from '../utils/nag-checks';

export interface StatelessStackProps extends StackProps {
  stage: Stage;
  envConfig: EnvironmentConfig;
  table: Table;
}

export class StatelessStack extends Stack {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);

    const { envConfig, table } = props;

    this.api = new RestApi(this, 'FlightsApi', {
      restApiName: `${envConfig.project} API`,
      description: 'Flight tracks and 4D proximity search backed by a DynamoDB vector index',
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      // Flight lists compress to roughly half their size
      minCompressionSize: Size.kibibytes(1),
      deployOptions: {
        stageName: 'prod',
        // There is no authentication, so cap how hard the API can be driven
        throttlingRateLimit: envConfig.apiThrottle.rateLimit,
        throttlingBurstLimit: envConfig.apiThrottle.burstLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
      },
    });

    const lambda = (name: string, source: string, memorySize?: number): NodejsFunction => {
      const fn = new CustomLambda(this, name, {
        source,
        envConfig,
        memorySize,
        environmentVariables: { TABLE_NAME: table.tableName },
      }).lambda;
      table.grantReadData(fn);
      return fn;
    };

    const get = (resource: IResource, fn: NodejsFunction): void => {
      resource.addMethod('GET', new LambdaIntegration(fn, { timeout: Duration.seconds(29) }));
    };

    // Everything lives under /api so that CloudFront can route it with a single behaviour
    const apiRoot = this.api.root.addResource('api');

    const healthcheck = lambda('Healthcheck', 'src/api/healthcheck.ts', 256);
    healthcheck.addToRolePolicy(
      new PolicyStatement({ actions: ['dynamodb:DescribeTable'], resources: [table.tableArn] }),
    );
    get(apiRoot.addResource('health'), healthcheck);

    get(apiRoot.addResource('manifest'), lambda('GetManifest', 'src/api/get-manifest.ts', 256));

    const flights = apiRoot.addResource('flights');
    get(flights, lambda('ListFlights', 'src/api/list-flights.ts'));

    const flight = flights.addResource('{flightId}');
    get(flight, lambda('GetFlight', 'src/api/get-flight.ts'));

    // The only function that touches the vector index. Reading the table is not enough:
    // vector search has its own IAM action, scoped to the index.
    const findNearbyFlights = lambda('FindNearbyFlights', 'src/api/find-nearby-flights.ts', 1769);
    grantSearchVectors(table, findNearbyFlights, VECTOR_INDEX.name);
    get(flight.addResource('nearby'), findNearbyFlights);

    new CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'Base URL of the flights API (also available under /api on the CloudFront distribution)',
    });

    addStackNagChecks(this, [
      {
        id: 'AwsSolutions-APIG4',
        reason: 'Public, read-only demo API. No authentication by design; the stage is throttled instead.',
      },
      {
        id: 'AwsSolutions-COG4',
        reason: 'Public, read-only demo API. No authentication by design; the stage is throttled instead.',
      },
      { id: 'AwsSolutions-APIG1', reason: 'Access logging is not needed for a demo API.' },
      { id: 'AwsSolutions-APIG2', reason: 'Requests are validated in the Lambda handlers.' },
      { id: 'AwsSolutions-APIG3', reason: 'No WAF required for a throttled demo API.' },
      { id: 'AwsSolutions-APIG6', reason: 'Execution logging is not needed for a demo API.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is added by the CDK Lambda construct.' },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcards come from CDK grants: table index ARNs (grantReadData) and X-Ray tracing.',
      },
    ]);
  }
}
