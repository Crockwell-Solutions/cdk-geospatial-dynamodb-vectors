/*
 * CDK Stack - Stateful Resources
 *
 * The DynamoDB table that holds every flight and position report, with:
 *  - a GSI for listing flights by the hour in which they start
 *  - a 4-dimensional vector index over the position reports
 *
 * Copyright Crockwell Solutions Limited
 */

import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EnvironmentConfig, Stage, getRemovalPolicyFromStage } from '../../config';
import { VECTOR_DIMENSIONS } from '../../src/geo/vector-space';
import { LIST_INDEX, TABLE_KEYS, VECTOR_INDEX } from '../../src/store/keys';
import { CustomTable } from '../constructs/custom-table';
import { addStackNagChecks } from '../utils/nag-checks';

export interface StatefulStackProps extends StackProps {
  stage: Stage;
  envConfig: EnvironmentConfig;
}

export class StatefulStack extends Stack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: StatefulStackProps) {
    super(scope, id, props);

    this.table = new CustomTable(this, 'FlightsTable', {
      tableName: props.envConfig.tableName,
      removalPolicy: getRemovalPolicyFromStage(props.stage),
      partitionKey: { name: TABLE_KEYS.partitionKey, type: AttributeType.STRING },
      sortKey: { name: TABLE_KEYS.sortKey, type: AttributeType.STRING },
      globalSecondaryIndexes: [
        {
          indexName: LIST_INDEX.name,
          partitionKey: { name: LIST_INDEX.partitionKey, type: AttributeType.STRING },
          sortKey: { name: LIST_INDEX.sortKey, type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
      ],
      vectorIndexes: [
        {
          // Each position report stores [x, y, z, t] in the `vec` attribute. EUCLIDEAN because
          // the question is "how far apart?", not "pointing the same way?" (COSINE) or
          // "how aligned and how large?" (DOT_PRODUCT).
          indexName: VECTOR_INDEX.name,
          vectorAttribute: VECTOR_INDEX.attribute,
          dimensions: VECTOR_DIMENSIONS,
          distanceFunction: 'EUCLIDEAN',
        },
      ],
    }).table;

    new CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table holding flights and position reports',
    });

    addStackNagChecks(this, []);
  }
}
