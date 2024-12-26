import env from '../config'
import { App, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment'

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

    ///////////// ECR /////////////

    const backendEcrRepo = new ecr.Repository(this, 'backend-repo', {
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      repositoryName: env.BACKEND_ECR_REPO_NAME
    })

    ///////////// S3 /////////////
    const storageBucket = new s3.Bucket(this, 'webserver', {
      autoDeleteObjects: true,
      bucketName: env.STORAGE_BUCKET_NAME,
      removalPolicy: RemovalPolicy.DESTROY
    })

    // Add files to the bucket
    new s3Deployment.BucketDeployment(this, 'storageBucket', {
      sources: [s3Deployment.Source.asset('./storage')],
      destinationBucket: storageBucket,
      destinationKeyPrefix: 'avatars/default/'
    })
  }
}
