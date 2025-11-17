// AWS Configuration - matches existing solar-web-app setup
export const awsConfig = {
  region: 'us-east-2',
  cognito: {
    userPoolId: 'us-east-2_a98WW3Z3T',
    clientId: '6j57c6dts56j4gn0ctpokgob63',
  },
  s3: {
    groundtruthBucket: process.env.NEXT_PUBLIC_ENV === 'prod'
      ? 'solar-groundtruth-prod'
      : 'solar-groundtruth-dev',
    orthosBucket: process.env.NEXT_PUBLIC_ENV === 'prod'
      ? 'solar-orthos-prod'
      : 'solar-orthos-dev',
  },
  dynamodb: {
    projectsTable: process.env.NEXT_PUBLIC_ENV === 'prod'
      ? 'solar-projects-prod'
      : 'solar-projects-dev',
  },
};
