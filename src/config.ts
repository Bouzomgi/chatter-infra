import { cleanEnv, str } from 'envalid'
import 'dotenv/config'

const commonEnv = cleanEnv(process.env, {
  CDK_DEFAULT_REGION: str(),
  CDK_DEFAULT_ACCOUNT: str(),

  DOMAIN_NAME: str(),
  HOSTED_ZONE_ID: str(),
  CLOUDFRONT_CERTIFICATE_ARN: str(),

  ECS_ECR_ADMIN_ARN: str(),
  ECS_TASK_EXECUTION_ARN: str()
})

export default commonEnv
