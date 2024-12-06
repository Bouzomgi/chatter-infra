import { cleanEnv, str } from 'envalid'
import 'dotenv/config'

const env = cleanEnv(process.env, {
  CDK_DEFAULT_REGION: str(),
  CDK_DEFAULT_ACCOUNT: str(),

  DOMAIN_NAME: str(),
  HOSTED_ZONE_ID: str(),
  CLOUDFRONT_CERTIFICATE_ARN: str(),

  ARN_ECS_ECR_ADMIN: str(),
  ARN_ECS_TASK_EXECUTION: str()
})

export default env
