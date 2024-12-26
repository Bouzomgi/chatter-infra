# chatter-infra

Do NOT run `cdk deploy -all` directly. Use the provided npm scripts `local:deploy-core` and `local:deploy-all`

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

## TODO:
- make sure BE can be hit from infra deployment
  - Look into how we can view the RDS DB
- set up acceptance tests on BE GHA
- THEN we can move on to the FE