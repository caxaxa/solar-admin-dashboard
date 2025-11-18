// AWS Configuration - matches existing solar-web-app setup
export const awsConfig = {
  region: 'us-east-2',
  cognito: {
    userPoolId: 'us-east-2_a98WW3Z3T',
    clientId: '6j57c6dts56j4gn0ctpokgob63',
  },
  s3: {
    // Default buckets (for backward compatibility)
    groundtruthBucket: 'solar-groundtruth-dev',
    orthosBucket: 'solar-orthos-dev',
    // All environment buckets for admin dashboard
    dev: {
      groundtruthBucket: 'solar-groundtruth-dev',
      orthosBucket: 'solar-orthos-dev',
    },
    prod: {
      groundtruthBucket: 'solar-groundtruth-prod',
      orthosBucket: 'solar-orthos-prod',
    },
  },
  dynamodb: {
    projectsTable: process.env.NEXT_PUBLIC_ENV === 'prod'
      ? 'solar-projects-prod'
      : 'solar-projects-dev',
  },
};
