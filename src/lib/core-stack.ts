import env from '../config'
import { App, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'

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
  }
}
