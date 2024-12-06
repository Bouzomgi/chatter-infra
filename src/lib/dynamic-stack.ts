import env from '../config'
import { App, Stack, StackProps } from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as iam from 'aws-cdk-lib/aws-iam'

const awsEnv = {
  env: {
    region: env.CDK_DEFAULT_REGION,
    account: env.CDK_DEFAULT_ACCOUNT
  }
}

// CREATE VPC AND SUBNETS, ECS BACKEND

export class DynamicStack extends Stack {
  constructor(
    scope: App,
    id: string,
    props: StackProps & { backendEcrRepo: ecr.Repository }
  ) {
    super(scope, id, props ? Object.assign(props, awsEnv) : awsEnv)

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
    const natGateway = new ec2.CfnNatGateway(this, 'ca3-nat-gateway', {
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
    const cluster = new ecs.Cluster(this, 'ca3-cluster', {
      clusterName: 'ca3',
      vpc: vpc,
      enableFargateCapacityProviders: true
    })

    // CREATE LOG DRIVERS FOR APPSERVER
    const logGroup = new logs.LogGroup(this, 'ca3-log-group')

    const appserverLogDriver = ecs.LogDriver.awsLogs({
      streamPrefix: 'appserver',
      logGroup
    })

    const appserverTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ca3-appserver-taskdefiniton',
      {
        cpu: 256,
        family: 'ca3-appserver-taskdefiniton',
        executionRole: ecsEcrAdmin,
        taskRole: ecsTaskExecutionRole
      }
    )

    appserverTaskDefinition.addContainer('appserver', {
      image: ecs.ContainerImage.fromRegistry(
        props.backendEcrRepo.repositoryName
      ),
      containerName: 'appserver',
      cpu: 0,
      logging: appserverLogDriver,
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
