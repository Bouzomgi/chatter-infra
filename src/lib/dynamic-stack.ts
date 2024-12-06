import env from '../config'
import { App, Stack, StackProps, Fn } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as iam from 'aws-cdk-lib/aws-iam'

const awsEnv = {
  env: {
    region: env.AWS_REGION,
    account: env.AWS_ACCOUNT_ID
  }
}

// CREATE VPC AND SUBNETS, ECS BACKEND

export class DynamicStack extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props ? Object.assign(props, awsEnv) : awsEnv)

    // Import CoreStack values
    const repositoryName = Fn.importValue('backendEcrRepoName')

    ///////////// VPC /////////////

    // CREATE VPC & SUBNETS
    const vpc = new ec2.Vpc(this, 'chatter-vpc', {
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      natGatewaySubnets: {
        availabilityZones: ['us-east-1a'],
        subnetType: ec2.SubnetType.PUBLIC
      },
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 20,
          name: 'server',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ],
      vpcName: 'chatter-vpc'
    })

    const natGatewaySubnet = vpc.publicSubnets.filter(
      (elem) => elem.availabilityZone == 'us-east-1a'
    )[0]

    const natGatewayEip = new ec2.CfnEIP(this, 'nat-gateway-eip')

    // ADD NAT GATEWAY TO PUBLIC SUBNET
    const natGateway = new ec2.CfnNatGateway(this, 'chatter-nat-gateway', {
      subnetId: natGatewaySubnet.subnetId,
      allocationId: natGatewayEip.attrAllocationId
    })

    // ADD ROUTES FROM PRIVATE SUBNETS TO PUBLIC SUBNETS
    vpc.privateSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `subnet${index}-nat-route`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        natGatewayId: natGateway.attrNatGatewayId
      })
    })

    ///////////// ECS /////////////

    // GET REFERENCES TO EXISTING ROLES TO BE USED BY ECS
    const ecsEcrAdmin = iam.Role.fromRoleArn(
      this,
      'ecs-ecr-admin',
      env.ECS_ECR_ADMIN_ARN
    )
    const ecsTaskExecutionRole = iam.Role.fromRoleArn(
      this,
      'ecs-task-execution-role',
      env.ECS_TASK_EXECUTION_ARN
    )

    // CREATE ECS CLUSTER
    const cluster = new ecs.Cluster(this, 'chatter-cluster', {
      clusterName: 'chatter',
      vpc: vpc,
      enableFargateCapacityProviders: true
    })

    // CREATE LOG DRIVERS FOR APPSERVER
    const logGroup = new logs.LogGroup(this, 'chatter-log-group')

    const backendLogDriver = ecs.LogDriver.awsLogs({
      streamPrefix: 'backend',
      logGroup
    })

    const backendTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'chatter-backend-taskdefiniton',
      {
        cpu: 256,
        family: 'chatter-backend',
        executionRole: ecsEcrAdmin,
        taskRole: ecsTaskExecutionRole
      }
    )

    backendTaskDefinition.addContainer('appserver', {
      image: ecs.ContainerImage.fromRegistry(repositoryName),
      containerName: 'appserver',
      cpu: 0,
      logging: backendLogDriver,
      portMappings: [
        {
          name: 'appserver-80-tcp',
          containerPort: 80,
          hostPort: 80
        }
      ]
    })
  }
}

/*
 * try to deploy from the cluster on console
 * add loadbalancer to service
 * attach loadbalancer to cloudfront
 * test it all, then go to chatter-be
 */
