/**
 * A DynamoDB table with sensible defaults (on-demand billing, AWS-managed
 * encryption, point-in-time recovery) and support for vector indexes.
 *
 * The L2 `Table` construct does not expose vector indexes yet, so they are set
 * on the underlying L1 `CfnTable`, which maps directly to the `VectorIndexes`
 * property of `AWS::DynamoDB::Table`. When L2 support arrives this construct is
 * the only place that needs to change.
 *
 * @example
 * ```typescript
 * const { table } = new CustomTable(this, 'Table', {
 *   tableName: 'Flights',
 *   removalPolicy: RemovalPolicy.DESTROY,
 *   partitionKey: { name: 'PK', type: AttributeType.STRING },
 *   vectorIndexes: [
 *     { indexName: 'position-4d', vectorAttribute: 'vec', dimensions: 4, distanceFunction: 'EUCLIDEAN' },
 *   ],
 * });
 * ```
 */

import { RemovalPolicy } from 'aws-cdk-lib';
import {
  Attribute,
  BillingMode,
  CfnTable,
  GlobalSecondaryIndexProps,
  ITable,
  Table,
  TableEncryption,
  TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type VectorDistanceFunction = 'EUCLIDEAN' | 'COSINE' | 'DOT_PRODUCT';

export interface VectorIndexProps {
  indexName: string;
  /** Name of the attribute holding the vector: a list of numbers, one per dimension */
  vectorAttribute: string;
  /** Number of dimensions. Every indexed item must have exactly this many. Maximum 4,096. */
  dimensions: number;
  /** Cannot be changed after the index is created */
  distanceFunction: VectorDistanceFunction;
  /**
   * Other attributes to copy into the index. Only projected attributes can be
   * returned by a search. Omit to project every attribute.
   */
  nonKeyAttributes?: string[];
}

interface CustomTableProps extends Pick<TableProps, 'tableName' | 'sortKey'> {
  partitionKey: Attribute;
  removalPolicy: RemovalPolicy;
  globalSecondaryIndexes?: GlobalSecondaryIndexProps[];
  vectorIndexes?: VectorIndexProps[];
}

export class CustomTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: CustomTableProps) {
    super(scope, id);

    const { globalSecondaryIndexes = [], vectorIndexes = [], ...tableProps } = props;

    this.table = new Table(this, id, {
      // Vector indexes are only supported on on-demand tables
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 7,
      },
      ...tableProps,
    });

    for (const index of globalSecondaryIndexes) {
      this.table.addGlobalSecondaryIndex(index);
    }

    if (vectorIndexes.length > 0) {
      const cfnTable = this.table.node.defaultChild as CfnTable;
      cfnTable.vectorIndexes = vectorIndexes.map((index): CfnTable.VectorIndexProperty => ({
        indexName: index.indexName,
        vectorAttribute: { attributeName: index.vectorAttribute },
        dimensions: index.dimensions,
        distanceFunction: index.distanceFunction,
        projection: index.nonKeyAttributes
          ? { projectionType: 'INCLUDE', nonKeyAttributes: index.nonKeyAttributes }
          : { projectionType: 'ALL' },
      }));
    }
  }
}

/**
 * Allows `grantee` to run vector searches against one vector index.
 *
 * `table.grantReadData()` does not cover this: searching needs its own action,
 * `dynamodb:SearchVectors`, on the index ARN.
 */
export function grantSearchVectors(table: ITable, grantee: IGrantable, indexName: string): Grant {
  return Grant.addToPrincipal({
    grantee,
    actions: ['dynamodb:SearchVectors'],
    resourceArns: [`${table.tableArn}/index/${indexName}`],
  });
}
