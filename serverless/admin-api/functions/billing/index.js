const { dynamodb, cognito } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { getProjectsTable } = require('../shared/env');

const ENVIRONMENTS = ['dev', 'prod'];

/**
 * Fetch all billing profiles from DynamoDB for a given environment.
 */
async function getBillingProfiles(env) {
  const table = getProjectsTable(env);
  if (!table) return [];

  const profiles = [];
  let lastKey;

  do {
    const params = {
      TableName: table,
      FilterExpression: 'entity_type = :et',
      ExpressionAttributeValues: { ':et': 'billing_profile' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const response = await dynamodb.scan(params).promise();
    profiles.push(...(response.Items || []));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);

  return profiles;
}

/**
 * Fetch all projects that have billing_asset_unlocks from DynamoDB.
 */
async function getAssetUnlocks(env) {
  const table = getProjectsTable(env);
  if (!table) return [];

  const unlocks = [];
  let lastKey;

  do {
    const params = {
      TableName: table,
      FilterExpression: 'attribute_exists(billing_asset_unlocks) AND SK = :meta',
      ExpressionAttributeValues: { ':meta': 'METADATA' },
      ProjectionExpression:
        'project_id, user_id, project_name, billing_asset_unlocks, created_at, project_type',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const response = await dynamodb.scan(params).promise();
    for (const item of response.Items || []) {
      unlocks.push({ ...item, environment: env });
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);

  return unlocks;
}

/**
 * Fetch Stripe webhook events stored in DynamoDB (invoice/payment events).
 */
async function getStripeEvents(env) {
  const table = getProjectsTable(env);
  if (!table) return [];

  const events = [];
  let lastKey;

  do {
    const params = {
      TableName: table,
      FilterExpression: 'entity_type = :et',
      ExpressionAttributeValues: { ':et': 'stripe_webhook_event' },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const response = await dynamodb.scan(params).promise();
    events.push(...(response.Items || []));
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);

  return events;
}

/**
 * Build user email map from Cognito.
 */
async function getUserEmailMap(userPoolId) {
  const map = {};
  if (!userPoolId) return map;

  let token;
  do {
    const params = { UserPoolId: userPoolId };
    if (token) params.PaginationToken = token;

    const response = await cognito.listUsers(params).promise();
    for (const user of response.Users || []) {
      const sub = user.Username || '';
      const emailAttr = user.Attributes?.find((a) => a.Name === 'email');
      const email = emailAttr?.Value || sub;
      const verifiedAttr = user.Attributes?.find((a) => a.Name === 'email_verified');
      const status = user.UserStatus || '';
      const enabled = user.Enabled !== false;
      const createdAt = user.UserCreateDate
        ? new Date(user.UserCreateDate).getTime() / 1000
        : 0;

      if (sub) {
        map[sub] = {
          email,
          emailVerified: verifiedAttr?.Value === 'true',
          status,
          enabled,
          createdAt,
        };
      }
    }
    token = response.PaginationToken;
  } while (token);

  return map;
}

exports.handler = async (event) => {
  setRequestEvent(event);
  if ((event.requestContext?.http?.method || '').toUpperCase() === 'OPTIONS') {
    return preflightResponse();
  }

  try {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const envFilter = event.queryStringParameters?.env || '';

    // Gather data from all environments (or a specific one)
    const envs = envFilter ? [envFilter] : ENVIRONMENTS;

    const [userEmailMap, ...envResults] = await Promise.all([
      getUserEmailMap(userPoolId),
      ...envs.map(async (env) => {
        const [profiles, unlocks, events] = await Promise.all([
          getBillingProfiles(env),
          getAssetUnlocks(env),
          getStripeEvents(env),
        ]);
        return { env, profiles, unlocks, events };
      }),
    ]);

    // Merge profiles across environments (prod takes precedence)
    const profilesByUser = {};
    for (const { env, profiles } of envResults) {
      for (const profile of profiles) {
        const uid = profile.user_id;
        if (!profilesByUser[uid] || env === 'prod') {
          profilesByUser[uid] = { ...profile, environment: env };
        }
      }
    }

    // Flatten unlocks
    const allUnlocks = envResults.flatMap((r) => r.unlocks);

    // Flatten events
    const allEvents = envResults.flatMap((r) => r.events);

    // Build enriched user profiles
    const users = Object.entries(profilesByUser).map(([userId, profile]) => {
      const cognitoInfo = userEmailMap[userId] || {};
      return {
        userId,
        email: cognitoInfo.email || profile.email || '',
        emailVerified: cognitoInfo.emailVerified || false,
        cognitoStatus: cognitoInfo.status || '',
        enabled: cognitoInfo.enabled !== false,
        cognitoCreatedAt: cognitoInfo.createdAt || 0,
        currentPlan: profile.current_plan || 'none',
        subscriptionStatus: profile.subscription_status || 'inactive',
        billingCurrency: profile.billing_currency || 'BRL',
        billingLocale: profile.billing_locale || 'pt-BR',
        stripeCustomerId: profile.stripe_customer_id || '',
        stripeSubscriptionId: profile.stripe_subscription_id || '',
        trialStartedAt: profile.platform_trial_started_at || 0,
        trialEndsAt: profile.platform_trial_ends_at || 0,
        lastInvoiceStatus: profile.last_invoice_status || '',
        lastInvoiceAmountPaid: profile.last_invoice_amount_paid || 0,
        lastInvoiceAmountDue: profile.last_invoice_amount_due || 0,
        lastInvoiceCurrency: profile.last_invoice_currency || '',
        lastInvoiceId: profile.last_invoice_id || '',
        oneTimeGrants: profile.one_time_grants || {},
        oneTimeUsed: profile.one_time_used || {},
        monthlyUsagePeriod: profile.monthly_usage_period || '',
        monthlyUsage: profile.monthly_usage || {},
        createdAt: profile.created_at || 0,
        updatedAt: profile.updated_at || 0,
        environment: profile.environment,
      };
    });

    // Build unlock events list
    const unlockEvents = [];
    for (const project of allUnlocks) {
      const unlocks = project.billing_asset_unlocks || {};
      for (const [assetType, unlock] of Object.entries(unlocks)) {
        if (!unlock || typeof unlock !== 'object') continue;
        unlockEvents.push({
          projectId: project.project_id,
          projectName: project.project_name || '',
          projectType: project.project_type || 'thermographic',
          userId: project.user_id,
          assetType,
          source: unlock.source || '',
          charged: unlock.charged || false,
          amountMinor: unlock.amount_minor || 0,
          currency: unlock.currency || '',
          stripeInvoiceItemId: unlock.stripe_invoice_item_id || '',
          unlockedAt: unlock.unlocked_at || 0,
          panelCount: unlock.panel_count || 0,
          environment: project.environment,
        });
      }
    }

    // Sort unlock events by date descending
    unlockEvents.sort((a, b) => b.unlockedAt - a.unlockedAt);

    // Build stripe events list
    const stripeEvents = allEvents.map((e) => ({
      eventId: e.event_id || '',
      eventType: e.event_type || '',
      processedAt: e.processed_at || 0,
    }));

    return jsonResponse(200, {
      users,
      unlockEvents,
      stripeEvents,
      userEmailMap,
    });
  } catch (error) {
    console.error('Failed to fetch billing data:', error);
    return errorResponse(500, 'Failed to fetch billing data');
  }
};
