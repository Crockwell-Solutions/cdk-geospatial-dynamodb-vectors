/*
 * CDK Stack - Frontend Resources
 *
 * One CloudFront distribution serves both the React application (from S3) and
 * the API (from API Gateway, under /api). Same origin for everything means no
 * CORS and no runtime configuration for the frontend to load.
 *
 * Copyright Crockwell Solutions Limited
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { CfnOutput, DockerImage, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  CachedMethods,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { RestApiOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { EnvironmentConfig, Stage } from '../../config';
import { projectRoot } from '../utils/project-root';

export interface FrontendStackProps extends StackProps {
  stage: Stage;
  envConfig: EnvironmentConfig;
  api: RestApi;
}

/** Hosts the map is allowed to load basemap tiles from */
const BASEMAP_TILE_HOSTS = ['https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com'];

export class FrontendStack extends Stack {
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { project } = props.envConfig;

    const websiteBucket = new Bucket(this, 'WebsiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const quoted = (keyword: string): string => `'${keyword}'`;
    const self = quoted('self');
    const none = quoted('none');
    const contentSecurityPolicy = [
      `default-src ${self}`,
      `base-uri ${self}`,
      `object-src ${none}`,
      `frame-ancestors ${none}`,
      `form-action ${self}`,
      `script-src ${self}`,
      // MapLibre positions its markers and controls with inline styles
      `style-src ${self} ${quoted('unsafe-inline')}`,
      `font-src ${self} data:`,
      [`img-src ${self} data: blob:`, ...BASEMAP_TILE_HOSTS].join(' '),
      // The API is same-origin; only basemap tiles are fetched from elsewhere
      [`connect-src ${self}`, ...BASEMAP_TILE_HOSTS].join(' '),
      // MapLibre runs its tile workers from blob URLs
      `worker-src ${self} blob:`,
      `child-src ${self} blob:`,
      'upgrade-insecure-requests',
    ].join('; ');

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: `${project} frontend security headers`,
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            override: true,
          },
        ],
      },
    });

    // Vite fingerprints everything under /assets, so it can be cached for a year
    const staticAssetCachePolicy = new CachePolicy(this, 'StaticAssetCachePolicy', {
      comment: 'Cache immutable Vite assets without varying on viewer-controlled input',
      defaultTtl: Duration.days(365),
      maxTtl: Duration.days(365),
      minTtl: Duration.days(1),
      cookieBehavior: CacheCookieBehavior.none(),
      headerBehavior: CacheHeaderBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });

    const websiteOrigin = S3BucketOrigin.withOriginAccessControl(websiteBucket);

    this.distribution = new Distribution(this, 'WebsiteDistribution', {
      comment: `${project} map application and API`,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: websiteOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: CachedMethods.CACHE_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeaders,
      },
      additionalBehaviors: {
        'assets/*': {
          origin: websiteOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: CachedMethods.CACHE_GET_HEAD,
          cachePolicy: staticAssetCachePolicy,
          responseHeadersPolicy: securityHeaders,
        },
        // API Gateway. Each Lambda decides how long its response may be cached via Cache-Control:
        // flight lists are cached at the edge for a few minutes, analysis results are never cached.
        'api/*': {
          origin: new RestApiOrigin(props.api),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: CachedMethods.CACHE_GET_HEAD,
          cachePolicy: CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          compress: true,
        },
      },
    });

    // Build the React application and upload it
    const frontendPath = path.join(projectRoot, 'frontend');
    new BucketDeployment(this, 'WebsiteDeployment', {
      sources: [
        Source.asset(frontendPath, {
          exclude: ['node_modules', 'dist'],
          bundling: {
            // Fallback used only if the local build below is unavailable
            image: DockerImage.fromRegistry('node:24'),
            command: ['bash', '-c', 'npm ci && npm run build && cp -r dist/. /asset-output/'],
            local: {
              tryBundle(outputDir: string): boolean {
                execSync('npm ci && npm run build', { cwd: frontendPath, stdio: 'inherit' });
                execSync(`cp -r ${path.join(frontendPath, 'dist')}/. ${outputDir}`, { stdio: 'inherit' });
                return true;
              },
            },
          },
        }),
      ],
      destinationBucket: websiteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'SiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Open this in a browser once the flight data has been loaded',
    });
  }
}
