import { cleanEnv, str } from 'envalid'
import 'dotenv/config'

const commonEnv = cleanEnv(process.env, {
  AWS_REGION: str(),
  AWS_ACCOUNT_ID: str(),

  DOMAIN_NAME: str(),
  BACKEND_ECR_REPO_NAME: str(),
  CLOUDFRONT_CERTIFICATE_ARN: str(),

  ECS_ECR_ADMIN_ARN: str(),
  ECS_TASK_EXECUTION_ARN: str(),

  // BACKEND
  PORT: str(),
  DATABASE_URL: str(),
  STORAGE_BUCKET_NAME: str(),
  TOKEN_SECRET: str()
})

export default commonEnv
