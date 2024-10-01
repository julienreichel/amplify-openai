import { defineBackend } from "@aws-amplify/backend";
import { auth } from './auth/resource';
import { data } from './data/resource';

import { Stack } from "aws-cdk-lib";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { EventSourceMapping, StartingPosition } from "aws-cdk-lib/aws-lambda";

import { dynamoDBOpenAITrigger } from "./functions/dynamodb-open-ai-trigger/resource";

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  dynamoDBOpenAITrigger
});

const OpenAIRequestTable = backend.data.resources.tables["OpenAIRequest"];
const policy = new Policy(
  Stack.of(OpenAIRequestTable),
  "DynamoDBTriggerPolicyForLambda",
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
          "dynamodb:UpdateItem",
        ],
        resources: ["*"],
      }),
    ],
  },
);
backend.dynamoDBOpenAITrigger.resources.lambda.role?.attachInlinePolicy(policy);

const mapping = new EventSourceMapping(
  Stack.of(OpenAIRequestTable),
  "DynamoDBTriggerEvent",
  {
    target: backend.dynamoDBOpenAITrigger.resources.lambda,
    eventSourceArn: OpenAIRequestTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
  },
);
mapping.node.addDependency(policy);

backend.data.resources.cfnResources.amplifyDynamoDbTables[
  "OpenAIRequest"
].timeToLiveAttribute = {
  attributeName: "ttl",
  enabled: true,
};