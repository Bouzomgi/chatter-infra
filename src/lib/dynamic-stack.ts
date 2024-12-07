import env from '../config'
import { App, Stack, StackProps, Fn, RemovalPolicy } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cdkTags from 'aws-cdk-lib/core'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets'

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

    ///////////// S3 /////////////

    // CREATE S3 BUCKET FOR WEBSERVER
    const webserverBucket = new s3.Bucket(this, 'webserver', {
      autoDeleteObjects: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicPolicy: false,
        blockPublicAcls: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      }),
      bucketName: 'chatter-webserver',
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      websiteIndexDocument: 'index.html'
    })

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
          name: 'api',
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
      streamPrefix: 'api',
      logGroup
    })

    const backendTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'api-task',
      {
        cpu: 256,
        family: 'chatter-be',
        executionRole: ecsEcrAdmin,
        taskRole: ecsTaskExecutionRole
      }
    )

    const ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      'backend-ecr-repo',
      env.BACKEND_ECR_REPO_NAME
    )

    backendTaskDefinition.addContainer('api-container', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository),
      containerName: 'api-container',
      cpu: 0,
      logging: backendLogDriver,
      portMappings: [
        {
          name: 'api-80-tcp',
          containerPort: 80,
          hostPort: 80
        }
      ]
    })

    // CREATE WEB SERVER SECURITY GROUP
    const backendSecurityGroup = new ec2.SecurityGroup(this, 'api-sg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    backendSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))

    // SPIN UP BACKEND SERVICE
    const backendService = new ecs.FargateService(this, 'api-service', {
      assignPublicIp: true, //to remove
      cluster,
      securityGroups: [backendSecurityGroup],
      serviceName: 'api-service',
      taskDefinition: backendTaskDefinition,
      vpcSubnets: {
        subnetGroupName: 'api'
      }
    })

    ///////////// ADD AND ATTACH ECS LOAD BALANCER /////////////
    // CREATE LOAD BALANCER SECURITY GROUP
    const albSecurityGroup = new ec2.SecurityGroup(this, 'alb-sg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))

    // CREATE FRONTEND ALB
    const frontendLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      'frontend-alb',
      {
        vpc,
        internetFacing: true,
        securityGroup: albSecurityGroup,
        vpcSubnets: {
          subnetGroupName: 'public'
        }
      }
    )
    // GET LOAD BALANCER TARGET FOR APPSERVER
    const backendTarget = backendService.loadBalancerTarget({
      containerName: 'api-container',
      containerPort: 80
    })

    // CREATE TARGET GROUP FOR APPSERVER
    const backendTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      'api-tg',
      {
        healthCheck: {
          path: '/health'
        },
        port: 80,
        targets: [backendTarget],
        vpc: vpc
      }
    )

    ///////////// CLOUDFRONT DISTRIBUTION /////////////

    // CREATE CLOUDFRONT DISTRIBUTION
    const appDistribution = new cloudfront.Distribution(
      this,
      'chatter-distribution',
      {
        defaultBehavior: {
          origin: new origins.S3StaticWebsiteOrigin(webserverBucket)
        },
        certificate: Certificate.fromCertificateArn(
          this,
          env.DOMAIN_NAME,
          env.CLOUDFRONT_CERTIFICATE_ARN
        ),
        additionalBehaviors: {
          '/api/*': {
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            origin: new origins.LoadBalancerV2Origin(frontendLoadBalancer, {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY
            }),
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER
          }
        },
        defaultRootObject: 'index.html',
        domainNames: [env.DOMAIN_NAME],
        geoRestriction: cloudfront.GeoRestriction.allowlist('US')
      }
    )

    ///////////// ROUTE 53 /////////////

    //POINT ROUTE53 TO CLOUDFRONT DISTRIBUTION
    const hostedZone = route53.HostedZone.fromLookup(
      this,
      'chatter-hosted-zone',
      {
        domainName: env.DOMAIN_NAME
      }
    )

    new route53.ARecord(this, 'AliasRecordIPv4', {
      zone: hostedZone,
      recordName: env.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    new route53.AaaaRecord(this, 'AliasRecordIPv6', {
      zone: hostedZone,
      recordName: env.DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new route53_targets.CloudFrontTarget(appDistribution)
      )
    })

    cdkTags.Tags.of(appDistribution).add('project', 'chatter')
  }
}
