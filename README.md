# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template


## Notes

* If I am going to spin up and tear everything down constantly, I might as well just use ECS and Fargate
  * I have to consider if I will put ECS in the core-stack or dynamic stack
* I can export certain values from one stack and import them into another
  * new BackendInfraStack(app, 'BackendInfraStack', {staticAssetsBucket: staticAssetsStack.bucket});
  
## Milestones

### Have the frontend be able to hit the backend
* [x] Have S3 bucket webpage accessible from IP
  * [x] Same with URL
* [x] Have ECS layer accessible from URL
* [] Write a destroy-dynamic GHA workflow
* [] Write a deploy-dynamic GHA workflow
  * This should check that core is up, if not, run deploy-core
  * This should invoke the FE and BE on-push workflows
    * BE needs on-push logic to upload to ECR and refresh the ECS service
* [] Ensure I can update content on S3 via GHA
  * [] Same with ECS
* [] Have S3 content be able to hit the ECS layer

### Set up RDS

### Get the WebSockets working

## Have ECS layer accessible from URL
* Fix logic in BE to publish to ECR & deploy on ECS
* Correct DynamicStack
  * Wire up everything