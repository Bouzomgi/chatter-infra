import env from '../config'
import { App, Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cdkTags from 'aws-cdk-lib/core'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'

const awsEnv = {
  env: {
    region: env.AWS_REGION,
    account: env.AWS_ACCOUNT_ID
  }
}

// CREATE S3 WEBSERVER, CLOUDFRONT DISTRIBUTION, ROUTE53 RECORDS

export class CoreStack extends Stack {
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
    const backendEcrRepo = new ecr.Repository(this, 'chatter-backend-repo', {
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      repositoryName: 'chatter-be'
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
          env.DOMAIN_NAME,
          env.CLOUDFRONT_CERTIFICATE_ARN
        ),
        defaultRootObject: 'index.html',
        domainNames: [env.DOMAIN_NAME],
        geoRestriction: cloudfront.GeoRestriction.allowlist('US')
      }
    )

    //POINT ROUTE53 TO CLOUDFRONT DISTRIBUTION

    const hostedZone = route53.HostedZone.fromLookup(
      this,
      'chatter-hosted-zone',
      {
        domainName: env.DOMAIN_NAME
      }
    )

    new route53.ARecord(this, 'AliasRecordIPv4', {
      zone: hostedZone,
      recordName: env.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    new route53.AaaaRecord(this, 'AliasRecordIPv6', {
      zone: hostedZone,
      recordName: env.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    cdkTags.Tags.of(appDistribution).add('project', 'chatter')

    new CfnOutput(this, 'RepositoryName', {
      value: backendEcrRepo.repositoryName,
      exportName: 'backendEcrRepoName'
    })
  }
}
