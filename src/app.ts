import * as cdk from 'aws-cdk-lib'
import { CoreStack } from './lib/core-stack'
import { DynamicStack } from './lib/dynamic-stack'

const app = new cdk.App()

const coreStack = new CoreStack(app, 'CoreStack')
// const dynamicStack = new DynamicStack(app, 'DynamicStack', {
//   backendEcrRepo: coreStack.backendEcrRepo
// })
