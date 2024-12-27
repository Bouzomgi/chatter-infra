import env from '../config'
import { App, Stack, StackProps, Fn, RemovalPolicy } from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
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
import * as cdk from 'aws-cdk-lib/core'
import * as sm from 'aws-cdk-lib/aws-secretsmanager'

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

    ///////////// BASTION INSTANCE /////////////

    // Security Group for the Bastion host
    const bastionSecurityGroup = new ec2.SecurityGroup(
      this,
      'chatter-bastion-sg',
      {
        vpc,
        description: 'Allow SSH access to bastion host',
        allowAllOutbound: true
      }
    )

    // Allow SSH from IP address
    bastionSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(env.LOCAL_IP),
      ec2.Port.tcp(22),
      'Allow SSH from my IP'
    )

    // Bastion host EC2 instance
    const bastionHost = new ec2.Instance(this, 'chatter-bastion', {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.genericLinux({
        'us-east-1': 'ami-0f9ae750e8274075b'
      }),
      securityGroup: bastionSecurityGroup,
      keyName: 'chatter-kp',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    })

    // Add IAM Role to the Bastion host
    bastionHost.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    )

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

    const databaseSecret = new sm.Secret(this, 'DatabaseSecret', {
      secretName: 'DatabaseUrl',
      description: 'Stores the database URL for Chatter API.',
      secretObjectValue: {
        DATABASE_URL: cdk.SecretValue.unsafePlainText(env.DATABASE_URL)
      }
    })
    const jwtSecret = new sm.Secret(this, 'JwtSecret', {
      secretName: 'JwtSigningSecret',
      description: 'Stores the JWT signing secret for Chatter API.',
      generateSecretString: {
        secretStringTemplate: '',
        generateStringKey: '',
        excludePunctuation: true,
        passwordLength: 32
      }
    })

    backendTaskDefinition.addContainer('api-container', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository),
      containerName: 'api-container',
      cpu: 0,
      logging: backendLogDriver,
      environment: {
        PORT: env.PORT,
        STORAGE_BUCKET_NAME: env.STORAGE_BUCKET_NAME,
        AWS_DEFAULT_REGION: env.AWS_REGION
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseSecret),
        TOKEN_SECRET: ecs.Secret.fromSecretsManager(jwtSecret)
      },
      portMappings: [
        {
          name: 'api-80-tcp',
          containerPort: 80,
          hostPort: 80
        }
      ]
    })

    // CREATE WEB SERVER SECURITY GROUP
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'api-sg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    ecsSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))

    // SPIN UP BACKEND SERVICE
    const backendService = new ecs.FargateService(this, 'api-service', {
      cluster,
      securityGroups: [ecsSecurityGroup],
      serviceName: 'api-service',
      taskDefinition: backendTaskDefinition,
      vpcSubnets: {
        subnetGroupName: 'api'
      },
      healthCheckGracePeriod: cdk.Duration.seconds(30)
    })

    ///////////// RDS /////////////
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'Allow traffic from ECS tasks to the RDS instance',
      allowAllOutbound: true
    })

    // Modify inbound rule for RDS security group to allow traffic from ECS tasks
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow inbound traffic from ECS tasks on Postgres port'
    )

    new rds.DatabaseInstance(this, 'chatter-db', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14
      }),
      vpc: vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets
      },
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      databaseName: 'chatterDb',
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publiclyAccessible: false
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
          path: '/api/health'
        },
        port: 80,
        targets: [backendTarget],
        vpc: vpc
      }
    )

    // CREATE LISTENER AND ASSIGN TARGET GROUPS
    const frontendListener = frontendLoadBalancer.addListener(
      'frontend-listener',
      {
        port: 80
      }
    )

    frontendListener.addTargetGroups('api-targets', {
      targetGroups: [backendTargetGroup]
    })

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
