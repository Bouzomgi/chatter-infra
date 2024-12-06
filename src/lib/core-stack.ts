import { coreEnv } from '../config'
import { App, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cdkTags from 'aws-cdk-lib/core'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets'
import * as ecr from 'aws-cdk-lib/aws-ecr'

const awsEnv = {
  env: {
    region: coreEnv.CDK_DEFAULT_REGION,
    account: coreEnv.CDK_DEFAULT_ACCOUNT
  }
}

// CREATE S3 WEBSERVER, CLOUDFRONT DISTRIBUTION, ROUTE53 RECORDS

export class CoreStack extends Stack {
  public readonly backendEcrRepo: ecr.Repository

  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props ? Object.assign(props, awsEnv) : awsEnv)

    // CREATE S3 BUCKET FOR WEBSERVER
    const webserverBucket = new s3.Bucket(this, 'chatter-webserver', {
      autoDeleteObjects: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicPolicy: false,
        blockPublicAcls: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      }),
      bucketName: 'chatter-webserver',
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      websiteIndexDocument: 'index.html'
    })

    // CREATE ECR REPOSITORY FOR BACKEND
    this.backendEcrRepo = new ecr.Repository(this, 'chatter-backend-repo', {
      emptyOnDelete: true,
      repositoryName: 'chatter-backend'
    })

    // CREATE CLOUDFRONT DISTRIBUTION
    const appDistribution = new cloudfront.Distribution(
      this,
      'chatter-cloudfront-distribution',
      {
        defaultBehavior: {
          origin: new origins.S3StaticWebsiteOrigin(webserverBucket)
        },
        certificate: Certificate.fromCertificateArn(
          this,
          coreEnv.DOMAIN_NAME,
          coreEnv.CLOUDFRONT_CERTIFICATE_ARN
        ),
        defaultRootObject: 'index.html',
        domainNames: [coreEnv.DOMAIN_NAME],
        geoRestriction: cloudfront.GeoRestriction.allowlist('US')
      }
    )

    //POINT ROUTE53 TO CLOUDFRONT DISTRIBUTION
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      'chatter-hosted-zone',
      {
        hostedZoneId: coreEnv.HOSTED_ZONE_ID,
        zoneName: coreEnv.DOMAIN_NAME
      }
    )

    new route53.ARecord(this, 'AliasRecordIPv4', {
      zone: hostedZone,
      recordName: coreEnv.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    new route53.AaaaRecord(this, 'AliasRecordIPv6', {
      zone: hostedZone,
      recordName: coreEnv.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    cdkTags.Tags.of(appDistribution).add('project', 'chatter')
  }
}
