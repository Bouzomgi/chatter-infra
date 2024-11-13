import { cleanEnv, str } from 'envalid'
import 'dotenv/config'

const env = cleanEnv(process.env, {
  CDK_DEFAULT_REGION: str(),
  CDK_DEFAULT_ACCOUNT: str(),

  DOMAIN_NAME: str(),
  ARN_CLOUDFRONT_CERTIFICATE: str()
})

export default env
