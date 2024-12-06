import { cleanEnv, str } from 'envalid'
import 'dotenv/config'

const commonFields = {
  CDK_DEFAULT_REGION: str(),
  CDK_DEFAULT_ACCOUNT: str()
}

export const coreEnv = cleanEnv(
  process.env,
  Object.assign(commonFields, {
    DOMAIN_NAME: str(),
    HOSTED_ZONE_ID: str(),
    CLOUDFRONT_CERTIFICATE_ARN: str()
  })
)

export const dynamicEnv = cleanEnv(
  process.env,
  Object.assign(commonFields, {
    ECS_ECR_ADMIN_ARN: str(),
    ECS_TASK_EXECUTION_ARN: str()
  })
)
